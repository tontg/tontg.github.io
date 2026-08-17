import {
  buildSearchUrl,
  detectUiLanguage,
  extractQueryActions,
  normalizeDomain,
} from './search.js';

const MESSAGES = {
  en: {
    appTitle: 'Search Builder',
    appSubtitle: 'Build a focused search, then open it where you choose.',
    formHeading: 'Advanced search options',
    themeLabel: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    queryLabel: 'Search query',
    queryPlaceholder: 'e.g. casablanca',
    queryRequired: 'Enter a search query.',
    engineLegend: 'Search engine',
    google: 'Google',
    duckduckgo: 'DuckDuckGo',
    languageLegend: 'Search language',
    languageUndefined: 'Undefined',
    french: 'French',
    english: 'English',
    typeLegend: 'Search type',
    web: 'Web',
    news: 'News',
    news2: 'News 2',
    images: 'Images',
    filtersLegend: 'Filters',
    restrictSite: 'Search only on a website',
    websiteLabel: 'Website',
    websitePlaceholder: 'e.g. news.example.co.uk/article',
    websiteHint: 'Any page URL or domain; subdomains are reduced automatically.',
    websiteRequired: 'Enter a website to restrict the search.',
    websiteInvalid: 'Enter a valid website with a registrable domain.',
    pdfOnly: 'PDF files only',
    pdfImagesHint: 'PDF filtering is unavailable for image searches.',
    previewLabel: 'Generated URL',
    previewEmpty: 'Complete the required fields to generate a URL.',
    copyUrl: 'Copy URL',
    copied: 'URL copied.',
    copyFailed: 'Could not copy the URL. Select it and copy manually.',
    search: 'Search',
    popupBlocked: 'Your browser blocked the new tab. Allow pop-ups and try again.',
    offline: 'You are offline. The builder still works, but searches need a connection.',
    keywordHelpTitle: 'Query shortcuts',
    keywordHelpIntro: 'Add uppercase shortcuts as standalone terms. They are applied and removed when you press Enter or Search; compatible shortcuts can be combined.',
    keywordPdf: 'PDF',
    keywordPdfDescription: 'Search PDF files only.',
    keywordImg: 'IMG',
    keywordImgDescription: 'Switch to image search.',
    keywordNews: 'NEWS',
    keywordNewsDescription: 'Switch to news search.',
    keywordNews2: 'NEWS2',
    keywordNews2Description: 'Search Google News and select Google automatically.',
    keywordFrEn: 'FR / EN',
    keywordFrEnDescription: 'Set the search-result language.',
    keywordUrl: 'https://example.com',
    keywordUrlDescription: 'Restrict results to the URL’s registrable domain.',
    keywordExample: 'Example: casablanca PDF FR https://lemonde.fr',
  },
  fr: {
    appTitle: 'Créateur de recherche',
    appSubtitle: 'Composez une recherche ciblée, puis ouvrez-la où vous le souhaitez.',
    formHeading: 'Options de recherche avancée',
    themeLabel: 'Thème',
    themeSystem: 'Système',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    queryLabel: 'Requête de recherche',
    queryPlaceholder: 'p. ex. casablanca',
    queryRequired: 'Saisissez une requête de recherche.',
    engineLegend: 'Moteur de recherche',
    google: 'Google',
    duckduckgo: 'DuckDuckGo',
    languageLegend: 'Langue de recherche',
    languageUndefined: 'Non définie',
    french: 'Français',
    english: 'Anglais',
    typeLegend: 'Type de recherche',
    web: 'Web',
    news: 'Actualités',
    news2: 'Actualités 2',
    images: 'Images',
    filtersLegend: 'Filtres',
    restrictSite: 'Rechercher uniquement sur un site',
    websiteLabel: 'Site web',
    websitePlaceholder: 'p. ex. actualites.example.co.uk/article',
    websiteHint: 'URL de page ou domaine ; les sous-domaines sont réduits automatiquement.',
    websiteRequired: 'Saisissez un site pour limiter la recherche.',
    websiteInvalid: 'Saisissez un site avec un domaine enregistrable valide.',
    pdfOnly: 'Fichiers PDF uniquement',
    pdfImagesHint: 'Le filtre PDF est indisponible pour la recherche d’images.',
    previewLabel: 'URL générée',
    previewEmpty: 'Complétez les champs obligatoires pour générer une URL.',
    copyUrl: 'Copier l’URL',
    copied: 'URL copiée.',
    copyFailed: 'Impossible de copier l’URL. Sélectionnez-la et copiez-la manuellement.',
    search: 'Rechercher',
    popupBlocked: 'Le navigateur a bloqué le nouvel onglet. Autorisez les fenêtres contextuelles et réessayez.',
    offline: 'Vous êtes hors ligne. Le générateur fonctionne, mais les recherches nécessitent une connexion.',
    keywordHelpTitle: 'Raccourcis de requête',
    keywordHelpIntro: 'Ajoutez ces raccourcis en majuscules comme termes indépendants. Ils sont appliqués puis retirés lorsque vous appuyez sur Entrée ou Rechercher ; les raccourcis compatibles peuvent être combinés.',
    keywordPdf: 'PDF',
    keywordPdfDescription: 'Rechercher uniquement des fichiers PDF.',
    keywordImg: 'IMG',
    keywordImgDescription: 'Passer à la recherche d’images.',
    keywordNews: 'NEWS',
    keywordNewsDescription: 'Passer à la recherche d’actualités.',
    keywordNews2: 'NEWS2',
    keywordNews2Description: 'Rechercher dans Google Actualités et sélectionner Google automatiquement.',
    keywordFrEn: 'FR / EN',
    keywordFrEnDescription: 'Définir la langue des résultats de recherche.',
    keywordUrl: 'https://example.com',
    keywordUrlDescription: 'Limiter les résultats au domaine enregistrable de l’URL.',
    keywordExample: 'Exemple : casablanca PDF FR https://lemonde.fr',
  },
};

