const express = require("express");
const path = require("path");
const { getAggregatedNews, CACHE_TTL_MS, clearCache } = require("../server/rssService");

const app = express();
const clientDir = path.join(__dirname, "..", "client");

app.use(express.json());
app.use(express.static(clientDir));

app.get("/api/news", async (req, res) => {
  try {
    const data = await getAggregatedNews({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search || "",
      source: req.query.source || "All",
      dateRange: req.query.dateRange || "all",
      forceRefresh: req.query.refresh === "1"
    });

    res.json({
      articles: data.articles,
      featuredArticles: data.featuredArticles,
      meta: {
        ...data.meta,
        cacheDurationMs: CACHE_TTL_MS
      }
    });
  } catch {
    res.status(500).json({
      articles: [],
      featuredArticles: [],
      error: "Unable to fetch news right now."
    });
  }
});

app.post("/api/news/refresh", async (req, res) => {
  try {
    clearCache();
    const data = await getAggregatedNews({ page: 1, limit: 18, forceRefresh: true });
    res.json({
      ok: true,
      fetchedAt: data.meta.fetchedAt,
      failedSources: data.meta.failedSources || []
    });
  } catch {
    res.status(500).json({ ok: false, error: "Unable to refresh feeds right now." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

module.exports = app;
