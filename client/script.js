const SOURCE_META = {
  "TechCrunch": { favicon: "https://techcrunch.com/favicon.ico" },
  "The Verge": { favicon: "https://www.theverge.com/favicon.ico" },
  "WIRED": { favicon: "https://www.wired.com/favicon.ico" },
  "Ars Technica": { favicon: "https://arstechnica.com/favicon.ico" },
  "Hacker News": { favicon: "https://news.ycombinator.com/favicon.ico" },
  "BBC Technology": { favicon: "https://www.bbc.com/favicon.ico" },
  "Gadgets 360": { favicon: "https://www.gadgets360.com/favicon.ico" },
  "Beebom": { favicon: "https://beebom.com/favicon.ico" },
  "Android Police": { favicon: "https://www.androidpolice.com/favicon.ico" },
  "How-To Geek": { favicon: "https://www.howtogeek.com/favicon.ico" },
  "XDA Developers": { favicon: "https://www.xda-developers.com/favicon.ico" },
  "9to5Google": { favicon: "https://9to5google.com/favicon.ico" },
  "Techmeme": { favicon: "https://www.techmeme.com/favicon.ico" },
  "9to5Mac": { favicon: "https://9to5mac.com/favicon.ico" },
  "It's FOSS": { favicon: "https://itsfoss.com/favicon.ico" },
  "MakeUseOf": { favicon: "https://www.makeuseof.com/favicon.ico" },
  "Digital Trends": { favicon: "https://www.digitaltrends.com/favicon.ico" }
};

const SOURCE_PALETTE = {
  "TechCrunch": ["#14b86d", "#0d7d4c"],
  "The Verge": ["#ff5c39", "#ffd400"],
  "WIRED": ["#c6d3ff", "#7b88ff"],
  "Ars Technica": ["#f0b35f", "#9a5f2d"],
  "Hacker News": ["#ff7f2a", "#ffb36b"],
  "BBC Technology": ["#ff5c70", "#8e0a21"],
  "Beebom": ["#35b6ff", "#0040ff"],
  "Android Police": ["#85ff7a", "#2d7d35"],
  "How-To Geek": ["#9ff4ff", "#3787c9"],
  "XDA Developers": ["#a3ff4d", "#ff7d61"],
  "9to5Google": ["#b6ff7d", "#3a8f42"],
  "9to5Mac": ["#c7d7ff", "#3f63ff"],
  "Techmeme": ["#ffd48e", "#ec6235"],
  "It's FOSS": ["#7ef0ff", "#2956ff"],
  "MakeUseOf": ["#ffd7a6", "#ff8757"],
  "Digital Trends": ["#b8c9ff", "#446cff"]
};

const TREND_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "will", "your", "their", "about",
  "have", "more", "than", "after", "over", "under", "latest", "review", "just", "gets", "make",
  "makes", "says", "say", "best", "first", "guide", "hands", "hand", "new", "you", "are", "which"
]);

const state = {
  articles: [],
  featuredArticles: [],
  page: 1,
  limit: 18,
  hasMore: true,
  isLoading: false,
  selectedSource: "All",
  searchTerm: "",
  fetchedAt: "",
  sourceCounts: {},
  knownSources: Object.keys(SOURCE_META),
  failedSources: [],
  savedArticles: [],
  hiddenSources: [],
  settings: {
    sort: "newest",
    cardsPerBatch: 18,
    stickySidebar: true,
    showFeatured: true
  }
};

let currentController = null;
let searchTimer = null;

