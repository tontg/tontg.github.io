import { parse } from './vendor/tldts.esm.min.js';

const GOOGLE_LANGUAGE = {
  fr: { hl: 'fr', lr: 'lang_fr' },
  en: { hl: 'en', lr: 'lang_en' },
};

const DUCKDUCKGO_REGION = {
  fr: 'fr-fr',
  en: 'us-en',
};

const GOOGLE_NEWS_LANGUAGE = {
  fr: { hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
  en: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
};

export function detectUiLanguage(languages, language) {
  const browserLanguages = languages ?? globalThis.navigator?.languages ?? [];
  const browserLanguage = language ?? (languages === undefined ? globalThis.navigator?.language : undefined);
  const candidates = [
    ...(Array.isArray(browserLanguages) ? browserLanguages : [browserLanguages]),
    browserLanguage,
  ];
  const match = candidates.find((language) => /^(fr|en)(-|$)/i.test(language ?? ''));
  return match?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function normalizeDomain(input) {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;

  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const result = parse(url.hostname, { allowPrivateDomains: true });
    return result.domain && (result.isIcann || result.isPrivate) ? result.domain : null;
  } catch {
    return null;
  }
}

export function buildSearchExpression({ query, domain = null, pdfOnly = false }) {
  const parts = [query.trim()];
  if (domain) parts.push(`site:${domain}`);
  if (pdfOnly) parts.push('filetype:pdf');
  return parts.filter(Boolean).join(' ');
}

export function buildGoogleUrl({ expression, language = 'en', type = 'web' }) {
  if (type === 'news2') return buildGoogleNewsUrl({ expression, language });

  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', expression);
  const languageParams = GOOGLE_LANGUAGE[language];
  if (languageParams) {
    url.searchParams.set('hl', languageParams.hl);
    url.searchParams.set('lr', languageParams.lr);
  }

  if (type === 'news') url.searchParams.set('tbm', 'nws');
  if (type === 'images') url.searchParams.set('udm', '2');
  return url;
}

export function buildGoogleNewsUrl({ expression, language = 'undefined' }) {
  const url = new URL('https://news.google.com/search');
  url.searchParams.set('q', expression);
  const languageParams = GOOGLE_NEWS_LANGUAGE[language];
  if (languageParams) {
    url.searchParams.set('hl', languageParams.hl);
    url.searchParams.set('gl', languageParams.gl);
    url.searchParams.set('ceid', languageParams.ceid);
  }
  return url;
}

export function buildDuckDuckGoUrl({ expression, language = 'en', type = 'web' }) {
  if (type === 'news2') throw new RangeError('News 2 is only supported by Google');

  const url = new URL('https://duckduckgo.com/');
  url.searchParams.set('q', expression);
  const region = DUCKDUCKGO_REGION[language];
  if (region) url.searchParams.set('kl', region);

  if (type === 'news') {
    url.searchParams.set('ia', 'news');
    url.searchParams.set('iar', 'news');
  } else if (type === 'images') {
    url.searchParams.set('ia', 'images');
    url.searchParams.set('iax', 'images');
  }
  return url;
}

export function buildSearchUrl(options) {
  const expression = buildSearchExpression(options);
  const builder = options.engine === 'duckduckgo' ? buildDuckDuckGoUrl : buildGoogleUrl;
  return builder({ ...options, expression });
}
