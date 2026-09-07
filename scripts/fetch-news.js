// fetch-news.js
// Pulls tech/AI news from RSS feeds (+ a couple of best-effort fallbacks
// for sources with no public feed) and writes a single data/news.json
// file that the frontend reads. Designed to run once a day via a
// scheduled job (see .github/workflows/update-news.yml), but you can
// run it anywhere Node 18+ is available: `npm run fetch`.
//
// No API keys, no database, no paid services.

import Parser from "rss-parser";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Some feed hosts (InfoQ among them) reject requests with a generic
// user-agent or a missing/narrow Accept header and return 406. A more
// complete, browser-like header set fixes this without misrepresenting
// what the request is for.
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
};

const parser = new Parser({
  timeout: 15000,
  headers: DEFAULT_HEADERS,
});

// ---------------------------------------------------------------------
// 1. Sources
// ---------------------------------------------------------------------
// type: "rss"     -> standard RSS/Atom feed, parsed with rss-parser
// type: "hn"      -> Hacker News via the free public Firebase API
// type: "scrape"  -> best-effort HTML link-scrape for sites with no
//                    public feed. These are fragile by nature (they
//                    break if the site redesigns) and wrapped so a
//                    failure never takes down the rest of the run.

const SOURCES = [
  // category: "ai"      -> model releases, research, and dev-focused AI content
  // category: "general" -> broader tech news (may still include AI stories)

  { name: "OpenAI", type: "rss", url: "https://openai.com/news/rss.xml", color: "#10a37f", category: "ai" },
  { name: "Google AI", type: "rss", url: "https://blog.google/technology/ai/rss/", color: "#4285f4", category: "ai" },
  { name: "Google DeepMind", type: "rss", url: "https://deepmind.google/blog/feed", color: "#3762e2", category: "ai" },

  // Engineering-focused AI coverage — model/tooling news written for
  // software engineers rather than a general audience.
  { name: "InfoQ AI/ML", type: "rss", url: "https://feed.infoq.com/ai-ml-data-eng/", color: "#7b3fe4", category: "ai" },
  { name: "Simon Willison", type: "rss", url: "https://simonwillison.net/atom/everything/", color: "#b3541e", category: "ai" },

  { name: "TechCrunch", type: "rss", url: "https://techcrunch.com/feed/", color: "#0aa860", category: "general" },
  { name: "The Verge", type: "rss", url: "https://www.theverge.com/rss/index.xml", color: "#fa4616", category: "general" },
  { name: "Ars Technica", type: "rss", url: "https://feeds.arstechnica.com/arstechnica/index", color: "#ff4e00", category: "general" },
  { name: "Hacker News", type: "hn", color: "#ff6600", category: "general" },

  // Anthropic and Meta don't publish a public RSS feed as of writing.
  // This is a best-effort scrape of the newsroom page's link list —
  // it can break if either site changes its markup. If it stops
  // working, either delete the entry below or point it at a
  // self-hosted RSSHub/RSS-Bridge instance instead (see README).
  {
    name: "Anthropic",
    type: "scrape",
    url: "https://www.anthropic.com/news",
    linkPrefix: "/news/",
    base: "https://www.anthropic.com",
    color: "#d97757",
    category: "ai",
  },
];

const OUTPUT_PATH = path.join(process.cwd(), "data", "news.json");
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_AGE_DAYS = 21; // drop anything older than this to keep the feed fresh

// ---------------------------------------------------------------------
// 2. Fetchers
// ---------------------------------------------------------------------

async function fetchRss(source) {
  const feed = await parser.parseURL(source.url);
  return (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE).map((item) => ({
    source: source.name,
    color: source.color,
    category: source.category,
    title: cleanText(item.title),
    link: item.link,
    summary: truncate(cleanText(item.contentSnippet || item.summary || item.content || ""), MAX_SUMMARY_CHARS),
    publishedAt: item.isoDate || item.pubDate || null,
  }));
}

async function fetchHackerNews(source) {
  const topIdsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  const topIds = (await topIdsRes.json()).slice(0, MAX_ITEMS_PER_SOURCE);

  const items = await Promise.all(
    topIds.map(async (id) => {
      const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const story = await res.json();
      if (!story || !story.title) return null;
      return {
        source: source.name,
        color: source.color,
        category: source.category,
        title: cleanText(story.title),
        link: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
        summary: `${story.score ?? 0} points, ${story.descendants ?? 0} comments`,
        publishedAt: story.time ? new Date(story.time * 1000).toISOString() : null,
      };
    })
  );

  return items.filter(Boolean);
}

async function fetchScrape(source) {
  const res = await fetch(source.url, { headers: DEFAULT_HEADERS });
  const html = await res.text();

  const linkRe = new RegExp(
    `<a[^>]+href="(${escapeRegex(source.linkPrefix)}[^"?#]+)"[^>]*>(.*?)</a>`,
    "gs"
  );

  const seen = new Set();
  const items = [];
  let match;
  while ((match = linkRe.exec(html)) !== null && items.length < MAX_ITEMS_PER_SOURCE) {
    const href = match[1];
    const text = cleanText(match[2].replace(/<[^>]+>/g, " "));
    if (!text || text.length < 8 || seen.has(href)) continue;
    seen.add(href);
    items.push({
      source: source.name,
      color: source.color,
      category: source.category,
      title: text,
      link: source.base + href,
      summary: "",
      publishedAt: null, // scraped pages rarely expose a clean date in the link markup
    });
  }
  return items;
}

// ---------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------

const MAX_SUMMARY_CHARS = 220;

function cleanText(s) {
  return (s || "")
    .replace(/<[^>]*>/g, " ") // strip HTML tags
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&") // must come after other entities that contain "&"
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim() + "…";
}


function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecentEnough(publishedAt) {
  if (!publishedAt) return true; // keep undated items (e.g. scraped ones) rather than dropping them
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= MAX_AGE_DAYS;
}

// ---------------------------------------------------------------------
// 4. Run
// ---------------------------------------------------------------------

async function run() {
  const results = await Promise.allSettled(
    SOURCES.map((source) => {
      if (source.type === "rss") return fetchRss(source);
      if (source.type === "hn") return fetchHackerNews(source);
      if (source.type === "scrape") return fetchScrape(source);
      return Promise.resolve([]);
    })
  );

  const allItems = [];
  const errors = [];

  results.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
    } else {
      errors.push({ source: source.name, error: String(result.reason) });
      console.error(`[fetch-news] ${source.name} failed:`, result.reason);
    }
  });

  const deduped = dedupeByLink(allItems).filter((item) => isRecentEnough(item.publishedAt));

  deduped.sort((a, b) => {
    // undated items sort after dated ones
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const output = {
    updatedAt: new Date().toISOString(),
    sources: SOURCES.map((s) => ({ name: s.name, color: s.color, category: s.category })),
    itemCount: deduped.length,
    errors,
    items: deduped,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`[fetch-news] wrote ${deduped.length} items to ${OUTPUT_PATH}`);
  if (errors.length) {
    console.log(`[fetch-news] ${errors.length} source(s) failed (see above) — run continued anyway.`);
  }
}

function dedupeByLink(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.link;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

run().catch((err) => {
  console.error("[fetch-news] fatal error:", err);
  process.exit(1);
});
