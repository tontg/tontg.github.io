# Geo Camera Map Overlay

Web project for smartphones and Meta Quest browser (2D camera mode + immersive WebXR AR mode).

## Features

- Full-screen live camera view
- Bottom-right square mini-map (Leaflet + OpenStreetMap, no API key)
- Route preview before location permission (no IP lookup or API key)
- Live user location (with browser permission)
- User heading arrow on map (device orientation / compass)
- Target circles loaded from static JSON
- Camera overlay arrows to each target
- Arrow size scales as inverse square of distance
- In-range state when user enters a target radius
- Distances displayed in meters and kilometers
- Journey/track sequence support with repeated points
- Estimated planned route distance and live remaining distance
- Immersive AR rendering with Three.js on supported devices
- In-app About modal with credits/licensing links
- Internationalization (English/French) with browser auto-detect + manual switch
- Manual start position and session-scoped XR north alignment for devices without GPS/compass
- Journey pause/resume, restart, and locally saved progress
- Optional arrival sounds and phone/controller haptics
- Map-based journey editor with GPX/JSON import and JSON export
- Live sensor diagnostics in the status panel and XR HUD

## Files

- `index.html`: page structure + CDN imports
- `styles.css`: UI layout and visual styles
- `app.js`: camera, geolocation, orientation, map, journey, and XR logic
- `navigation.mjs`: validated route parsing, distance calculations, sensor freshness, and journey progression
- `journey-store.mjs`: scoped local storage for routes, progress, and feedback preferences
- `journey-tools.mjs`: journey controls, manual positioning, calibration, and diagnostics
- `route-editor.mjs`: isolated draft editor with a Leaflet map
- `gpx.mjs`: bounded GPX parser, with separate routes and track segments
- `feedback.mjs`: opt-in Web Audio and supported haptic feedback
- `xr-controls.mjs`: XR-native toolbar, controller rays, and selection handling
- `manifest.webmanifest`: install metadata for supported browsers
- `sw.js`: service worker for app-shell caching
- `data/targets.json`: editable target definitions
- `data/i18n.json`: translation strings (`en`, `fr`)
- `tests/`: dependency-free regression tests and optional browser smoke checks
- `icons/app-icon.svg`: scalable app icon used by the web manifest
- `icons/icon-192.png`, `icons/icon-512.png`: raster app icons for install surfaces
- `icons/icon-maskable-512.png`: maskable raster app icon for Android-style launchers

## Edit points and journey

Update `data/targets.json`:

```json
{
  "points": [
    { "id": "A", "latitude": 33.5645568, "longitude": -7.6563659, "radiusMeters": 5 },
    { "id": "B", "latitude": 33.5647749, "longitude": -7.6571314, "radiusMeters": 5 },
    { "id": "C", "latitude": 33.5639083, "longitude": -7.6567966, "radiusMeters": 5 }
  ],
  "journey": {
    "name": "Demo Journey",
    "sequence": ["A", "B", "C", "A", "C"]
  }
}
```

- `points`: unique waypoint definitions.
- `journey.sequence`: ordered waypoint IDs to visit (supports repeats).
- Coordinates and radii must be JSON numbers; IDs must be unique, non-empty strings; radii must be positive.
- Automatic progress advances only on a new geolocation fix inside the next point's radius while running, never on a render or language change.
- Fixes older than 20 seconds, or with reported accuracy worse than `max(25 m, point radius)`, do not advance the journey. This is a coarse-fix guard, not a guarantee of arrival accuracy.
- At most one step is accepted per fix. Consecutive repeated or overlapping points require leaving and re-entering the next radius.
- Planned distance is the sum of straight-line legs between the listed points. Remaining distance adds the current position-to-next-point leg; it is unknown until a fresh GPS or explicit manual position is available. Manual distances are estimates from a fixed position, not live tracking. These are not road/walking-route distances.

## Journey tools

Open **Journey tools** in the status panel. The same controls are translated into French.

### Pause, restart and saved progress

