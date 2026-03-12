const state = {
  articles: [],
  page: 1,
  limit: 18,
  hasMore: true,
  isLoading: false,
  selectedSource: "All",
  searchTerm: "",
  totalArticles: 0,
  fetchedAt: ""
};

let currentController = null;
let searchTimer = null;

const newsGrid = document.getElementById("newsGrid");
const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");
const endState = document.getElementById("endState");
const scrollSentinel = document.getElementById("scrollSentinel");
const searchInput = document.getElementById("searchInput");
const sourceFilters = document.getElementById("sourceFilters");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const themeToggle = document.getElementById("themeToggle");
const feedStatus = document.getElementById("feedStatus");
const resultsMeta = document.getElementById("resultsMeta");
const resultsTitle = document.getElementById("resultsTitle");
const footerSources = document.getElementById("footerSources");
const articleCardTemplate = document.getElementById("articleCardTemplate");

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function createArticleCard(article) {
  const fragment = articleCardTemplate.content.cloneNode(true);
  const image = fragment.querySelector(".news-card__image");
  const sourceBadge = fragment.querySelector(".news-card__source-badge");
  const meta = fragment.querySelector(".news-card__meta");
  const title = fragment.querySelector(".news-card__title");
  const description = fragment.querySelector(".news-card__description");
  const link = fragment.querySelector(".news-card__link");

  if (article.image) {
    image.src = article.image;
    image.alt = `${article.title} preview image`;
  } else {
    image.remove();
  }

  sourceBadge.textContent = article.source;
  meta.textContent = `${article.source} • ${formatDate(article.publishedAt)}`;
  title.textContent = article.title;
  description.textContent = article.description || "Open the story to read the full article.";
  link.href = article.link;
  link.setAttribute("aria-label", `Read full article: ${article.title}`);

  return fragment;
}

function renderArticles(articles, { append = false } = {}) {
  if (!append) {
    newsGrid.innerHTML = "";
  }

  const fragment = document.createDocumentFragment();
  articles.forEach((article) => fragment.appendChild(createArticleCard(article)));
  newsGrid.appendChild(fragment);
}

function renderSourceFilters(sources = []) {
  const list = ["All", ...sources];
  sourceFilters.innerHTML = "";

  list.forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${source === state.selectedSource ? " active" : ""}`;
    button.textContent = source;
    button.addEventListener("click", () => {
      if (state.selectedSource === source) {
        return;
      }

      state.selectedSource = source;
      renderSourceFilters(sources);
      resetAndReload();
    });
    sourceFilters.appendChild(button);
  });
}

function updateResultsMeta() {
  const suffix = state.selectedSource === "All" ? "across all sources" : `from ${state.selectedSource}`;
  resultsTitle.textContent = state.selectedSource === "All" ? "Top stories" : `${state.selectedSource} stories`;
  resultsMeta.textContent = `${state.totalArticles} article${state.totalArticles === 1 ? "" : "s"} ${suffix}`;
}

function updateEndState() {
  const noArticles = state.totalArticles === 0;
  emptyState.classList.toggle("hidden", !noArticles);
  endState.classList.toggle("hidden", noArticles || state.hasMore || state.articles.length === 0 || state.isLoading);
}

function updateTheme(nextTheme) {
  document.body.classList.toggle("night", nextTheme === "night");
  localStorage.setItem("pulsewire-theme", nextTheme);
  themeToggle.querySelector(".theme-toggle__label").textContent =
    nextTheme === "night" ? "Day edition" : "Night edition";
}

function buildApiUrl() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
    search: state.searchTerm,
    source: state.selectedSource
  });

  return `/api/news?${params.toString()}`;
}

function abortCurrentRequest() {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}

async function loadNews({ append = false } = {}) {
  if (state.isLoading || (!state.hasMore && append)) {
    return;
  }

  state.isLoading = true;
  currentController = new AbortController();
  loadingState.classList.remove("hidden");
  loadingState.textContent = append ? "Loading more stories..." : "Fetching the latest articles...";

  if (!append) {
    emptyState.classList.add("hidden");
    endState.classList.add("hidden");
  }

  try {
    const response = await fetch(buildApiUrl(), { signal: currentController.signal });
    if (!response.ok) {
      throw new Error("Request failed");
    }

    const data = await response.json();
    const incomingArticles = Array.isArray(data.articles) ? data.articles : [];
    const sources = data.meta?.sources || [];
    const pagination = data.meta?.pagination || {};

    state.articles = append ? state.articles.concat(incomingArticles) : incomingArticles;
    state.hasMore = Boolean(pagination.hasMore);
    state.totalArticles = Number(pagination.totalArticles) || 0;
    state.fetchedAt = data.meta?.fetchedAt || "";

    footerSources.textContent = sources.join(", ");
    feedStatus.textContent = data.meta?.failedSources?.length
      ? `Updated ${formatDate(state.fetchedAt)}. Some feeds were unavailable: ${data.meta.failedSources.join(", ")}.`
      : `Updated ${formatDate(state.fetchedAt)}${data.meta?.cached ? " from cache" : ""}.`;

    renderSourceFilters(sources);
    renderArticles(incomingArticles, { append });
    updateResultsMeta();
    updateEndState();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (!append) {
      state.articles = [];
      state.totalArticles = 0;
      newsGrid.innerHTML = "";
    }

    feedStatus.textContent = "Unable to load feeds right now. Please try refreshing in a moment.";
    loadingState.textContent = "Something went wrong while fetching the latest articles.";
    endState.classList.add("hidden");
    updateEndState();
  } finally {
    state.isLoading = false;
    currentController = null;
    loadingState.classList.add("hidden");
    updateEndState();
  }
}

function resetAndReload() {
  abortCurrentRequest();
  state.page = 1;
  state.hasMore = true;
  state.totalArticles = 0;
  state.articles = [];
  state.isLoading = false;
  newsGrid.innerHTML = "";
  loadNews({ append: false });
}

const observer = new IntersectionObserver(
  (entries) => {
    const [entry] = entries;
    if (!entry.isIntersecting || state.isLoading || !state.hasMore || state.totalArticles === 0) {
      return;
    }

    state.page += 1;
    loadNews({ append: true });
  },
  {
    rootMargin: "500px 0px"
  }
);

searchInput.addEventListener("input", (event) => {
  state.searchTerm = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    resetAndReload();
  }, 250);
});

clearFilterBtn.addEventListener("click", () => {
  state.selectedSource = "All";
  state.searchTerm = "";
  searchInput.value = "";
  resetAndReload();
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("night") ? "light" : "night";
  updateTheme(nextTheme);
});

const savedTheme = localStorage.getItem("pulsewire-theme");
updateTheme(savedTheme === "night" ? "night" : "light");
observer.observe(scrollSentinel);
loadNews();
