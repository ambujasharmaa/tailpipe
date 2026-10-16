// Source adapters. Each fetchPage(page, size) returns a list of normalized items:
// { id, source, title, url, discussionUrl, domain, points, comments, author, time, tag? }
// To add a source: write one adapter and add it to SOURCES. Use relative URLs for same-origin data.

const TRACKING = /^(utm_.*|fbclid|gclid|mc_.*|ref|ref_src|source|igshid|spm)$/i;

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return (u.origin + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch { return String(raw); }
}

const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isHttp = url => /^https?:\/\//i.test(url || '');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// localStorage cache with TTL; falls back to stale data if the fetch fails.
async function cached(key, ttlMs, fn) {
  const k = 'devfeed.cache.' + key;
  let hit = null;
  try { hit = JSON.parse(localStorage.getItem(k)); } catch {}
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const v = await fn();
    try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  } catch (e) {
    if (hit) return hit.v;
    throw e;
  }
}

// --- Hacker News: topstories order ---
let hnIds = null;
const hn = {
  key: 'hn', label: 'HN', name: 'Hacker News', enabled: true, units: ['pts', 'comments'],
  reset() { hnIds = null; },
  async fetchPage(page, size) {
    hnIds ||= getJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = (await hnIds).slice(page * size, page * size + size);
    const items = await Promise.all(ids.map(id => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    return items.filter(i => i && !i.dead && !i.deleted && i.title).map(i => {
      const discussionUrl = `https://news.ycombinator.com/item?id=${i.id}`;
      const url = isHttp(i.url) ? i.url : discussionUrl;
      return {
        id: String(i.id), source: 'hn', title: i.title, url, discussionUrl, domain: domainOf(url),
        points: i.score ?? 0, comments: i.descendants ?? 0, author: i.by, time: i.time * 1000,
      };
    });
  },
};

// --- Dev.to: top articles of the last day, API order ---
const devto = {
  key: 'devto', label: 'Dev.to', name: 'Dev.to', enabled: true, units: ['♥', 'comments'],
  async fetchPage(page, size) {
    const list = await getJson(`https://dev.to/api/articles?top=1&per_page=${size}&page=${page + 1}`);
    return list.map(a => {
      const url = isHttp(a.canonical_url) ? a.canonical_url : a.url;
      return {
        id: String(a.id), source: 'devto', title: a.title, url, discussionUrl: a.url, domain: domainOf(url),
        points: a.public_reactions_count ?? 0, comments: a.comments_count ?? 0,
        author: a.user?.name, time: Date.parse(a.published_timestamp), tag: a.tag_list?.[0],
      };
    });
  },
};

// --- GitHub: repos created in the last 7 days, by stars ---
// Unauthenticated search is limited to 10 requests/minute, so pages are cached for 10 minutes.
const github = {
  key: 'github', label: 'GitHub', name: 'GitHub', enabled: true, units: ['★', 'forks'],
  async fetchPage(page, size) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const q = encodeURIComponent(`created:>${since}`);
    // One API call returns 20 repos, which serve 5 feed pages of 4.
    const BATCH = 20, apiPage = Math.floor(page * size / BATCH) + 1;
    const data = await cached(`gh.${since}.${apiPage}`, 10 * 60e3, () =>
      getJson(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${BATCH}&page=${apiPage}`));
    const start = (page * size) % BATCH;
    return data.items.slice(start, start + size).map(r => ({
      id: String(r.id), source: 'github', title: r.full_name + (r.description ? ` — ${r.description}` : ''),
      url: r.html_url, discussionUrl: r.html_url + '/forks', domain: 'github.com',
      points: r.stargazers_count, comments: r.forks_count, author: r.owner?.login,
      time: Date.parse(r.created_at), tag: r.language || undefined,
    }));
  },
};

// --- Hugging Face daily papers ---
const papers = {
  key: 'papers', label: 'AI papers', name: 'AI papers', enabled: true, units: ['▲', 'comments'],
  async fetchPage(page, size) {
    const list = await getJson(`https://huggingface.co/api/daily_papers?limit=${size}&p=${page}`);
    return list.map(x => ({
      id: x.paper.id, source: 'papers', title: x.title || x.paper.title,
      url: `https://arxiv.org/abs/${x.paper.id}`, discussionUrl: `https://huggingface.co/papers/${x.paper.id}`,
      domain: 'arxiv.org', points: x.paper.upvotes ?? 0, comments: x.numComments ?? 0,
      author: x.paper.authors?.[0]?.name, time: Date.parse(x.publishedAt || x.paper.publishedAt),
    }));
  },
};

// --- Lobsters: lobste.rs sends no CORS headers, so this reads a same-origin snapshot
// (data/lobsters.json, a copy of hottest.json). DISABLED until a scheduled Action writes that file.
const lobsters = {
  key: 'lobsters', label: 'Lobsters', name: 'Lobsters', enabled: false, units: ['pts', 'comments'],
  async fetchPage(page, size) {
    const all = await getJson('data/lobsters.json');
    return all.slice(page * size, page * size + size).map(s => {
      const url = isHttp(s.url) ? s.url : s.comments_url;
      return {
        id: s.short_id, source: 'lobsters', title: s.title, url, discussionUrl: s.comments_url,
        domain: domainOf(url), points: s.score, comments: s.comment_count,
        author: s.submitter_user?.username ?? s.submitter_user, time: Date.parse(s.created_at), tag: s.tags?.[0],
      };
    });
  },
};

export const SOURCES = [hn, lobsters, devto, github, papers];

// Round-robin merge: [[a1,a2],[b1],[c1,c2]] -> a1,b1,c1,a2,c2
export function interleave(lists) {
  const out = [];
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
