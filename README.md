# DevFeed

A single feed of top software-engineering links from Hacker News, Dev.to, GitHub (new trending repos) and Hugging Face daily papers.
A static PWA: no backend, no build step, no accounts.

**Features:** source filter chips, infinite scroll, seen-dimming, save for later, light/dark themes, offline fallback to the last feed.

## Run locally
```
python3 -m http.server 8000
```
Open http://localhost:8000.

## Deploy
GitHub repo → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.
When you change a shell file, bump `VERSION` in `sw.js` so installed copies update.

## Install
- iPhone: Safari → Share → Add to Home Screen.
- Android: Chrome → ⋮ → Install app.

## Lobsters
Lobsters has no CORS headers, so its adapter (disabled) reads `data/lobsters.json`. It will be enabled once a scheduled GitHub Action keeps that file fresh.

See `CLAUDE.md` for project decisions.
