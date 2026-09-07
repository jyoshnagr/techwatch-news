# Dispatch — a personal daily tech & AI news app

A static, mobile-friendly news reader that updates itself once a day.
No database, no backend server, no paid services.

**How it works:** a small script (`scripts/fetch-news.js`) pulls RSS feeds
from tech/AI sources, writes them to `data/news.json`, and a plain
HTML/CSS/JS page (`index.html`) reads that file and renders the feed.
A scheduled GitHub Action runs the script once a day and commits the
updated JSON — that's the entire "backend."

Everything here is plain, portable code. If you ever want to leave
GitHub, the same script and page work unchanged on any static host or
even a cron job on your own machine.

## 1. Try it locally

```bash
npm install
npm run fetch        # writes data/news.json
npx serve .          # or any static file server — index.html can't be opened via file://
```

## 2. Put it on GitHub (free hosting + free daily job)

1. Create a new **public** GitHub repo and push these files to it.
2. In the repo, go to **Settings → Pages** and set the source to
   "Deploy from a branch" → `main` → `/ (root)`. Your app will be live
   at `https://<username>.github.io/<repo>/` within a minute or two.
3. Go to **Settings → Actions → General → Workflow permissions** and
   select "Read and write permissions." This lets the daily job commit
   the updated `data/news.json` back to the repo.
4. That's it — `.github/workflows/update-news.yml` will run daily at
   07:00 UTC. You can also trigger it manually any time from the
   **Actions** tab ("Update news feed" → "Run workflow").

Prefer Cloudflare Pages or Netlify instead of GitHub Pages? Both have
generous free tiers too — just connect the same repo; the fetch script
still runs on GitHub Actions (or their equivalent scheduled functions)
and the frontend is the same static files either way.

## 3. Customize your sources

Open `scripts/fetch-news.js` and edit the `SOURCES` array. Any site
with a public RSS/Atom feed can be added as:

```js
{ name: "Site Name", type: "rss", url: "https://example.com/feed.xml", color: "#123456" }
```

A few more good RSS feeds to try: `https://www.wired.com/feed/rss`,
`https://feeds.feedburner.com/venturebeat/SZYF` (VentureBeat AI),
`https://www.technologyreview.com/feed/` (MIT Tech Review).

### Sources without a public RSS feed (e.g. Meta AI)

Not every company publishes RSS. Options, roughly in order of effort:

- **Self-host RSS-Bridge or RSSHub** (both free, open source) — they
  turn almost any page into an RSS feed you control, then just add it
  as a normal `type: "rss"` source above.
- **Best-effort scrape** — see the `Anthropic` entry in `SOURCES` for
  an example (`type: "scrape"`). It's fragile: if the site's HTML
  changes, that one source silently stops returning items, but it
  never breaks the rest of the run.
- **Skip it** and check the site directly for that one company.

## 4. Make it installable on your phone

The manifest and service worker are already wired up — once the site
is live over https, open it on your phone and use "Add to Home
Screen" (iOS Safari) or the install prompt (Android Chrome). It'll
open full-screen like a native app and cache the shell for offline use.

## Project structure

```
index.html                       the whole frontend (HTML+CSS+JS, no build step)
manifest.json / sw.js / icons/   PWA install + offline support
scripts/fetch-news.js            pulls sources, writes data/news.json
data/news.json                   generated data the frontend reads
.github/workflows/update-news.yml   the free daily cron job
```

## Costs

- Hosting: $0 (GitHub Pages / Cloudflare Pages / Netlify free tier)
- Daily fetch job: $0 (GitHub Actions free tier — this uses under a
  minute of run time per day, well within the free 2,000 min/month)
- Data source: $0 (RSS is free and open)
