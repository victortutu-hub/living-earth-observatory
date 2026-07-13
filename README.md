# Luminomorphism: Orbital Data Atlas

Luminomorphism is a source-available generative science-art platform for
traceable, data-grounded observatories. Each visible layer is classified as
observed data, a documented physical model, a declared interpretation, or a
fallback. The Orbital Data Atlas is the public entry point for this network.

The first production observatory is **Living Earth**: a WebGL/Three.js
cinematic Earth that combines a physically styled 3D planet with near-real-time
natural-disaster signals. **Living Protein V0.1** is the second live
observatory: a single-molecule view built from AlphaFold structure predictions,
per-residue model confidence, and UniProt functional annotations. Its data
model is explicitly prediction-derived rather than experimental structure data.

Public landing page:

```text
index.html
```

Main Earth observatory entry point:

```text
earth-eonet-relief.html
```

Living Protein V0.1 entry point:

```text
living-protein.html
```

The current version includes the `Showcase reel` preset, `Data sources` panel, 9:16 video export, synchronized single-card reel pacing, restored intro card layout, atomic state restore after Demo reel, Vertical Director, caption system, Data Rhythm Camera, Moon/Earthshine reel moment, ISS trail, and controllable subtle atmospheric phenomena. 

## Local Run

From the project root:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open the landing page:

```text
http://127.0.0.1:8765/
```

Or open the Earth observatory directly:

```text
http://127.0.0.1:8765/earth-eonet-relief.html
```

To avoid browser cache during development, append a query string:

```text
http://127.0.0.1:8765/earth-eonet-relief.html?dev=1
```

### Local Proxy For GDACS / FIRMS / H.264

Some upstream data sources do not expose browser-friendly CORS headers. The local proxy keeps the browser app clean while allowing server-to-server requests to GDACS, NASA FIRMS, and NASA EONET fallback endpoints.

```bash
node nasa-proxy-server.js
```

For NASA FIRMS, copy `.env.example` to `.env` and set:

```text
FIRMS_MAP_KEY=your_firms_map_key_here
```

The real key stays local. `.env` and `proxy-cache/` are ignored by Git.

## Observatory Network

### Living Earth Observatory

- Renders a 3D Earth with relief and bathymetry based on ETOPO-style local textures.
- Loads natural events from NASA EONET.
- Uses GDACS as an intelligent fallback or temporary primary data source.
- Integrates USGS earthquakes into the shared `Earthquakes` category.
- Adds NASA FIRMS wildfire hotspots through the local proxy.
- Supports NASA GIBS daily cloud snapshots.
- Renders NOAA SWPC OVATION aurora as a restrained polar oval.
- Synchronizes day/night lighting with the real solar position.
- Provides `dot` and `physical` atmosphere modes.
- Includes the Moon with real position, phase, distance, orientation/libration, lunar relief, and Earthshine.
- Includes ISS telemetry, tracking, and a subtle data-driven orbital trail.
- Includes Airglow, Zodiacal Light, and Noctilucent Clouds as physically grounded procedural phenomena with toggles, presets, and intensity sliders.
- Exports still PNGs and vertical 9:16 reel videos.

### Living Protein V0.1

- Loads AlphaFold DB prediction metadata and the corresponding PDB structure.
- Parses only C-alpha atoms, preserving chain boundaries and residue gaps so
  the trace never invents a connection across missing structure.
- Uses AlphaFold's official pLDDT bands for trace colour. pLDDT is always
  presented as **model confidence**, not experimental measurement.
- Loads selected UniProt features and reports the pLDDT mean together with
  residue coverage for each feature.
- Keeps a documented procedural fallback visible when AlphaFold DB or UniProt
  cannot be reached; remote data failure never becomes a fabricated live state.

## Data Sources

