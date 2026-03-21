const Parser = require("rss-parser");

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
      ["description", "description"]
    ]
  },
  requestOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
    }
  }
});

const CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_FALLBACK_LIMIT = 24;
const FEATURED_LIMIT = 4;
const ARCHIVE_ARTICLE_LIMIT = 16;
const ARCHIVE_MAX_SITEMAPS = 4;
const ARCHIVE_LOOKBACK_DAYS = 7;

const RSS_SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "WIRED", url: "https://www.wired.com/feed/rss" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss" },
  { name: "BBC Technology", url: "http://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "Gadgets 360", url: "https://www.gadgets360.com/rss/feeds", fallbackUrl: "https://www.gadgets360.com/news" },
  { name: "Beebom", url: "https://beebom.com/feed/" },
  { name: "Android Police", url: "https://www.androidpolice.com/feed/" },
  { name: "How-To Geek", url: "https://www.howtogeek.com/feed/" },
  { name: "XDA Developers", url: "https://www.xda-developers.com/feed/" },
  { name: "9to5Google", url: "https://9to5google.com/feed/" },
  { name: "Techmeme", url: "https://www.techmeme.com/feed.xml" },
  { name: "9to5Mac", url: "https://9to5mac.com/feed/" },
  { name: "It's FOSS", url: "https://itsfoss.com/feed/" },
  { name: "MakeUseOf", url: "https://www.makeuseof.com/feed/" },
  { name: "Digital Trends", url: "https://www.digitaltrends.com/feed/" }
];

const cache = {
  articles: [],
  fetchedAt: 0,
  failedSources: [],
  sourceDiagnostics: []
};

const DEFAULT_HEADERS = {
  "User-Agent": parser.options.requestOptions.headers["User-Agent"],
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 180) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function firstNonEmpty(values = []) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeTitle(value = "") {
  return stripHtml(value)
    .toLowerCase()
    .replace(/&#8217;|&#39;/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(update|live|report|review|hands on|hands on review)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImage(item) {
  const mediaContent = Array.isArray(item.mediaContent) ? item.mediaContent : [];
  const mediaThumbnail = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [];
  const mediaUrl =
    mediaContent.find((entry) => entry.$?.url)?.$?.url ||
    mediaThumbnail.find((entry) => entry.$?.url)?.$?.url;

  if (mediaUrl) {
    return mediaUrl;
  }

  const directImage = firstNonEmpty([
    item.enclosure?.url,
    item.thumbnail,
    item.image?.url,
    item.image?.href,
    item["media:thumbnail"]?.url,
    item["media:content"]?.url
  ]);

  if (directImage) {
    return directImage;
  }

  const htmlSources = [item.contentEncoded, item.content, item.summary, item.description].filter(Boolean);

  for (const value of htmlSources) {
    const html = String(value);
    const match = html.match(
      /(?:<img[^>]+(?:src|data-src)=["']([^"' >]+)[^"']*["']|<source[^>]+srcset=["']([^"' >,]+)|poster=["']([^"']+)["'])/i
    );
    const image = match?.[1] || match?.[2] || match?.[3];
    if (image) {
      return image;
    }
  }

  return "";
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        ...DEFAULT_HEADERS,
        ...(options.referer ? { Referer: options.referer } : {}),
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      return "";
    }

    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function extractImageFromHtml(html) {
  if (!html) {
    return "";
  }

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function flattenJsonLd(node, collection = []) {
  if (!node) {
    return collection;
  }

  if (Array.isArray(node)) {
    node.forEach((entry) => flattenJsonLd(entry, collection));
    return collection;
  }

  if (typeof node !== "object") {
    return collection;
  }

  collection.push(node);
  Object.values(node).forEach((value) => flattenJsonLd(value, collection));
  return collection;
}

function parseJsonLdArticles(html, source) {
  const scripts = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const entries = [];

  scripts.forEach((match) => {
    const raw = match[1]?.trim();
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      flattenJsonLd(parsed).forEach((node) => {
        const headline = firstNonEmpty([node.headline, node.name]);
        const url = toAbsoluteUrl(firstNonEmpty([node.url, node.mainEntityOfPage?.["@id"], node.mainEntityOfPage]), source.fallbackUrl || source.url);
        const image = Array.isArray(node.image)
          ? firstNonEmpty(node.image.map((entry) => typeof entry === "string" ? entry : entry?.url))
          : typeof node.image === "string"
            ? node.image
            : node.image?.url;

        if (!headline || !url) {
          return;
        }

        entries.push({
          title: headline,
          link: url,
          pubDate: firstNonEmpty([node.datePublished, node.dateCreated, node.dateModified]),
          description: firstNonEmpty([node.description]),
          image: toAbsoluteUrl(image, source.fallbackUrl || source.url)
        });
      });
    } catch {
    }
  });

  return entries;
}

