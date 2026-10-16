# DevFeed

Mobile-first PWA: one scrollable feed of software-engineering links. Hosted free on GitHub Pages
(https://ambujasharmaa.github.io/devfeed/), installed to the phone home screen.

## Hard constraints
- Plain HTML + CSS + vanilla JS (ES modules). No framework, no bundler, no build step. Repo root is deployed as-is.
- All data is fetched live from the browser. No backend, no accounts, no third-party CORS proxies. Never add a proxy silently.
- **Relative URLs only** (`./`, `sw.js`, `icons/...`, `data/...`). GitHub Pages serves from `/devfeed/`, so a leading `/` breaks it.
  Applies to manifest `start_url`/`scope`, SW registration and all asset paths.
- Keep it small: index.html, styles.css, app.js (UI/state), sources.js (adapters), sw.js, manifest.webmanifest, icons/.

## Feed rules
- Trust each source's own ranking; no cross-source scoring.
  - HN: topstories order. Dev.to: `top=1` (last day), API order. GitHub: repos created in last 7 days, by stars.
  - AI papers: Hugging Face daily_papers order. Lobsters: hottest order (see below).
- 4 items per source per page, interleaved round-robin. A failing source is skipped and shows its own error card; it never blocks the others.
- Infinite scroll via IntersectionObserver; each source keeps its own page counter.
- Dedupe by normalized URL (tracking params, `www.`, hash, trailing slash stripped); first occurrence wins.
- Item shape: `{ id, source, title, url, discussionUrl, domain, points, comments, author, time }` (+ optional `tag`, `summary`).
  GitHub maps stars->points, forks->comments, language->tag. `units` on each source sets the labels.
- Adding a source = one adapter in `sources.js` + add it to `SOURCES`. No other change needed.

## CORS findings (checked 2026-10-16)
- OK: HN firebase, Dev.to (`*`), GitHub API (`*`), huggingface.co (echoes Origin).
- **Lobsters sends no CORS headers.** Its adapter reads same-origin `data/lobsters.json` and is `enabled: false`.
  Plan: a scheduled GitHub Action writes that file (copy of `hottest.json`), then flip `enabled` to true.
- GitHub unauthenticated search is limited to 10 req/min: adapter fetches 20 repos per call and caches 10 min in localStorage.
- Out of scope: finance sources (no CORS RSS), accounts, push, any backend.

## Service worker
- Shell: cache-first, cache name `devfeed-shell-<VERSION>`. **Bump `VERSION` in sw.js whenever any shell file changes**, otherwise clients keep the old shell.
- APIs: network-first, falling back to the last cached response (non-OK responses also fall back). Cache `devfeed-api` persists across versions.
- New SW calls `skipWaiting`/`clients.claim`; app.js reloads once on `controllerchange`.

## Run locally
`python3 -m http.server 8000` in the repo root, open http://localhost:8000 (service workers work on localhost).
Regenerate icons from `icons/icon.svg` with `rsvg-convert -w N -h N` (192, 512, 180; maskable is the same art, kept inside the safe zone).

## Design
- Fonts: Space Grotesk (titles, UI; weight 600) + JetBrains Mono (metadata, chips).
- Themes via `data-theme` on <html>: `light` (pastel blue #d9e7f7 + white), `oxford` (#000c1f bg, #011837-family navy + #fd36ab rose),
  `plum` (#170616 bg, #3b153a plum cards + #f0c986 honey). User cycles Auto/Light/Oxford/Plum; Auto = light or oxford by prefers-color-scheme.
  `applyTheme()` is inline in index.html so it runs before first paint.
- Each source has a color per theme (`--c-<sourcekey>`), used only for the source name in the meta line. New source = add its var to all 3 themes.
- Keep it plain, like a real reader app: no colored stripes, uppercase tracked labels, dots, pills, glows, glass blur, drop shadows, toasts, emoji/unicode glyph icons (use inline SVG), or em dashes in UI copy. Short, plain copy.
- Views: rich cards (default) or compact rows (`.compact` on <html>), toggled in the header; both stored in localStorage.
- Wordmark scrambles from random glyphs into "DevFeed" on load and on refresh (`scramble()` in app.js).
- Feel: a little bold, but optimized for scrolling and reading. Respect `env(safe-area-inset-*)`.