- **Pause journey** stops automatic progression and hides directional target arrows while the map and sensors keep updating. **Resume journey** allows the next new GPS fix to advance progress.
- **Restart journey** requires confirmation, resets to the first step, and leaves the journey paused.
- Progress is saved after an accepted step, pause/resume, restart, and page exit. Restored journeys always start paused so they cannot silently advance on reopening.
- Saves are tied to the exact route definition. Editing coordinates, radii, IDs, or step order invalidates progress for the old definition.
- A custom route, progress, and sound/haptic preferences remain in local browser storage for this app path. GPS positions, manual position, compass readings, and north calibration are not restored.
- If storage is blocked or full, a warning appears; navigation still works for the current visit. Clearing browser/site data removes these saves.

### Manual position and Quest alignment

1. Before entering AR, open **Journey tools**. Enter latitude/longitude, copy a waypoint, or use **Pick on map**, then explicitly select **Use manual position**.
2. Select the known bearing you will face: `0` for north or `90` for east. Use a reliable external reference; the app cannot discover true north from headset tracking alone.
3. Press **Align in AR**, then **Enter AR**. After the first tracked headset pose, a three-second countdown appears. Face the chosen bearing and hold still until alignment completes.
4. Use the XR **Align in AR** button to repeat calibration during the session. Tracking-reference resets invalidate alignment; recalibrate if directions drift.

Manual position stays fixed even if GPS callbacks arrive. It never auto-completes steps. When you physically reach the next point, **Confirm arrival (manual)** accepts exactly one step and moves the manual estimate to that point. For other movements, exit AR and update the manual position. **Use GPS** explicitly switches back to live fixes.

XR-native buttons are available without `dom-overlay`: pause/resume, restart, manual arrival, alignment, sound, and haptics. Aim a tracked controller/hand ray at a button and select; a cyan ray appears on a hit. Restart and manual arrival require a second selection within five seconds. The ordinary tools/editor dialogs are for use outside immersive AR.

### Arrival feedback and diagnostics

- Sound and haptics are off by default. Enable them in Journey tools and press **Test feedback**, or enable them through the XR toolbar.
- Arrival plays a short two-tone signal; journey completion plays three tones. Vibrations use the phone vibration API or XR controller haptic actuators when available. A browser may block audio or omit vibration support, including on iOS; unsupported feedback does not interrupt navigation.
- **Sensor diagnostics** reports position source, accuracy, reading age, compass availability, XR north alignment source, and the last feedback result. The native XR HUD also shows position accuracy/age and alignment source.
- Manual position is always identified as an estimate. Manual north alignment is not presented as high-confidence sensor data.

### Visual editor and GPX import

- Open **Edit / import journey**. Click the map to add points, drag markers, or edit coordinates, names and radii using **Save point**. Delete a point to remove its references from the draft.
- Append an existing point repeatedly to revisit it. Use the step list to reorder or remove visits. The route line and planned distance update with the draft.
- Import a GPX or targets JSON file, select the desired route/track segment/waypoint list, and load it into the draft. GPX 1.0/1.1 routes, track segments, and standalone waypoints are supported. Separate tracks/segments are never silently connected.
- GPX points receive a default 5 m radius and unique IDs. Each imported point becomes a required step. Files are limited to 2 MB, 500 points per route/segment, and 1000 journey steps; simplify dense recorded tracks before importing. DTD/entity declarations, malformed XML and invalid coordinates are rejected.
- **Apply journey** requires confirmation, saves the custom route locally, resets progress and pauses the journey. Closing the editor without applying leaves the active route untouched.
- **Download targets.json** exports the draft in the existing editable JSON format. The website cannot overwrite the repository's `data/targets.json`; deploy the exported file yourself if it should become the shared default.
- **Use configured route** discards the custom route and restores the `data/targets.json` definition loaded for this visit, with progress reset and paused.

## Run

Use HTTPS (mandatory for camera/geolocation/orientation on mobile browsers):

1. Serve this folder with any HTTPS-capable static server.
2. Open the page on iOS/Android/Quest browser.
3. Tap `Start experience` and grant permissions.

## PWA

