const express = require("express");
const path = require("path");
const { getAggregatedNews, RSS_SOURCES, CACHE_TTL_MS } = require("./rssService");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/api/news", async (req, res) => {
  try {
    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search || "";
    const source = req.query.source || "All";

    const data = await getAggregatedNews({ page, limit, search, source });
    res.json({
      articles: data.articles,
      meta: {
        ...data.meta,
        cacheDurationMs: CACHE_TTL_MS
      }
    });
  } catch (error) {
    res.status(500).json({
      articles: [],
      error: "Unable to fetch news right now."
    });
  }
});

app.get("/api/sources", (req, res) => {
  res.json({
    sources: RSS_SOURCES.map((source) => source.name)
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Tech News Aggregator running at http://localhost:${PORT}`);
});
