# Geo Camera Map Overlay

Simple web project for smartphones and WebXR-capable browsers (2D overlay mode).

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

## Files

- `index.html`: page structure + CDN imports
- `styles.css`: UI layout and visual styles
- `app.js`: camera, geolocation, orientation, map, and overlay logic
- `data/targets.json`: editable target definitions

## Edit target positions

Update `data/targets.json`:

```json
{
  "targets": [
    { "id": "target-1", "latitude": 33.5645568, "longitude": -7.6563659, "radiusMeters": 5 }
  ]
}
```

## Run

Use HTTPS (mandatory for camera/geolocation/orientation on mobile browsers):

1. Serve this folder with any HTTPS-capable static server.
2. Open the page on iOS/Android/Quest browser.
3. Tap `Start experience` and grant permissions.

## Notes

- On iOS, orientation permission is requested after user interaction.
- WebXR status is shown in the HUD; current implementation uses 2D overlays.