- `manifest.webmanifest` enables installability on browsers that support PWAs.
- The manifest includes PNG icons because some browsers and OS install flows ignore SVG-only icon sets.
- `sw.js` revalidates app files and route data, with a cached fallback when offline. Pinned CDN libraries are cached after use; a first-ever offline visit cannot load them.
- Cache names include the application scope. Cleanup leaves unrelated applications' caches intact.
- Map tiles are fetched on demand, not downloaded for offline use. The XR image cache holds at most 64 tiles.
- Camera and geolocation depend on browser/device support and permissions, not an application server. Map/CDN downloads need network access unless already browser-cached.
- Update both `APP_VERSION` in `app.js` and the cache version in `sw.js` when releasing. Version `0.8.0` appears in both the status panel and XR-native HUD.
- When upgrading from the old cache-first worker, reload after the new worker installs. If the old version persists, close and reopen this application's tabs.

## Privacy and security

- No IP-geolocation request is made. Before permission, the map previews the configured points without treating them as the user's position.
- The previously embedded Abstract API credential has been removed. **Revoke or rotate that credential in the provider account**; removing it from this folder cannot invalidate published copies or repository history.
- Camera frames and precise coordinates are not uploaded by the application. OSM tile requests reveal the viewed map area to the tile provider; CDN/tile providers also see ordinary request metadata such as IP addresses.
- Waypoint names are rendered as text, not HTML. The page includes a restrictive content security policy, and Leaflet assets retain their integrity hashes.
- Camera tracks and the geolocation watch are released when leaving the page. Immersive XR stops the ordinary camera stream and restores it on exit if it was previously active.
- The deployment must serve HTTPS. Consider response headers such as HSTS and `frame-ancestors` at the hosting layer; these cannot be fully enforced by this static page's CSP meta tag.

## Internationalization

- Language auto-detect uses browser language (`fr*` => French, otherwise English).
- Manual switch is available in the status panel.
- The selected language is remembered locally when browser storage is available.
- All translations are in `data/i18n.json`.

## Notes

- On iOS, orientation permission is requested after user interaction.
- Permission denial does not prevent unrelated features: location/map tracking can work without the camera; immersive AR can start without geolocation.
- Relative orientation and GPS travel direction are not treated as a compass. Missing or stale compass readings hide phone/map direction arrows.
- WebXR status is shown in the HUD.
- Immersive AR loads the pinned `Three.js` module on demand. It is not downloaded for ordinary smartphone startup.
- The yellow XR arrow points to the next journey step. It follows a waist estimate derived from headset position/yaw and remains horizontal, rather than inheriting head pitch/roll. This is not body tracking.
- Geographic XR directions require an initial compass reference or explicit manual north alignment. Until one is available, directional arrows remain hidden rather than falsely pointing straight ahead.
- If `dom-overlay` is unsupported on a headset, HTML panels may not appear in immersive AR; XR-native overlays still work.
- Browser-independent tests and desktop sensor mocks do not replace iOS, Android and Quest hardware testing.

## Verification

Run the zero-dependency tests with Node.js 20 or newer:

```sh
node --test tests/navigation.test.mjs tests/service-worker.test.mjs tests/features.test.mjs
node --check app.js
node --check sw.js
```

The optional `tests/browser-smoke.mjs` requires Playwright Core and a local Chrome installation. Set `PLAYWRIGHT_MODULE` to an installed `playwright-core` directory if it is not available through normal Node resolution. Set `TEST_ASSET_DIR` to a directory containing the pinned CDN assets, downloaded unchanged:

- `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`
- `https://unpkg.com/three@0.162.0/build/three.module.js`

Run `node tests/browser-smoke.mjs`. Set `TEST_BROWSER=webkit` to run the same suite in an installed Playwright WebKit build. The test starts a loopback-only server, intercepts CDN/tile requests, and simulates sensors and XR poses without requesting real camera/location access. It covers layout, translation, permissions, safe waypoint text, compass gating, XR waist positioning/cleanup, native toolbar ray selection, GPX validation, editor interactions, import/export, manual positioning, pause/restart, and restored progress. It is not a full immersive WebXR test or a network-performance benchmark.

## Credits

- Coded with GPT-5.3-Codex
- License: Apache License, Version 2.0
- Map data: OpenStreetMap contributors
- Map library: Leaflet
- 3D/XR library: Three.js
- Favicon source: https://www.flaticon.com/free-icon/path-a-to-b_106147
