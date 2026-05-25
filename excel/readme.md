# Excel Append PWA

A 100% browser-based Apache HTTPD project for merging multiple Excel `.xls` and `.xlsx` spreadsheets.

## What it does

- Lets the user select multiple `.xls` and `.xlsx` files with a standard file input or drag and drop.
- Uses the first selected spreadsheet as the output workbook.
- Keeps the first spreadsheet's workbook content as far as the browser libraries can preserve it.
- Appends rows from every later spreadsheet's first worksheet to the first worksheet of the output workbook.
- Skips row 1 from every later spreadsheet before appending.
- Automatically downloads the result as `merged-excel-YYYYMMDD-HHMMSS.xlsx`, even when inputs include `.xls`.
- Runs entirely in the browser. No upload and no server-side code are used.
- Includes a service worker and web app manifest for PWA installation and offline reuse after the app has been loaded and cached.

## Libraries

The app uses [ExcelJS](https://github.com/exceljs/exceljs) version `4.4.0` from jsDelivr for `.xlsx` workbook handling:

```html
https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
```

ExcelJS is open source under the MIT license.

The app also uses [SheetJS Community Edition](https://github.com/SheetJS/sheetjs) package `xlsx` version `0.18.5` from jsDelivr for legacy `.xls` parsing and `.xls` base-workbook conversion:

```html
https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
```

The `xlsx` package metadata reports the Apache-2.0 license.

## Files

- `index.html` - app markup and asset references.
- `styles.css` - responsive interface styling.
- `app.js` - `.xls` / `.xlsx` file handling, workbook merge logic, and automatic download.
- `sw.js` - service worker cache for PWA behavior.
- `manifest.webmanifest` - installable PWA metadata.
- `icons/icon.svg` - app icon.
- `.htaccess` - Apache MIME types and basic headers.

## Apache HTTPD deployment

Copy this directory into any Apache-served document root or virtual host directory.

Example:

```apache
DocumentRoot "/var/www/excel-append-pwa"

<Directory "/var/www/excel-append-pwa">
    Options FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
```

The project is static and does not require PHP, Node.js, CGI, a database, or a build step.

PWA service workers require a secure context. Use HTTPS in production. `localhost` also works for local testing.

## Browser support

Use a modern browser with support for:

- File API
- Blob downloads
- Service workers
- `ArrayBuffer`
- ExcelJS browser bundle
- SheetJS browser bundle

Current Chrome, Edge, Firefox, and Safari versions support these APIs.

## Spreadsheet behavior

The first selected file controls the output workbook. Its sheets and existing content are loaded as the base workbook. Rows from row 2 onward in each later file's first worksheet are copied to the bottom of the first worksheet in the output workbook.

When the first file is `.xlsx`, ExcelJS is used as the output engine. This keeps the first `.xlsx` workbook as the structural base and copies common cell formatting for appended rows from later `.xlsx` files. Rows appended from `.xls` files are copied as values.

When the first file is `.xls`, SheetJS is used as the output engine and the result is written as `.xlsx`. This preserves worksheet values from the first workbook and appends later worksheet values. Legacy `.xls` formatting and advanced workbook features may not survive conversion.

Advanced Excel features from appended files, such as charts, macros, pivot tables, workbook-level metadata, table range expansion, and merged-cell regions, are not recreated in the appended area.

## Usage

1. Open the app in the browser.
2. Select multiple `.xls` or `.xlsx` spreadsheets.
3. The files are processed in the shown order.
4. The merged workbook downloads automatically.

## Privacy

All processing happens locally in the browser. Files are not sent to Apache or any other server by this app. The ExcelJS and SheetJS scripts are loaded from jsDelivr unless you replace them with local copies.

## Making the libraries fully local

For deployments that must not depend on a CDN, download the ExcelJS and SheetJS browser bundles and serve them from this project:

```text
vendor/exceljs.min.js
vendor/xlsx.full.min.js
```

Then change the script tags in `index.html` and the cache entries in `sw.js` from:

```text
https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
```

to:

```text
vendor/exceljs.min.js
vendor/xlsx.full.min.js
```