function parseListingArticles(html, source) {
  if (!html) {
    return [];
  }

  const matches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const entries = [];
  const seen = new Set();

  for (const match of matches) {
    const link = toAbsoluteUrl(match[1], source.fallbackUrl || source.url);
    if (!likelyArticleUrl(link, source) || seen.has(link)) {
      continue;
    }

    const title = decodeHtmlEntities(stripHtml(match[2] || ""));
    if (!title || title.length < 20) {
      continue;
    }

    seen.add(link);
    entries.push({
      title,
      link,
      pubDate: "",
      description: "",
      image: ""
    });

    if (entries.length >= 18) {
      break;
    }
  }

  return entries;
}

function parseFallbackArticles(html, source) {
  const jsonLdArticles = parseJsonLdArticles(html, source);
  if (jsonLdArticles.length > 0) {
    return jsonLdArticles;
  }

  if (source.name === "Gadgets 360") {
    return parseListingArticles(html, source);
  }

  return [];
}

function normalizeFallbackArticle(item, sourceName) {
  return {
    id: item.link || `${sourceName}-${item.title || Date.now()}`,
    title: stripHtml(item.title || "Untitled Article"),
    normalizedTitle: normalizeTitle(item.title || "Untitled Article"),
    link: item.link || "",
    source: sourceName,
    publishedAt: toIsoDate(item.pubDate || Date.now()),
    description: truncateText(stripHtml(item.description || ""), 220),
    image: item.image || "",
    relatedSources: [sourceName],
    duplicateCount: 0
  };
}

function normalizeArticle(item, sourceName) {
  const rawDescription = item.contentSnippet || item.summary || item.description || item.contentEncoded || "";

  return {
    id: item.guid || item.id || item.link || `${sourceName}-${item.title || Date.now()}`,
    title: stripHtml(item.title || "Untitled Article"),
    normalizedTitle: normalizeTitle(item.title || "Untitled Article"),
    link: item.link || "",
    source: sourceName,
    publishedAt: toIsoDate(item.isoDate || item.pubDate || Date.now()),
    description: truncateText(stripHtml(rawDescription), 220),
    image: extractImage(item),
    relatedSources: [sourceName],
    duplicateCount: 0
  };
}

function sourceSiteUrl(source) {
  try {
    const url = new URL(source.url);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return source.url;
  }
}

