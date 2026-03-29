# Geo Camera Map Overlay

Web project for smartphones and Meta Quest browser (2D camera mode + immersive WebXR AR mode).

## Features

- Full-screen live camera view
- Bottom-right square mini-map (Leaflet + OpenStreetMap, no API key)
- Approximate pre-permission map centering via `https://ipwho.is/`
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

## Files

- `index.html`: page structure + CDN imports
- `styles.css`: UI layout and visual styles
- `app.js`: camera, geolocation, orientation, map, journey, and XR logic
- `manifest.webmanifest`: install metadata for supported browsers
- `sw.js`: service worker for app-shell caching
- `data/targets.json`: editable target definitions
- `data/i18n.json`: translation strings (`en`, `fr`)
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
- Progress auto-advances when the user enters the radius of the next required point.

## Run

Use HTTPS (mandatory for camera/geolocation/orientation on mobile browsers):

1. Serve this folder with any HTTPS-capable static server.
2. Open the page on iOS/Android/Quest browser.
3. Tap `Start experience` and grant permissions.

## PWA

- `manifest.webmanifest` enables installability on browsers that support PWAs.
- The manifest includes PNG icons because some browsers and OS install flows ignore SVG-only icon sets.
- `sw.js` caches the local app shell for faster reloads and limited offline startup.
- Camera, geolocation, map tiles, and the `ipwho.is` lookup still require network/device support at runtime.

## Approximate location fallback

- Before explicit geolocation is granted, the app tries `https://ipwho.is/` to get an approximate IP-based latitude/longitude.
- This is only used to center the map roughly while waiting for a real browser geolocation fix.
- When real geolocation arrives, it replaces the IP-based position immediately.
- The `ipwho.is` request is best-effort and can fail because of network policy, CORS, privacy tooling, or timeout without breaking the app.

## Internationalization

- Language auto-detect uses browser language (`fr*` => French, otherwise English).
- Manual switch is available in the status panel.
- All translations are in `data/i18n.json`.

## Notes

- On iOS, orientation permission is requested after user interaction.
- WebXR status is shown in the HUD.
- Immersive AR uses `Three.js`.
- If `dom-overlay` is unsupported on a headset, HTML panels may not appear in immersive AR; XR-native overlays still work.

## Credits

- Coded with GPT-5.3-Codex
- License: Apache License, Version 2.0
- Map data: OpenStreetMap contributors
- Map library: Leaflet
- 3D/XR library: Three.js
- Approximate geolocation bootstrap: ipwho.is
- Favicon source: https://www.flaticon.com/free-icon/path-a-to-b_106147