const elements = {
  newsGrid: document.getElementById("newsGrid"),
  featuredGrid: document.getElementById("featuredGrid"),
  featuredSection: document.getElementById("featuredSection"),
  trendingTopics: document.getElementById("trendingTopics"),
  diagnosticsBar: document.getElementById("diagnosticsBar"),
  loadingState: document.getElementById("loadingState"),
  skeletonGrid: document.getElementById("skeletonGrid"),
  emptyState: document.getElementById("emptyState"),
  endState: document.getElementById("endState"),
  scrollSentinel: document.getElementById("scrollSentinel"),
  searchInput: document.getElementById("searchInput"),
  sourceFilters: document.getElementById("sourceFilters"),
  clearFilterBtn: document.getElementById("clearFilterBtn"),
  themeToggle: document.getElementById("themeToggle"),
  refreshFeedsBtn: document.getElementById("refreshFeedsBtn"),
  backToTopBtn: document.getElementById("backToTopBtn"),
  scrollTopBtn: document.getElementById("scrollTopBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  savedBtn: document.getElementById("savedBtn"),
  sortSelect: document.getElementById("sortSelect"),
  cardsPerBatchSelect: document.getElementById("cardsPerBatchSelect"),
  stickySidebarToggle: document.getElementById("stickySidebarToggle"),
  showFeaturedToggle: document.getElementById("showFeaturedToggle"),
  openFeaturedBtn: document.getElementById("openFeaturedBtn"),
  feedStatus: document.getElementById("feedStatus"),
  resultsTitle: document.getElementById("resultsTitle"),
  articleCardTemplate: document.getElementById("articleCardTemplate"),
  featuredCardTemplate: document.getElementById("featuredCardTemplate"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalContent: document.getElementById("modalContent"),
  modalCloseBtn: document.getElementById("modalCloseBtn")
};

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatRelativeTime(value) {
  const now = Date.now();
  const diffMs = now - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.round(diffHours / 24)}d ago`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(value, query) {
  const safeValue = escapeHtml(value);
  if (!query) return safeValue;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safeValue.replace(new RegExp(`(${escapedQuery})`, "ig"), "<mark>$1</mark>");
}

function tokenize(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !TREND_STOP_WORDS.has(token));
}

function buildTrendPhrases(article) {
  const tokens = tokenize(`${article.title} ${article.description}`);
  const phrases = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const pair = tokens.slice(index, index + 2);
    const triple = tokens.slice(index, index + 3);

    if (triple.length === 3) {
      phrases.push(triple.join(" "));
    }

    if (pair.length === 2) {
      phrases.push(pair.join(" "));
    }
  }

  return Array.from(new Set(phrases)).filter((phrase) => /[a-z]/.test(phrase) && phrase.length >= 7 && phrase.length <= 40);
}

function formatTrendLabel(phrase) {
  return phrase.replace(/\b(ai|ios|macos|ipad|api|gpu|cpu|usb|ssd|openai|android)\b/gi, (match) => match.toUpperCase())
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function computeTrending(articles) {
  const counts = new Map();

  articles.forEach((article) => {
    buildTrendPhrases(article).slice(0, 12).forEach((phrase) => {
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 10)
    .map(([phrase, count]) => [formatTrendLabel(phrase), count]);
}

function getSourceMeta(source) {
  return SOURCE_META[source] || { favicon: "" };
}

function sourceInitials(source) {
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function articleMeta(article) {
  const sourceList = article.relatedSources?.length > 1 ? article.relatedSources.join(", ") : article.source;
  const duplicateText = article.duplicateCount ? ` • ${article.duplicateCount + 1} sources` : "";
  return `${sourceList} • ${formatRelativeTime(article.publishedAt)} • ${formatDate(article.publishedAt)}${duplicateText}`;
}

function iconMarkup(name) {
  switch (name) {
    case "preview":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    case "save":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    case "saved":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case "hide":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.6 5.7A11.5 11.5 0 0 1 12 5.5c6.7 0 10.5 6.5 10.5 6.5a18.2 18.2 0 0 1-4 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.2 7.3A18.8 18.8 0 0 0 1.5 12S5.3 18.5 12 18.5c1.5 0 2.8-.3 4-.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 9.9A3.2 3.2 0 0 0 12 15.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    case "show":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    default:
      return "";
  }
}

function setIconButton(button, iconName, label) {
  button.innerHTML = iconMarkup(iconName);
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}
function saveState() {
  sessionStorage.setItem("pulsewire-hidden-sources", JSON.stringify(state.hiddenSources));
  sessionStorage.setItem("pulsewire-saved-articles", JSON.stringify(state.savedArticles));
  localStorage.setItem("pulsewire-settings", JSON.stringify(state.settings));
}

function loadPersistedState() {
  try {
    state.hiddenSources = JSON.parse(sessionStorage.getItem("pulsewire-hidden-sources") || "[]");
    state.savedArticles = JSON.parse(sessionStorage.getItem("pulsewire-saved-articles") || "[]");
    const settings = JSON.parse(localStorage.getItem("pulsewire-settings") || "{}");
    state.settings = { ...state.settings, ...settings };
    state.limit = state.settings.cardsPerBatch;
  } catch {
    state.hiddenSources = [];
    state.savedArticles = [];
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.searchTerm = params.get("search") || "";
  state.selectedSource = params.get("source") || "All";
  state.page = Math.max(1, Number(params.get("page") || 1));

  if (params.get("sort")) {
    state.settings.sort = params.get("sort");
  }

  elements.searchInput.value = state.searchTerm;
}

function syncUrl() {
  const params = new URLSearchParams(window.location.search);

  state.searchTerm ? params.set("search", state.searchTerm) : params.delete("search");
  state.selectedSource !== "All" ? params.set("source", state.selectedSource) : params.delete("source");
  state.page > 1 ? params.set("page", String(state.page)) : params.delete("page");
  state.settings.sort !== "newest" ? params.set("sort", state.settings.sort) : params.delete("sort");

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function setThemeLabel(theme) {
  elements.themeToggle.querySelector(".theme-toggle__label").textContent = theme === "night" ? "Day edition" : "Night edition";
}

function applySettingsToUi() {
  elements.sortSelect.value = state.settings.sort;
  elements.cardsPerBatchSelect.value = String(state.settings.cardsPerBatch);
  elements.stickySidebarToggle.checked = state.settings.stickySidebar;
  elements.showFeaturedToggle.checked = state.settings.showFeatured;
  document.body.classList.toggle("no-sticky-sidebar", !state.settings.stickySidebar);
  elements.featuredSection.classList.toggle("hidden", !state.settings.showFeatured);
  elements.savedBtn.textContent = `Saved (${state.savedArticles.length})`;
}

function scrollPageToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setContainerHtml(element, markup) {
  element.innerHTML = markup;
}

function clearFeedDom() {
  elements.newsGrid.innerHTML = "";
  elements.featuredGrid.innerHTML = "";
}

function isSaved(articleId) {
  return state.savedArticles.some((article) => article.id === articleId);
}

function toggleSaveArticle(article) {
  state.savedArticles = isSaved(article.id)
    ? state.savedArticles.filter((saved) => saved.id !== article.id)
    : [{ ...article }, ...state.savedArticles];

  saveState();
  applySettingsToUi();
  renderCurrentView();
}

function sortArticles(articles) {
  const sorted = [...articles];

  switch (state.settings.sort) {
    case "source":
      return sorted.sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title));
    case "duplicated":
      return sorted.sort(
        (a, b) => (b.duplicateCount || 0) - (a.duplicateCount || 0) || new Date(b.publishedAt) - new Date(a.publishedAt)
      );
    case "newest":
    default:
      return sorted.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }
}

function isArticleHidden(article) {
  return article.relatedSources?.some((source) => state.hiddenSources.includes(source));
}

function getVisibleArticles() {
  return sortArticles(state.articles.filter((article) => !isArticleHidden(article)));
}

function getVisibleFeatured() {
  return sortArticles(state.featuredArticles.filter((article) => !isArticleHidden(article))).slice(0, 4);
}

function getFilteredArticles() {
  const articles = getVisibleArticles();
  return state.selectedSource === "All"
    ? articles
    : articles.filter((article) => article.relatedSources?.includes(state.selectedSource));
}

function applyPlaceholder(node, source, title, className) {
  const [start, end] = SOURCE_PALETTE[source] || ["#e8ecf8", "#6f82ff"];
  node.className = className;
  node.style.setProperty("--placeholder-start", start);
  node.style.setProperty("--placeholder-end", end);
  node.innerHTML = `<span>${sourceInitials(source)}</span><small>${escapeHtml(title)}</small>`;
  node.classList.remove("hidden");
}

function attachImageOrPlaceholder(imageNode, placeholderNode, article, placeholderClass) {
  const showPlaceholder = () => {
    imageNode.classList.add("hidden");
    applyPlaceholder(placeholderNode, article.source, article.title, placeholderClass);
  };

  if (!article.image) {
    showPlaceholder();
    return;
  }

  imageNode.src = article.image;
  imageNode.alt = `${article.title} preview image`;
  imageNode.classList.remove("hidden");
  imageNode.addEventListener("error", showPlaceholder, { once: true });
}

function renderSourceIcon(source, className = "") {
  const { favicon } = getSourceMeta(source);
  const fallback = sourceInitials(source).slice(0, 2);
  const classAttribute = className ? ` class="${className}"` : "";

  return favicon
    ? `<img${classAttribute} src="${favicon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'source-icon-fallback', textContent: '${fallback}' }))" />`
    : `<span class="source-icon-fallback">${fallback}</span>`;
}

function setSourceBadge(container, source) {
  container.innerHTML = `${renderSourceIcon(source)}<span>${escapeHtml(source)}</span>`;
}

function buildCard(template, article, config) {
  const fragment = template.content.cloneNode(true);
  const image = fragment.querySelector(config.imageSelector);
  const placeholder = fragment.querySelector(config.placeholderSelector);
  const badge = fragment.querySelector(config.badgeSelector);
  const meta = fragment.querySelector(config.metaSelector);
  const title = fragment.querySelector(config.titleSelector);
  const description = fragment.querySelector(config.descriptionSelector);
  const previewBtn = fragment.querySelector(config.previewSelector);
  const saveBtn = fragment.querySelector(config.saveSelector);
  const link = fragment.querySelector(config.linkSelector);

  attachImageOrPlaceholder(image, placeholder, article, config.placeholderClass);
  setSourceBadge(badge, article.source);
  meta.textContent = articleMeta(article);
  title.innerHTML = highlightText(article.title, state.searchTerm);
  description.innerHTML = highlightText(article.description || "Open the story to read the full article.", state.searchTerm);
  setIconButton(previewBtn, "preview", "Preview story");
  previewBtn.addEventListener("click", () => openArticleModal(article));
  setIconButton(saveBtn, isSaved(article.id) ? "saved" : "save", isSaved(article.id) ? "Saved" : "Save story");
  saveBtn.addEventListener("click", () => toggleSaveArticle(article));
  link.href = article.link;

  return fragment;
}

function createArticleCard(article) {
  return buildCard(elements.articleCardTemplate, article, {
    imageSelector: ".news-card__image",
    placeholderSelector: ".news-card__placeholder",
    badgeSelector: ".news-card__source-badge",
    metaSelector: ".news-card__meta",
    titleSelector: ".news-card__title",
    descriptionSelector: ".news-card__description",
    previewSelector: ".card-preview-btn",
    saveSelector: ".card-save-btn",
    linkSelector: ".news-card__link",
    placeholderClass: "news-card__placeholder"
  });
}

function createFeaturedCard(article) {
  return buildCard(elements.featuredCardTemplate, article, {
    imageSelector: ".featured-card__image",
    placeholderSelector: ".featured-card__placeholder",
    badgeSelector: ".featured-card__badge",
    metaSelector: ".featured-card__meta",
    titleSelector: ".featured-card__title",
    descriptionSelector: ".featured-card__description",
    previewSelector: ".featured-preview-btn",
    saveSelector: ".featured-save-btn",
    linkSelector: ".news-card__link",
    placeholderClass: "featured-card__placeholder"
  });
}

function selectSource(source) {
  state.selectedSource = source;
  resetAndReload();
}

function toggleHiddenSource(source) {
  const hidden = state.hiddenSources.includes(source);

  state.hiddenSources = hidden
    ? state.hiddenSources.filter((entry) => entry !== source)
    : Array.from(new Set([...state.hiddenSources, source]));

  if (!hidden && state.selectedSource === source) {
    state.selectedSource = "All";
  }

  saveState();
  renderCurrentView();
  syncUrl();
}

function renderSourceRow(source, count, hidden = false) {
  const row = document.createElement("div");
  row.className = `source-row${hidden ? " is-hidden-source" : ""}`;

  if (source === "All") {
    row.innerHTML = `<button type="button" class="filter-chip${state.selectedSource === "All" ? " active" : ""}"><span>All</span><strong>${count}</strong></button>`;
    row.querySelector("button").addEventListener("click", () => selectSource("All"));
    return row;
  }

  const { favicon } = getSourceMeta(source);
  row.innerHTML = `
    <button type="button" class="filter-chip${state.selectedSource === source ? " active" : ""}" ${hidden ? "disabled" : ""}>
      <span class="source-chip__main">${renderSourceIcon(source)}<span>${escapeHtml(source)}</span></span>
      <strong>${count}</strong>
    </button>
    <button type="button" class="source-toggle-btn icon-button" aria-label="${hidden ? "Show source" : "Hide source"}" title="${hidden ? "Show source" : "Hide source"}">${iconMarkup(hidden ? "show" : "hide")}</button>
  `;

  row.querySelector(".filter-chip").addEventListener("click", () => selectSource(source));
  row.querySelector(".source-toggle-btn").addEventListener("click", () => toggleHiddenSource(source));
  return row;
}

function renderSourceFilters() {
  elements.sourceFilters.innerHTML = "";
  const fragment = document.createDocumentFragment();

  fragment.appendChild(renderSourceRow("All", getVisibleArticles().length));

  state.knownSources.forEach((source) => {
    fragment.appendChild(
      renderSourceRow(source, Number(state.sourceCounts[source] || 0), state.hiddenSources.includes(source))
    );
  });

  elements.sourceFilters.appendChild(fragment);
}

function renderSkeletons() {
  const cards = Array.from({ length: 6 }, () => (
    '<div class="skeleton-card"><div class="skeleton-card__media"></div><div class="skeleton-card__line skeleton-card__line--short"></div><div class="skeleton-card__line"></div><div class="skeleton-card__line"></div></div>'
  ));
  setContainerHtml(elements.skeletonGrid, cards.join(""));
}

function renderTrendingTopics() {
  const topics = computeTrending(getVisibleArticles());
  setContainerHtml(
    elements.trendingTopics,
    topics.length
      ? topics
          .map(
            ([topic, count]) =>
              `<button type="button" class="trend-chip" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)} <strong>${count}</strong></button>`
          )
          .join("")
      : '<p class="state-inline">No strong topic clusters yet.</p>'
  );

  elements.trendingTopics.querySelectorAll(".trend-chip").forEach((button) => {
    button.addEventListener("click", () => {
      state.searchTerm = button.dataset.topic || "";
      elements.searchInput.value = state.searchTerm;
      resetAndReload();
    });
  });
}

function renderDiagnostics() {
  const activeSources = state.knownSources.length - state.hiddenSources.length - state.failedSources.length;
  setContainerHtml(
    elements.diagnosticsBar,
    [
      [getVisibleArticles().length, "loaded"],
      [activeSources, "active sources"],
      [state.failedSources.length, "failed"],
      [state.fetchedAt ? formatRelativeTime(state.fetchedAt) : "-", "last refresh"],
      [state.hiddenSources.length, "hidden sources"]
    ]
      .map(([value, label]) => `<div class="diagnostic-pill"><strong>${value}</strong><span>${label}</span></div>`)
      .join("")
  );
}

function renderCardCollection(container, articles, createCard) {
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  articles.forEach((article) => fragment.appendChild(createCard(article)));
  container.appendChild(fragment);
}

function renderCurrentView() {
  const featuredArticles = getVisibleFeatured();
  const filteredArticles = getFilteredArticles();

  renderCardCollection(elements.newsGrid, filteredArticles, createArticleCard);
  renderCardCollection(elements.featuredGrid, featuredArticles, createFeaturedCard);

  elements.featuredSection.classList.toggle("hidden", !state.settings.showFeatured || featuredArticles.length === 0);
  elements.emptyState.classList.toggle("hidden", filteredArticles.length !== 0);
  elements.resultsTitle.textContent = state.selectedSource === "All" ? "Top stories" : `${state.selectedSource} stories`;
  elements.savedBtn.textContent = `Saved (${state.savedArticles.length})`;

  renderSourceFilters();
  renderTrendingTopics();
  renderDiagnostics();
}

function buildApiUrl({ page = state.page, refresh = false } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(state.limit),
    search: state.searchTerm,
    source: state.selectedSource
  });

  if (refresh) {
    params.set("refresh", "1");
  }

  return `/api/news?${params.toString()}`;
}

function abortCurrentRequest() {
  if (!currentController) {
    return;
  }

  currentController.abort();
  currentController = null;
}

function setLoadingState(message, { show = true } = {}) {
  elements.loadingState.textContent = message;
  elements.loadingState.classList.toggle("hidden", !show);
}

async function loadNews({ append = false, pageOverride = null, refresh = false } = {}) {
  if (state.isLoading || (!state.hasMore && append && !refresh)) {
    return;
  }

  state.isLoading = true;
  currentController = new AbortController();
  setLoadingState(append ? "Loading more stories..." : refresh ? "Refreshing feeds..." : "Fetching the latest articles...");
  elements.skeletonGrid.classList.remove("hidden");
  renderSkeletons();

  if (!append) {
    elements.endState.classList.add("hidden");
  }

  try {
    const response = await fetch(buildApiUrl({ page: pageOverride ?? state.page, refresh }), {
      signal: currentController.signal
    });

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const data = await response.json();
    const incomingArticles = Array.isArray(data.articles) ? data.articles : [];
    const incomingFeatured = Array.isArray(data.featuredArticles) ? data.featuredArticles : [];
    const pagination = data.meta?.pagination || {};

    state.articles = append ? state.articles.concat(incomingArticles) : incomingArticles;
    state.featuredArticles = incomingFeatured;
    state.hasMore = Boolean(pagination.hasMore);
    state.fetchedAt = data.meta?.fetchedAt || "";
    state.sourceCounts = data.meta?.sourceCounts || {};
    state.failedSources = data.meta?.failedSources || [];
    state.knownSources = data.meta?.sources || state.knownSources;
    state.page = Number(pagination.page) || state.page;

    elements.feedStatus.textContent = state.failedSources.length
      ? `Updated ${formatDate(state.fetchedAt)}. Some feeds were unavailable: ${state.failedSources.join(", ")}.`
      : `Updated ${formatDate(state.fetchedAt)}${data.meta?.cached ? " from cache" : ""}.`;

    renderCurrentView();
    syncUrl();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (!append) {
      state.articles = [];
      state.featuredArticles = [];
      clearFeedDom();
    }

    elements.feedStatus.textContent = "Unable to load feeds right now. Please try refreshing in a moment.";
    setLoadingState("Something went wrong while fetching the latest articles.");
  } finally {
    state.isLoading = false;
    currentController = null;
    elements.loadingState.classList.add("hidden");
    elements.skeletonGrid.classList.add("hidden");
    elements.endState.classList.toggle("hidden", state.hasMore || getVisibleArticles().length === 0);
  }
}

async function hydratePagedState() {
  const targetPage = state.page;
  state.page = 1;
  state.hasMore = true;

  for (let page = 1; page <= targetPage; page += 1) {
    await loadNews({ append: page > 1, pageOverride: page });

    if (!state.hasMore && page < targetPage) {
      break;
    }
  }
}

function resetAndReload({ refresh = false } = {}) {
  abortCurrentRequest();
  scrollPageToTop();
  state.page = 1;
  state.hasMore = true;
  state.articles = [];
  state.featuredArticles = [];
  clearFeedDom();
  syncUrl();
  loadNews({ refresh });
}

function openModal(markup) {
  elements.modalContent.innerHTML = markup;
  elements.modalOverlay.classList.remove("hidden");
}

function openArticleModal(article) {
  const { favicon } = getSourceMeta(article.source);
  openModal(`
    <article class="modal-article">
      ${article.image ? `<img class="modal-article__image" src="${article.image}" alt="${escapeHtml(article.title)}" />` : ""}
      <p class="eyebrow">Preview</p>
      <h2 id="modalTitle">${escapeHtml(article.title)}</h2>
      <p class="modal-meta">${escapeHtml(articleMeta(article))}</p>
      <p class="modal-source">${renderSourceIcon(article.source)}<span>${escapeHtml(article.source)}</span></p>
      <p class="modal-description">${escapeHtml(article.description || "Open the article to read the full story.")}</p>
      <div class="modal-actions">
        <button id="modalSaveBtn" class="text-button icon-button" type="button" aria-label="${isSaved(article.id) ? "Saved" : "Save for later"}" title="${isSaved(article.id) ? "Saved" : "Save for later"}">${iconMarkup(isSaved(article.id) ? "saved" : "save")}</button>
        <a class="news-card__link" href="${article.link}" target="_blank" rel="noopener noreferrer">Open original</a>
      </div>
    </article>
  `);

  document.getElementById("modalSaveBtn").addEventListener("click", () => {
    toggleSaveArticle(article);
    openArticleModal(article);
  });
}

function openSavedModal() {
  const content = state.savedArticles.length
    ? state.savedArticles
        .map(
          (article) =>
            `<div class="saved-row"><button class="saved-open" data-id="${escapeHtml(article.id)}" type="button">${escapeHtml(article.title)}</button><button class="text-button saved-remove" data-id="${escapeHtml(article.id)}" type="button">Remove</button></div>`
        )
        .join("")
    : '<p class="state-inline">No saved stories yet.</p>';

  openModal(`
    <section>
      <p class="eyebrow">Read later</p>
      <h2 id="modalTitle">Saved stories</h2>
      <div class="saved-list">${content}</div>
    </section>
  `);

  elements.modalContent.querySelectorAll(".saved-open").forEach((button) => {
    button.addEventListener("click", () => {
      const article = state.savedArticles.find((entry) => entry.id === button.dataset.id);
      if (article) {
        openArticleModal(article);
      }
    });
  });

  elements.modalContent.querySelectorAll(".saved-remove").forEach((button) => {
    button.addEventListener("click", () => {
      state.savedArticles = state.savedArticles.filter((entry) => entry.id !== button.dataset.id);
      saveState();
      applySettingsToUi();
      renderCurrentView();
      openSavedModal();
    });
  });
}

function closeModal() {
  elements.modalOverlay.classList.add("hidden");
  elements.modalContent.innerHTML = "";
}

function applyTheme(theme) {
  document.body.classList.toggle("night", theme === "night");
  localStorage.setItem("pulsewire-theme", theme);
  setThemeLabel(theme);
}

function bindScrollToTop(button) {
  button.addEventListener("click", scrollPageToTop);
}

const observer = new IntersectionObserver(
  (entries) => {
    const [entry] = entries;
    if (!entry.isIntersecting || state.isLoading || !state.hasMore) {
      return;
    }

    state.page += 1;
    loadNews({ append: true });
  },
  { rootMargin: "500px 0px" }
);

elements.searchInput.addEventListener("input", (event) => {
  state.searchTerm = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => resetAndReload(), 250);
});

elements.clearFilterBtn.addEventListener("click", () => {
  state.selectedSource = "All";
  state.searchTerm = "";
  elements.searchInput.value = "";
  resetAndReload();
});

elements.themeToggle.addEventListener("click", () => {
  applyTheme(document.body.classList.contains("night") ? "light" : "night");
});

elements.refreshFeedsBtn.addEventListener("click", async () => {
  elements.refreshFeedsBtn.disabled = true;

  try {
    await fetch("/api/news/refresh", { method: "POST" });
  } catch {
  } finally {
    elements.refreshFeedsBtn.disabled = false;
  }

  resetAndReload({ refresh: true });
});

elements.savedBtn.addEventListener("click", openSavedModal);
elements.settingsBtn.addEventListener("click", () => elements.settingsPanel.classList.toggle("hidden"));
bindScrollToTop(elements.backToTopBtn);
bindScrollToTop(elements.scrollTopBtn);
elements.openFeaturedBtn.addEventListener("click", () => {
  getVisibleFeatured().forEach((article) => window.open(article.link, "_blank", "noopener"));
});
elements.modalCloseBtn.addEventListener("click", closeModal);
elements.modalOverlay.addEventListener("click", (event) => {
  if (event.target === elements.modalOverlay) {
    closeModal();
  }
});

elements.sortSelect.addEventListener("change", () => {
  state.settings.sort = elements.sortSelect.value;
  saveState();
  renderCurrentView();
  syncUrl();
});

elements.cardsPerBatchSelect.addEventListener("change", () => {
  state.settings.cardsPerBatch = Number(elements.cardsPerBatchSelect.value);
  state.limit = state.settings.cardsPerBatch;
  saveState();
  resetAndReload();
});

elements.stickySidebarToggle.addEventListener("change", () => {
  state.settings.stickySidebar = elements.stickySidebarToggle.checked;
  saveState();
  applySettingsToUi();
});

elements.showFeaturedToggle.addEventListener("change", () => {
  state.settings.showFeatured = elements.showFeaturedToggle.checked;
  saveState();
  applySettingsToUi();
  renderCurrentView();
});

window.addEventListener("scroll", () => {
  elements.backToTopBtn.classList.toggle("hidden", window.scrollY < 600);
});

window.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) {
    return;
  }

  if (event.key === "/") {
    event.preventDefault();
    elements.searchInput.focus();
  }

  if (event.key.toLowerCase() === "t") {
    scrollPageToTop();
  }

  if (event.key.toLowerCase() === "d") {
    elements.themeToggle.click();
  }

  if (event.key === "Escape") {
    closeModal();
  }
});

loadPersistedState();
applySettingsToUi();
applyTheme(localStorage.getItem("pulsewire-theme") === "night" ? "night" : "light");
hydrateFromUrl();
observer.observe(elements.scrollSentinel);
hydratePagedState();