function sitemapCandidatesForSource(source) {
  const base = sourceSiteUrl(source);
  return [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/post-sitemap.xml`,
    `${base}/wp-sitemap-posts-post-1.xml`,
    `${base}/news-sitemap.xml`
  ];
}

function parseSitemap(xml, baseUrl) {
  const sitemapUrls = Array.from(xml.matchAll(/<sitemap>\s*<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi)).map((match) => toAbsoluteUrl(match[1], baseUrl)).filter(Boolean);
  const articleUrls = Array.from(xml.matchAll(/<url>\s*<loc>(.*?)<\/loc>(?:[\s\S]*?<lastmod>(.*?)<\/lastmod>)?[\s\S]*?<\/url>/gi))
    .map((match) => ({
      url: toAbsoluteUrl(match[1], baseUrl),
      lastmod: match[2] ? toIsoDate(match[2]) : ""
    }))
    .filter((entry) => entry.url);

  return { sitemapUrls, articleUrls };
}

function likelyArticleUrl(url, source) {
  if (!url) {
    return false;
  }

  const hostname = new URL(sourceSiteUrl(source)).hostname.replace(/^www\./, "");
  return url.includes(hostname) && !/\/tag\/|\/author\/|\/category\/|\/topics\/|\/page\//i.test(url);
}

async function fetchArchiveBackfill(source, existingArticles = []) {
  const knownLinks = new Set(existingArticles.map((article) => article.link));
  const lookbackMs = ARCHIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const sitemapQueue = [...sitemapCandidatesForSource(source)];
  const visited = new Set();
  const articleCandidates = [];

  while (sitemapQueue.length > 0 && visited.size < ARCHIVE_MAX_SITEMAPS) {
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) {
      continue;
    }

    visited.add(sitemapUrl);
    const xml = await fetchText(sitemapUrl);
    if (!xml) {
      continue;
    }

    const parsed = parseSitemap(xml, sitemapUrl);

    parsed.sitemapUrls.forEach((url) => {
      if (visited.size + sitemapQueue.length < ARCHIVE_MAX_SITEMAPS) {
        sitemapQueue.push(url);
      }
    });

    parsed.articleUrls.forEach((entry) => {
      const lastmodMs = entry.lastmod ? new Date(entry.lastmod).getTime() : now;
      if (Number.isNaN(lastmodMs) || now - lastmodMs > lookbackMs) {
        return;
      }
      if (knownLinks.has(entry.url) || !likelyArticleUrl(entry.url, source)) {
        return;
      }
      articleCandidates.push(entry);
    });
  }

  const uniqueCandidates = Array.from(new Map(articleCandidates.map((entry) => [entry.url, entry])).values()).slice(0, ARCHIVE_ARTICLE_LIMIT);
  const results = [];

  for (const entry of uniqueCandidates) {
    const html = await fetchText(entry.url);
    if (!html) {
      continue;
    }

    const parsedArticles = parseJsonLdArticles(html, source)
      .filter((article) => article.link === entry.url || article.link === entry.url.replace(/\/$/, ""))
      .map((article) => normalizeFallbackArticle({ ...article, pubDate: article.pubDate || entry.lastmod }, source.name));

    if (parsedArticles.length > 0) {
      results.push(parsedArticles[0]);
    }
  }

  return results;
}

async function enrichMissingImages(articles) {
  const candidates = articles.filter((article) => !article.image && article.link).slice(0, IMAGE_FALLBACK_LIMIT);

  await Promise.all(
    candidates.map(async (article) => {
      const html = await fetchText(article.link);
      const image = extractImageFromHtml(html);
      if (image) {
        article.image = image;
      }
    })
  );

  return articles;
}

function buildSourceDiagnostic(source, articles, extras = {}) {
  const sorted = [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return {
    source: source.name,
    count: sorted.length,
    newest: sorted[0]?.publishedAt || "",
    oldest: sorted[sorted.length - 1]?.publishedAt || "",
    mode: extras.mode || "rss",
    archiveCount: extras.archiveCount || 0,
    error: extras.error || ""
  };
}

async function fetchSourceBundle(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = Array.isArray(feed.items) ? feed.items : [];
    const rssArticles = items
      .map((item) => normalizeArticle(item, source.name))
      .filter((article) => article.title && article.link);

    const archiveArticles = await fetchArchiveBackfill(source, rssArticles);
    const merged = [...rssArticles, ...archiveArticles];

    return {
      source: source.name,
      articles: merged,
      diagnostic: buildSourceDiagnostic(source, merged, {
        mode: archiveArticles.length > 0 ? "rss+archive" : "rss",
        archiveCount: archiveArticles.length
      })
    };
  } catch (error) {
    if (!source.fallbackUrl) {
      throw { source: source.name, message: error.message || "Feed request failed" };
    }

    const html = await fetchText(source.fallbackUrl, { referer: sourceSiteUrl(source) });
    const fallbackArticles = parseFallbackArticles(html, source)
      .map((item) => normalizeFallbackArticle(item, source.name))
      .filter((article) => article.title && article.link);

    if (fallbackArticles.length === 0) {
      throw { source: source.name, message: error.message || "Feed request failed" };
    }

    return {
      source: source.name,
      articles: fallbackArticles,
      diagnostic: buildSourceDiagnostic(source, fallbackArticles, { mode: "html-fallback" })
    };
  }
}

function dedupeArticles(articles) {
  const clusters = new Map();

  for (const article of articles) {
    const key = article.normalizedTitle || article.title.toLowerCase();
    const existing = clusters.get(key);

    if (!existing) {
      clusters.set(key, { ...article });
      continue;
    }

    existing.relatedSources = Array.from(new Set([...existing.relatedSources, article.source]));
    existing.duplicateCount += 1;

    if (new Date(article.publishedAt) > new Date(existing.publishedAt)) {
      existing.title = article.title;
      existing.link = article.link;
      existing.source = article.source;
      existing.publishedAt = article.publishedAt;
      existing.description = article.description || existing.description;
      existing.image = article.image || existing.image;
      existing.id = article.id;
    } else if (!existing.image && article.image) {
      existing.image = article.image;
    }
  }

  return Array.from(clusters.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

async function getAllArticles(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && cache.articles.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      articles: cache.articles,
      meta: {
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
        sources: RSS_SOURCES.map((source) => source.name),
        failedSources: cache.failedSources,
        sourceDiagnostics: cache.sourceDiagnostics
      }
    };
  }

  const results = await Promise.allSettled(RSS_SOURCES.map(fetchSourceBundle));
  const successful = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const rawArticles = successful.flatMap((bundle) => bundle.articles).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const articles = dedupeArticles(rawArticles);
  await enrichMissingImages(articles);

  cache.articles = articles;
  cache.fetchedAt = now;
  cache.failedSources = results
    .map((result, index) => (result.status === "rejected" ? RSS_SOURCES[index].name : null))
    .filter(Boolean);
  cache.sourceDiagnostics = RSS_SOURCES.map((source) => {
    const bundle = successful.find((entry) => entry.source === source.name);
    if (bundle) {
      return bundle.diagnostic;
    }

    const rejected = results[RSS_SOURCES.findIndex((entry) => entry.name === source.name)];
    return buildSourceDiagnostic(source, [], {
      mode: "unavailable",
      error: rejected?.reason?.message || "Unavailable"
    });
  });

  return {
    articles,
    meta: {
      cached: false,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      sources: RSS_SOURCES.map((source) => source.name),
      failedSources: cache.failedSources,
      sourceDiagnostics: cache.sourceDiagnostics
    }
  };
}

function countBySource(articles) {
  return Object.fromEntries(
    RSS_SOURCES.map((source) => [
      source.name,
      articles.filter((article) => article.relatedSources.includes(source.name)).length
    ])
  );
}

function filterByDateRange(articles, dateRange = "all") {
  if (!dateRange || dateRange === "all") {
    return articles;
  }

  const days = {
    today: 1,
    "3d": 3,
    "7d": 7
  }[dateRange];

  if (!days) {
    return articles;
  }

  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  return articles.filter((article) => new Date(article.publishedAt).getTime() >= cutoff);
}

function queryArticles(articles, { search = "", source = "All", page = 1, limit = 18, dateRange = "all" } = {}) {
  const normalizedSearch = String(search).trim().toLowerCase();
  const normalizedSource = String(source).trim();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 18));

  const byDate = filterByDateRange(articles, dateRange);
  const searched = byDate.filter((article) => {
    const haystack = [article.title, article.description, article.source, article.relatedSources.join(" ")]
      .join(" ")
      .toLowerCase();
    return !normalizedSearch || haystack.includes(normalizedSearch);
  });

  const sourceCounts = countBySource(searched);
  const filtered = searched.filter((article) => !normalizedSource || normalizedSource === "All" || article.relatedSources.includes(normalizedSource));

  const start = (safePage - 1) * safeLimit;
  const pagedArticles = filtered.slice(start, start + safeLimit);
  const featuredArticles = filtered.slice(0, FEATURED_LIMIT);

  return {
    articles: pagedArticles,
    featuredArticles,
    sourceCounts,
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalArticles: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / safeLimit)),
      hasMore: start + safeLimit < filtered.length
    }
  };
}

async function getAggregatedNews(options = {}) {
  const base = await getAllArticles(Boolean(options.forceRefresh));
  const queried = queryArticles(base.articles, options);

  return {
    articles: queried.articles,
    featuredArticles: queried.featuredArticles,
    meta: {
      ...base.meta,
      sourceCounts: queried.sourceCounts,
      pagination: queried.pagination
    }
  };
}

function clearCache() {
  cache.articles = [];
  cache.fetchedAt = 0;
  cache.failedSources = [];
  cache.sourceDiagnostics = [];
}

module.exports = {
  CACHE_TTL_MS,
  RSS_SOURCES,
  getAggregatedNews,
  clearCache
};