const STORAGE_KEYS = {
  engine: 'search-builder.engine',
  language: 'search-builder.search-language',
  theme: 'search-builder.theme',
};

const LEGACY_TYPE_STORAGE_KEY = 'search-builder.type';

const VALID_PREFERENCES = {
  engine: ['google', 'duckduckgo'],
  language: ['undefined', 'fr', 'en'],
  theme: ['system', 'light', 'dark'],
};

const uiLanguage = detectUiLanguage();
const t = (key) => MESSAGES[uiLanguage][key];

const elements = {
  form: document.querySelector('#search-form'),
  query: document.querySelector('#query'),
  queryError: document.querySelector('#query-error'),
  restrictSite: document.querySelector('#restrict-site'),
  siteField: document.querySelector('#site-field'),
  website: document.querySelector('#website'),
  websiteError: document.querySelector('#website-error'),
  pdfOnly: document.querySelector('#pdf-only'),
  pdfHint: document.querySelector('#pdf-hint'),
  news2: document.querySelector('#type-news2'),
  preview: document.querySelector('#url-preview'),
  copyButton: document.querySelector('#copy-button'),
  copyStatus: document.querySelector('#copy-status'),
  theme: document.querySelector('#theme'),
  offlineStatus: document.querySelector('#offline-status'),
  themeColor: document.querySelector('#theme-color'),
};

