# Vendored Artifacts

`manifest.json` records source URLs, versions/revisions, licenses and SHA-256
checksums. URLs are maintainer references, not runtime requests. The application
loads only local assets. Full license texts are distributed alongside them.

## jsQR 1.4.0

Two local changes expose error correction metadata without changing decoding:

1. The public result includes `errorCorrectionLevel: decoded.errorCorrectionLevel`.
2. After `decodeData_1.decode(resultBytes, version.versionNumber)`, assign
   `decoded.errorCorrectionLevel = formatInfo.errorCorrectionLevel` before returning.

Values are `0=L`, `1=M`, `2=Q`, `3=H`. Preserve these changes on upgrade and run
the QR round-trip/metadata tests. They are modifications by this project, not
features asserted to be present in the upstream distribution.

## OpenCV

The retained single-file bundle reports version `4.14.0-pre`, source revision
`723670c33d748f481ebead9d7f12a6a83382b043`, and build timestamp
`2026-04-14T04:08:02Z`. Its source URL was a rolling documentation build.
Its exact build recipe was not retained; the committed artifact and SHA-256
checksum are the reproducible distribution, not a promise of reproducible
compilation. A small runtime hook maps `Mat.clone` to `Mat.mat_clone` when present.

The build reports zlib 1.3.1, Protobuf 3.19.1, and FlatBuffers 25.9.23; their
upstream notices are included. It contains embedded WASM and needs no separate
WASM download. Its legacy Embind glue uses JavaScript `Function`, so its worker
needs the narrowly scoped CSP exception documented in SECURITY.md.

## Lookup Tables

Run `pwsh tools/generate-lookups.ps1` to regenerate all four lookups from pinned
commits. It uses standard JSON/CSV parsers, ordinal key ordering, UTF-8 without
BOM and LF line endings. It never runs as part of the browser application.
Then run `node tools/audit.mjs --write` and inspect the data/hash changes.

For an update, deliberately change the source revision in both the generator
and manifest, regenerate, inspect differences, update notices if necessary,
run tests, and bump the service-worker cache version. Do not fetch `latest`
versions automatically during deployment.
