# Search Builder PWA

A small bilingual (French/English) static PWA for composing focused Google and DuckDuckGo searches. It supports locale-neutral searches, Google News searches, domain and PDF filters, and an offline application shell.

## Run locally

Serve the repository root with any static HTTP server. For example:

```sh
npx http-server .
```

Then open the local URL printed by the server. Service workers require a secure context: browsers treat `localhost` as secure; use HTTPS when deploying to a public hostname.

Apache HTTPD can serve these files directly—there is no rewrite rule, backend, build step, or CDN dependency.

## Verify

```sh
npm install
npm test
npm run check
```

The browser copy of `tldts` is vendored in `vendor/` so Public Suffix List domain normalization also works offline. When updating `tldts`, replace that ESM bundle and bump `CACHE_NAME` in `sw.js`.