function translatePage() {
  document.documentElement.lang = uiLanguage;
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

function readPreference(name, fallback) {
  try {
    const value = localStorage.getItem(STORAGE_KEYS[name]);
    return VALID_PREFERENCES[name].includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function savePreference(name, value) {
  if (!VALID_PREFERENCES[name].includes(value)) return;
  try {
    localStorage.setItem(STORAGE_KEYS[name], value);
  } catch {
    // Preference persistence is optional when storage is unavailable.
  }
}

function setRadioValue(name, value) {
  const input = elements.form.elements.namedItem(name);
  for (const radio of input) radio.checked = radio.value === value;
}

function getRadioValue(name) {
  return elements.form.elements.namedItem(name).value;
}

function restorePreferences() {
  setRadioValue('engine', readPreference('engine', 'google'));
  setRadioValue('language', readPreference('language', uiLanguage));
  setRadioValue('type', 'web');
  try {
    localStorage.removeItem(LEGACY_TYPE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  elements.theme.value = readPreference('theme', 'system');
  applyTheme(elements.theme.value);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  elements.themeColor.content = dark ? '#11141b' : '#f6f7fb';
}

function setError(input, errorElement, message = '') {
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  errorElement.textContent = message;
  errorElement.hidden = !message;
}

function readOptions({ showErrors = false } = {}) {
  const query = elements.query.value.trim();
  const restrictSite = elements.restrictSite.checked;
  const website = elements.website.value.trim();
  const domain = restrictSite && website ? normalizeDomain(website) : null;
  const type = getRadioValue('type');

  const queryRequired = !restrictSite;
  setError(elements.query, elements.queryError, showErrors && queryRequired && !query ? t('queryRequired') : '');
  let websiteMessage = '';
  if (restrictSite && showErrors && !website) websiteMessage = t('websiteRequired');
  else if (restrictSite && website && !domain) websiteMessage = t('websiteInvalid');
  setError(elements.website, elements.websiteError, websiteMessage);

  const valid = Boolean(query || domain) && (!restrictSite || Boolean(domain));
  return {
    valid,
    options: {
      query,
      domain,
      pdfOnly: elements.pdfOnly.checked && type !== 'images',
      engine: getRadioValue('engine'),
      language: getRadioValue('language'),
      type,
    },
  };
}

function updateFilterState() {
  const restrictSite = elements.restrictSite.checked;
  elements.siteField.hidden = !restrictSite;
  elements.website.disabled = !restrictSite;
  elements.query.required = !restrictSite;

  const duckDuckGo = getRadioValue('engine') === 'duckduckgo';
  elements.news2.disabled = duckDuckGo;
  if (duckDuckGo && getRadioValue('type') === 'news2') {
    setRadioValue('type', 'news');
  }

  const images = getRadioValue('type') === 'images';
  if (images) elements.pdfOnly.checked = false;
  elements.pdfOnly.disabled = images;
  elements.pdfHint.hidden = !images;
}

function updatePreview({ showErrors = false } = {}) {
  updateFilterState();
  const { valid, options } = readOptions({ showErrors });
  elements.copyStatus.textContent = '';

  if (!valid) {
    elements.preview.textContent = t('previewEmpty');
    elements.preview.dataset.empty = 'true';
    elements.copyButton.disabled = true;
    return null;
  }

  const url = buildSearchUrl(options).toString();
  elements.preview.textContent = url;
  delete elements.preview.dataset.empty;
  elements.copyButton.disabled = false;
  return url;
}

async function copyUrl() {
  const url = updatePreview();
  if (!url) return;

  try {
    if (navigator.clipboard?.writeText && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(elements.preview);
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = document.execCommand('copy');
      selection.removeAllRanges();
      if (!copied) throw new Error('Copy unavailable');
    }
    elements.copyStatus.textContent = t('copied');
  } catch {
    elements.copyStatus.textContent = t('copyFailed');
  }
}

function launchSearch(event) {
  event.preventDefault();
  applyQueryActions();
  const url = updatePreview({ showErrors: true });
  if (!url) {
    const invalid = elements.form.querySelector('[aria-invalid="true"]');
    invalid?.focus();
    return;
  }

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

function applyQueryActions() {
  const actions = extractQueryActions(elements.query.value);
  elements.query.value = actions.query;

  if (actions.pdfOnly) elements.pdfOnly.checked = true;
  if (actions.type === 'news2') {
    setRadioValue('engine', 'google');
    savePreference('engine', 'google');
  }
  if (actions.type) setRadioValue('type', actions.type);
  if (actions.language) {
    setRadioValue('language', actions.language);
    savePreference('language', actions.language);
  }
  if (actions.website) {
    elements.restrictSite.checked = true;
    elements.website.value = actions.website;
  }
}

function persistChangedPreference(event) {
  if (event.target.matches('input[name="engine"], input[name="language"]')) {
    savePreference(event.target.name, event.target.value);
  }
}

function updateOnlineStatus() {
  elements.offlineStatus.hidden = navigator.onLine;
}

function bindEvents() {
  elements.form.addEventListener('input', (event) => {
    persistChangedPreference(event);
    updatePreview();
  });
  elements.form.addEventListener('change', (event) => {
    persistChangedPreference(event);
    updatePreview();
  });
  elements.form.addEventListener('submit', launchSearch);
  elements.copyButton.addEventListener('click', copyUrl);
  elements.theme.addEventListener('change', () => {
    applyTheme(elements.theme.value);
    savePreference('theme', elements.theme.value);
  });
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  const handleColorSchemeChange = () => {
    if (elements.theme.value === 'system') applyTheme('system');
  };
  if (colorScheme.addEventListener) colorScheme.addEventListener('change', handleColorSchemeChange);
  else colorScheme.addListener(handleColorSchemeChange);
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

translatePage();
restorePreferences();
bindEvents();
updatePreview();
updateOnlineStatus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
