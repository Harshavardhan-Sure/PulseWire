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

const RSS_SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "WIRED", url: "https://www.wired.com/feed/rss" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss" },
  { name: "BBC Technology", url: "http://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "Gadgets 360", url: "https://www.gadgets360.com/rss/feeds" },
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
  fetchedAt: 0
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

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
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

  const htmlSources = [
    item.contentEncoded,
    item.content,
    item.summary,
    item.description
  ].filter(Boolean);

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

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": parser.options.requestOptions.headers["User-Agent"]
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

async function enrichMissingImages(articles) {
  const candidates = articles.filter((article) => !article.image && article.link).slice(0, IMAGE_FALLBACK_LIMIT);

  await Promise.all(
    candidates.map(async (article) => {
      const html = await fetchHtml(article.link);
      const image = extractImageFromHtml(html);
      if (image) {
        article.image = image;
      }
    })
  );

  return articles;
}

function normalizeArticle(item, sourceName) {
  const rawDescription = item.contentSnippet || item.summary || item.description || item.contentEncoded || "";

  return {
    title: stripHtml(item.title || "Untitled Article"),
    link: item.link || "",
    source: sourceName,
    publishedAt: toIsoDate(item.isoDate || item.pubDate || Date.now()),
    description: truncateText(stripHtml(rawDescription), 220),
    image: extractImage(item)
  };
}

async function fetchSource(source) {
  const feed = await parser.parseURL(source.url);
  const items = Array.isArray(feed.items) ? feed.items : [];

  return items
    .map((item) => normalizeArticle(item, source.name))
    .filter((article) => article.title && article.link);
}

async function getAllArticles() {
  const now = Date.now();

  if (cache.articles.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      articles: cache.articles,
      meta: {
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
        sources: RSS_SOURCES.map((source) => source.name),
        failedSources: []
      }
    };
  }

  const results = await Promise.allSettled(RSS_SOURCES.map(fetchSource));
  const articles = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  await enrichMissingImages(articles);

  cache.articles = articles;
  cache.fetchedAt = now;

  return {
    articles,
    meta: {
      cached: false,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      sources: RSS_SOURCES.map((source) => source.name),
      failedSources: results
        .map((result, index) => (result.status === "rejected" ? RSS_SOURCES[index].name : null))
        .filter(Boolean)
    }
  };
}

function queryArticles(articles, { search = "", source = "All", page = 1, limit = 18 } = {}) {
  const normalizedSearch = String(search).trim().toLowerCase();
  const normalizedSource = String(source).trim();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 18));

  const filtered = articles.filter((article) => {
    const matchesSource = !normalizedSource || normalizedSource === "All" || article.source === normalizedSource;
    const haystack = `${article.title} ${article.description} ${article.source}`.toLowerCase();
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);

    return matchesSource && matchesSearch;
  });

  const start = (safePage - 1) * safeLimit;
  const pagedArticles = filtered.slice(start, start + safeLimit);

  return {
    articles: pagedArticles,
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
  const base = await getAllArticles();
  const queried = queryArticles(base.articles, options);

  return {
    articles: queried.articles,
    meta: {
      ...base.meta,
      pagination: queried.pagination
    }
  };
}

module.exports = {
  CACHE_TTL_MS,
  RSS_SOURCES,
  getAggregatedNews
};