- NASA EONET: near-real-time natural event metadata.
- GDACS: EU JRC / UN OCHA global disaster alerts, used as fallback or GDACS-only mode.
- NASA FIRMS: MODIS/VIIRS wildfire hotspots, optional through the local proxy and `FIRMS_MAP_KEY`.
- NASA GIBS: daily cloud snapshot, not minute-by-minute live clouds.
- USGS: earthquake feed, normalized into local `earthquakes` events.
- NOAA SWPC OVATION: aurora forecast, used to drive polar oval intensity.
- NOAA/ETOPO-derived relief assets: local relief and normal-map textures.
- Astronomy Engine: apparent solar position, solar clock, Moon position, phase, distance, and astronomical geometry.
- TLE/SGP4: ISS position and orbital tracking.
- Airglow: real upper-atmosphere emission phenomenon; procedural intensity, not a live snapshot.
- Zodiacal Light: sunlight scattered by interplanetary dust, approximated along the ecliptic.
- Noctilucent Clouds: real seasonal, latitude, and twilight window; procedural morphology.
- AlphaFold DB / EMBL-EBI: predicted protein structures and per-residue pLDDT
  confidence values. These are model predictions, not experimental structures.
- UniProt: curated protein names and functional feature annotations.

Important local assets:

```text
assets/etopo2022-bedrock-relief-2160x1080.png
assets/etopo2022-bedrock-normal-2160x1080.png
```

## Main Modules

### Bootstrap And Runtime

- `src/earth/scene-runtime.js` creates the scene, renderer, camera, controls, and composer.
- `src/earth/earth-app-bootstrap.js` loads textures and prepares the initial scene.
- `src/earth/app-services.js` connects the main application services.
- `src/earth/app-runtime.js` starts lifecycle hooks, UI wiring, the animation loop, and demo reel runtime.
- `src/earth/app-state.js` defines the initial state and default preset.
- `src/earth/scene-runtime.js` uses `EffectComposer` with `UnrealBloomPass`, `SMAAPass`, and `OutputPass`.

### Planet, Light, And Atmosphere

- `src/earth/app-visual-foundation.js` composes the visual foundation: geo utilities, event utilities, solar runtime, Earth layers, stars, and clouds.
- `src/earth/earth-layers.js` creates the Earth, night lights, and atmosphere meshes.
- `src/earth/earth-material.js`, `earth-look.js`, and `earth-appearance.js` control materials and look presets.
- `src/earth/atmosphere.js` contains the `dot` and `physical` atmosphere modes.
- `src/earth/solar-runtime.js` and `solar-system.js` compute solar position and solar clock values.

### EONET / Multi-Source Data And UI

- `src/earth/eonet-data.js` loads NASA EONET, supplemental providers, and GDACS fallback.
- `src/earth/eonet-ui.js` renders the event list, Today on Earth, details panel, and filters.
- `src/earth/eonet-workflow.js` coordinates load, filter, and selection behavior.
- `src/earth/event-scene.js`, `marker-system.js`, and `polygon-overlays.js` render markers, clusters, and polygon overlays. The stable path keeps individual meshes for EONET/highlights and uses a `Points` shader layer for dense USGS earthquake background events.
- `src/earth/gdacs-provider.js`, `firms-wildfires.js`, and `usgs-earthquakes.js` normalize alternative sources into the shared event model.

### Live Layers

- `src/earth/live-data-layers.js` connects USGS, NASA FIRMS, and NOAA aurora.
- `src/earth/usgs-earthquakes.js` converts the USGS feed into events compatible with the EONET UI.
- `src/earth/noaa-aurora-layer.js` creates the polar aurora oval from NOAA intensity data.
- `src/earth/iss-system.js` calculates ISS position and renders the orbital trail.
- `src/earth/moon-system.js` calculates the Moon, phase, libration/orientation, textures, relief, and Earthshine.
- `src/earth/airglow-system.js`, `zodiacal-light-system.js`, and `noctilucent-cloud-system.js` add subtle atmospheric and astronomical phenomena with controllable intensity.

### Reel And Export

- `src/earth/reel-timeline.js` controls the Demo reel: intro, events, Moon/Earthshine moment, outro, and restore.
- `src/earth/reel-overlay.js` draws cards, captions, locator line, and signal pulse.
- `src/earth/reel-presets.js` contains mood and motion presets.
- `src/earth/vertical-director.js`, `caption-system.js`, and `data-rhythm-camera.js` control 9:16 composition, social text, and data-driven camera rhythm.
- `src/earth/export-system.js` exports PNG and 9:16 video using the same bloom and SMAA polish as the interactive scene.

