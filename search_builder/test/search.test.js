import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDuckDuckGoUrl,
  buildGoogleNewsUrl,
  buildGoogleUrl,
  buildSearchExpression,
  detectUiLanguage,
  normalizeDomain,
} from '../search.js';

test('normalizes URLs and hostnames to their registrable domain', () => {
  const cases = [
    ['https://www.example.com/foo', 'example.com'],
    ['news.example.com', 'example.com'],
    ['https://foo.bar.example.co.uk/a?b=1', 'example.co.uk'],
    ['example.fr', 'example.fr'],
    ['https://news.lemonde.fr/article', 'lemonde.fr'],
    ['https://example.com:8443/path?q=one#part', 'example.com'],
    ['project.github.io/docs', 'project.github.io'],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeDomain(input), expected, input);
});

test('rejects values without a valid registrable domain', () => {
  for (const value of ['', 'localhost', 'not a domain', 'https://', '127.0.0.1', 'foo.invalidtld', 'mailto:user@example.com']) {
    assert.equal(normalizeDomain(value), null, value);
  }
});

test('builds human-readable search expressions', () => {
  assert.equal(buildSearchExpression({ query: 'casablanca' }), 'casablanca');
  assert.equal(buildSearchExpression({ query: 'casablanca', domain: 'lemonde.fr' }), 'casablanca site:lemonde.fr');
  assert.equal(buildSearchExpression({ query: 'casablanca', pdfOnly: true }), 'casablanca filetype:pdf');
  assert.equal(
    buildSearchExpression({ query: 'casablanca', domain: 'lemonde.fr', pdfOnly: true }),
    'casablanca site:lemonde.fr filetype:pdf',
  );
  assert.equal(buildSearchExpression({ query: '', domain: 'lemonde.fr' }), 'site:lemonde.fr');
});

test('builds Google Web, News, Images, and locale-neutral URLs', () => {
  const web = buildGoogleUrl({ expression: 'casablanca', language: 'en', type: 'web' });
  assert.equal(web.origin + web.pathname, 'https://www.google.com/search');
  assert.equal(web.searchParams.get('q'), 'casablanca');
  assert.equal(web.searchParams.get('hl'), 'en');
  assert.equal(web.searchParams.get('lr'), 'lang_en');
  assert.equal(web.searchParams.has('tbm'), false);
  assert.equal(web.searchParams.has('udm'), false);

  const news = buildGoogleUrl({ expression: 'casablanca', language: 'fr', type: 'news' });
  assert.equal(news.searchParams.get('tbm'), 'nws');
  assert.equal(news.searchParams.get('q'), 'casablanca');
  assert.equal(news.searchParams.get('hl'), 'fr');
  assert.equal(news.searchParams.get('lr'), 'lang_fr');

  const images = buildGoogleUrl({ expression: 'casablanca', language: 'en', type: 'images' });
  assert.equal(images.searchParams.get('udm'), '2');
  assert.equal(images.searchParams.has('tbm'), false);

  const undefinedLanguage = buildGoogleUrl({ expression: 'casablanca', language: 'undefined', type: 'web' });
  assert.equal(undefinedLanguage.searchParams.has('hl'), false);
  assert.equal(undefinedLanguage.searchParams.has('lr'), false);
});

test('builds Google News 2 URLs for English, French, and undefined language', () => {
  const english = buildGoogleNewsUrl({ expression: 'casablanca', language: 'en' });
  assert.equal(english.origin + english.pathname, 'https://news.google.com/search');
  assert.equal(english.searchParams.get('q'), 'casablanca');
  assert.equal(english.searchParams.get('hl'), 'en-US');
  assert.equal(english.searchParams.get('gl'), 'US');
  assert.equal(english.searchParams.get('ceid'), 'US:en');

  const french = buildGoogleUrl({ expression: 'casablanca', language: 'fr', type: 'news2' });
  assert.equal(french.origin + french.pathname, 'https://news.google.com/search');
  assert.equal(french.searchParams.get('hl'), 'fr');
  assert.equal(french.searchParams.get('gl'), 'FR');
  assert.equal(french.searchParams.get('ceid'), 'FR:fr');

  const undefinedLanguage = buildGoogleNewsUrl({ expression: 'casablanca', language: 'undefined' });
  assert.equal(undefinedLanguage.searchParams.has('hl'), false);
  assert.equal(undefinedLanguage.searchParams.has('gl'), false);
  assert.equal(undefinedLanguage.searchParams.has('ceid'), false);
});

test('builds DuckDuckGo Web, News, Images, and locale-neutral URLs', () => {
  const web = buildDuckDuckGoUrl({ expression: 'casablanca', language: 'fr', type: 'web' });
  assert.equal(web.origin + web.pathname, 'https://duckduckgo.com/');
  assert.equal(web.searchParams.get('q'), 'casablanca');
  assert.equal(web.searchParams.get('kl'), 'fr-fr');
  assert.equal(web.searchParams.has('ia'), false);

  const news = buildDuckDuckGoUrl({ expression: 'casablanca', language: 'en', type: 'news' });
  assert.equal(news.searchParams.get('ia'), 'news');
  assert.equal(news.searchParams.get('iar'), 'news');
  assert.equal(news.searchParams.get('kl'), 'us-en');

  const images = buildDuckDuckGoUrl({ expression: 'casablanca', language: 'en', type: 'images' });
  assert.equal(images.searchParams.get('ia'), 'images');
  assert.equal(images.searchParams.get('iax'), 'images');

  const undefinedLanguage = buildDuckDuckGoUrl({ expression: 'casablanca', language: 'undefined', type: 'web' });
  assert.equal(undefinedLanguage.searchParams.has('kl'), false);
  assert.throws(
    () => buildDuckDuckGoUrl({ expression: 'casablanca', language: 'en', type: 'news2' }),
    /only supported by Google/,
  );
});

test('detects supported UI languages and falls back to English', () => {
  assert.equal(detectUiLanguage(['fr-CA', 'en-US']), 'fr');
  assert.equal(detectUiLanguage(['de-DE', 'en-GB']), 'en');
  assert.equal(detectUiLanguage([], 'fr-FR'), 'fr');
  assert.equal(detectUiLanguage(['de-DE']), 'en');
  assert.equal(detectUiLanguage([]), 'en');
});
