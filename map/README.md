# Geo Camera Map Overlay

Web project for smartphones and Meta Quest browser (2D camera mode + immersive WebXR AR mode).

## Features

- Full-screen live camera view
- Bottom-right square mini-map (Leaflet + OpenStreetMap, no API key)
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
- `data/targets.json`: editable target definitions
- `data/i18n.json`: translation strings (`en`, `fr`)

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
- Favicon source: https://www.flaticon.com/free-icon/path-a-to-b_106147