### Living Protein

- `src/protein/protein-data.js` fetches and normalizes AlphaFold DB and UniProt data.
- `src/protein/protein-geometry.js` parses PDB C-alpha atoms and splits valid
  contiguous trace segments.
- `src/protein/protein-analysis.js` cross-references UniProt features with
  model-confidence coverage.
- `src/protein/protein-scene.js` renders the molecule and manages camera
  framing and interaction.
- `src/protein/protein-app.js` connects provenance UI, fallback behavior, and
  the Protein observatory page.

## Important Presets

### Default

On startup, the application uses:

- `Cinematic Earth`
- `Cinematic mood`
- `Atmosphere: physical`
- `Daily clouds: off`
- `USGS quakes: off`
- `Aurora: off`

### Showcase Reel

The `Showcase reel` button prepares a social/reel-friendly state:

- `Reel duration: 24s`
- `Cinematic mood`
- `Showcase Earth`
- `Atmosphere: physical`
- `Slow orbit`
- `Guide 9:16: on`
- `Fit 9:16`

It does not force `Brand: on`; branding remains the user's choice.

### Demo Reel

The `Demo reel` button starts the publishable export:

- temporarily applies a cinematic/showcase look;
- uses physical atmosphere;
- runs an editorial tour through selected events;
- includes the Moon/Earthshine moment when enabled by the current reel mode;
- exports a 1080x1920 video;
- displays export progress;
- restores the initial state after completion.

Demo reel restore preserves:

- reel duration;
- brand/capture state;
- motion preset;
- Earth look;
- atmosphere mode;
- reel mood;
- spin speed;
- snap duration;
- night look.

## Recommended Reel Workflow

1. Start the local server.
2. Open `earth-eonet-relief.html`.
3. Press `Showcase reel`.
4. Choose `Brand: on/off`.
5. Verify framing in the 9:16 guide.
6. Press `Demo reel`.
7. Wait for the export to reach 100%.
8. Review the downloaded `.webm` file.

## Backup / Freeze

The current stable baseline is:

```text
releases/living-earth-observatory-v2.4.2-geographic-integrity-fix-20260709
```

This snapshot includes:

- multi-source data layer: EONET, GDACS, USGS, FIRMS;
- corrected EONET polygon coordinate normalization for GDACS-derived flood polygons delivered through NASA EONET;
- geographic marker/card integrity for polygon centroids, including New Zealand, Australia, Finland, Ecuador, and similar flood signals;
- local proxy with `.env` support for FIRMS and local cache;
- Moon V2.1+ with phase, distance, libration, Earthshine, relief, and switchable textures;
- ISS tracking and subtle visual trail;
- Zodiacal Light, Noctilucent Clouds, and Airglow with toggle/preset/intensity controls;
- Showcase reel, Vertical Director, captions, and Data Rhythm Camera;
- atomic restore for Demo reel and 9:16 video export.

V2.4.2 note: NASA EONET polygon geometries used by some GDACS-linked flood events can arrive as `[lat, lon]` coordinate pairs, while point geometries remain GeoJSON-style `[lon, lat]`. The event normalization layer now handles both points and polygons before centroid calculation, so markers, Today on Earth cards, Select Event details, and camera targeting stay geographically aligned.

## Development Notes

- The project is modularized; avoid large changes directly in the HTML file.
- For visual edits, prefer the modules in `src/earth`.
- For external data, keep fallback behavior and status messages explicit.
- For reels, always test in 9:16 and verify text-safe margins.
- After a stable milestone, create a new snapshot under `Back Up`.
- Do not describe AlphaFold pLDDT as measured biological certainty. It is a
  prediction-confidence signal and must remain explicitly labelled.

## License

This repository is source-available for viewing, evaluation, portfolio review,
research discussion, and personal learning. It is not released under MIT or
another permissive open-source license.

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for usage terms, source
attribution, and third-party data/asset notes.
