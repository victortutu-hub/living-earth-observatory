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
**Living Himalaya** is a live regional observatory, entered from the Earth
globe (see below).

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

Living Himalaya (development) entry point:

```text
living-himalaya.html
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

### Local Proxy For GDACS / FIRMS / GVP / History / H.264

Some upstream data sources do not expose browser-friendly CORS headers. The local proxy keeps the browser app clean while allowing server-to-server requests.

```bash
node nasa-proxy-server.js
```

- Binds to `HOST`, default `127.0.0.1` (loopback only); `PORT` is a TCP port locally or a socket path under Passenger (cPanel), where no `HOST` is used.
- Routes: `/nasa-proxy?source=eonet|gdacs|firms|gvp`, plus the historical days `source=firms-day&date=YYYY-MM-DD` (MODIS NRT or SP), `source=wind-day&date=…` (ERA5 through the Open-Meteo Archive API) and `source=currents-day&date=…` (SMOC through the Open-Meteo Marine API).
- `POST /convert-h264` (WebM → MP4 through a local FFmpeg) is **off by default**: it is enabled only with `H264_ENABLED=1`, set locally, never on the server; otherwise the route answers `404`. Limits: `H264_MAX_CONCURRENT` (default 1; a second conversion gets `429`), `H264_TIMEOUT_MS` (default 5 minutes, then FFmpeg is killed) and `H264_MAX_INPUT_BYTES` (default 300 MB).

For NASA FIRMS, copy `.env.example` to `.env` and set:

```text
FIRMS_MAP_KEY=your_firms_map_key_here
```

The real key stays local. `.env` and `proxy-cache/` are ignored by Git.

## Observatory Network

### Living Earth Observatory

- Renders a 3D Earth with linear relief (×10) from NOAA ETOPO 2022 (60″ ice surface, area-averaged 1/6°) and a NASA MODIS MOD44W water mask.
- Loads natural events from NASA EONET.
- Uses GDACS as an intelligent fallback or temporary primary data source.
- Integrates USGS earthquakes into the shared `Earthquakes` category.
- Adds NASA FIRMS wildfire hotspots through the local proxy.
- Shows the NASA GIBS Blue Marble surface and the observed VIIRS Black Marble annual night lights (2016), with local fallbacks. The NASA GIBS daily cloud snapshot is **temporarily paused** (`DAILY_CLOUDS_ENABLED = false` in `src/earth/cloud-system.js`); a procedural cloud layer is shown instead.
- Loads the relief as KTX2 (R16F metres + Zstd) by default; append `?noktx2` only to exercise the raw `.r16f.bin` fallback.
- No Service Worker is active (see “Offline And Cache Behaviour”).
- Optional layers: wind particles (Open-Meteo; `prediction` live, ERA5 `reconstructed` for past days), ocean currents (Open-Meteo Marine; `prediction` live, SMOC `physical-model` for past days), Smithsonian GVP volcanoes (`observed`, catalog as published today) and Snow & ice (NASA GIBS MODIS Terra NDSI, `observed`, daily).
- Historical timeline (one UTC day, up to a year back) — see “Historical Timeline”.
- Renders NOAA SWPC OVATION aurora as a restrained polar oval.
- Synchronizes day/night lighting with the real solar position.
- Provides `dot` and `physical` atmosphere modes.
- Includes the Moon with real position, phase, distance, orientation/libration, lunar relief, and Earthshine.
- Includes ISS telemetry, tracking, and a subtle data-driven orbital trail.
- Includes Airglow, Zodiacal Light, and Noctilucent Clouds as physically grounded procedural phenomena with toggles, presets, and intensity sliders.
- Exports still PNGs and vertical 9:16 reel videos.

### Living Himalaya (development)

- A regional observatory entered from a summit marker on the Earth globe: the 14 eight-thousanders and 6 selected Nepal peaks (cited reference list, `observed`; official elevations shown apart from DEM values).
- Terrain: Copernicus DEM GLO-30, 20 × 20 km around each summit (`reconstructed`, bundled KTX2 patches), with AWS Terrain Tiles (Terrarium, `reconstructed`) for the overview.
- Satellite mode: the latest clear Sentinel-2 L2A scene in the last 30 days (`observed`, with its date and cloud share).
- Summit weather: Open-Meteo NOAA GFS 0.25° pressure levels interpolated to the summit height (`prediction`).
- Sun and Moon: Astronomy Engine (`physical-model`); moonlight brightness is exaggerated for visibility and labelled.
- History: per-peak aggregates from The Himalayan Database (`reported`: compiled from expedition accounts, not measurements), only for the peaks it covers; other peaks say so explicitly.
- Routes & camps (opt-in, both switches off by default; nothing is loaded until one is turned on): Everest South Col and North Col routes drawn on the GLO-30 patch (`interpretive`: through the reported camps and named features, not GPS tracks; the Tibet route is dashed), and base/high camps for Everest, Lhotse, K2, Manaslu and Ama Dablam (positions `reported` by OpenStreetMap / Wikidata). Each camp shows its reported elevation with the source next to GLO-30 at the same point; differences above 50 m are flagged, above 150 m the camp is listed only. Camps without published coordinates or outside the detailed terrain are listed only; glacier camps move from season to season; hidden in the Terrarium overview. Other peaks: “No route data for this peak”. Approximate routes, for visualization only — not for navigation. The routes file is published under ODbL (© OpenStreetMap contributors).

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

## Historical Timeline

The Earth timeline selects one UTC day (up to a year back). Each layer declares
what it can do in `src/earth/temporal-provenance.js`; a layer without history
for that day is hidden with “Not available for <date>”, never replaced.

- NASA EONET and USGS: a 7-day window ending on the chosen day (direct).
- Snow & ice: NASA GIBS MODIS Terra NDSI for that day (direct, from 2000-02-24).
- NASA FIRMS: that UTC day from 2000-11-01, through the proxy (`firms-day`).
- Wind: ERA5 reanalysis (from 1940, ~5 days behind), through the proxy (`wind-day`).
- Ocean currents: SMOC (from 2022), through the proxy (`currents-day`).
- Live only: GDACS, NOAA OVATION aurora, GVP (current catalog), ISS.

## Data Sources

Provenance labels follow `src/config/source-registry.js`.

- NASA EONET: near-real-time natural event metadata (`observed`).
- GDACS: EU JRC / UN OCHA global disaster alerts, used as fallback or GDACS-only mode (`interpretive`).
- NASA FIRMS: MODIS active-fire hotspots through the proxy and `FIRMS_MAP_KEY` (kept server-side); live detections and past days (MODIS NRT or SP, back to 1 Nov 2000) (`observed`).
- NASA GIBS: Blue Marble surface, VIIRS Black Marble annual night lights (2016) and MODIS Terra NDSI snow cover (`observed`). The daily cloud snapshot is temporarily paused.
- USGS: earthquake feed, normalized into local `earthquakes` events (`observed`).
- NOAA SWPC OVATION: aurora forecast, used to drive polar oval intensity (`prediction`).
- Smithsonian Global Volcanism Program: volcano catalog through the proxy (`observed`).
- Open-Meteo Forecast API: wind field (`prediction`); Open-Meteo Historical Weather API (ERA5, ECMWF / Copernicus Climate Change Service): past days of wind (`reconstructed`).
- Open-Meteo Marine API: live ocean currents (`prediction`) and SMOC past days (Copernicus Marine Service / Météo-France, `physical-model`).
- Living Himalaya: cited summit list (`observed`), Copernicus DEM GLO-30 and Terrarium tiles (`reconstructed`), Sentinel-2 L2A (`observed`), Open-Meteo GFS pressure levels (`prediction`), The Himalayan Database aggregates (`reported`), routes (`interpretive`) and camps (`reported`, OpenStreetMap / Wikidata, ODbL file).
- NOAA/ETOPO 2022-derived relief assets (built by `tools/build-relief.mjs`); lake surfaces rendered at 0 m (ETOPO has no lake levels).
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
assets/etopo2022-surface-m-2160x1080.ktx2
assets/etopo2022-surface-m-2160x1080.r16f.bin
assets/mod44w-water-2160x1080.png
```

## Offline And Cache Behaviour

The Service Worker is disabled. In the words of `earth-eonet-relief.html`: “It
caused cross-origin cache/CORS regressions for NASA GIBS imagery that were hard
to reproduce and left some browsers stuck on a stale, partially-broken build.”
The Earth page therefore unregisters any worker still installed and deletes the
app's `lea-*` caches on load. `sw.js` is kept in the repository but no page
registers it, so there is no offline mode today. Data freshness is still shown
per source (for example `live / fresh` or `cached / stale` from the in-app
caches).

## Performance Snapshot

Historical measurements, each with its date:

- 2026-07-26: at a `1909 x 868` canvas backing resolution, the KTX2
  relief/normal upgrade reduced Spector's reported Texture2D allocation from
  755 MiB to 168.1 MiB.
- Before 2026-08-12 (exact date not recorded): the half-resolution bloom and
  Black Marble capture reported 191.3 MiB total tracked allocation.
- 2026-07-26: a near-1080p 10-second requestAnimationFrame sample measured
  59.9 median FPS and 49.0 FPS 1% low.
- 2026-11-13: Chrome headless 1920×1080, GTX 1650, default layers: 41 draw
  calls per frame, 59.9 median FPS.

These are browser frame-cadence measurements, not hardware GPU timers.

## Main Modules

### Bootstrap And Runtime

- `src/earth/scene-runtime.js` creates the scene, renderer, camera, controls, and composer.
- `src/earth/earth-app-bootstrap.js` loads textures and prepares the initial scene.
- `src/earth/app-services.js` connects the main application services.
- `src/earth/app-runtime.js` starts lifecycle hooks, UI wiring, the animation loop, and demo reel runtime.
- `src/earth/app-state.js` defines the initial state and default preset.
- `src/earth/scene-runtime.js` uses `EffectComposer` with `UnrealBloomPass`, `SMAAPass`, and `OutputPass`.
- `sw.js` holds the former shell, GIBS and live-data cache policies; it is not registered by any page (see “Offline And Cache Behaviour”).

### Planet, Light, And Atmosphere

- `src/earth/app-visual-foundation.js` composes the visual foundation: geo utilities, event utilities, solar runtime, Earth layers, stars, and clouds.
- `src/earth/earth-layers.js` creates the Earth, NASA GIBS Black Marble night lights with fallback, and atmosphere meshes.
- `src/earth/earth-material.js`, `earth-look.js`, and `earth-appearance.js` control materials and look presets.
- `src/earth/atmosphere.js` contains the `dot` and `physical` atmosphere modes.
- `src/earth/solar-runtime.js` and `solar-system.js` compute solar position and solar clock values.

### EONET / Multi-Source Data And UI

- `src/earth/eonet-data.js` loads NASA EONET, supplemental providers, and GDACS fallback.
- `src/earth/eonet-ui.js` renders the event list, Today on Earth, details panel, and filters.
- `src/earth/eonet-workflow.js` coordinates load, filter, and selection behavior.
- `src/earth/event-scene.js`, `marker-system.js`, and `polygon-overlays.js` render markers, clusters, and polygon overlays. The stable path keeps individual meshes for EONET/highlights and uses a `Points` shader layer for dense USGS earthquake background events.
- `src/earth/gdacs-provider.refactored.js`, `firms-wildfires.js`, and `usgs-earthquakes.js` normalize alternative sources into the shared event model.

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
- `Daily clouds: temporarily paused` (NASA GIBS daily snapshot disabled; procedural clouds shown)
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

## Backup / Snapshots

Development happens on `main`; the public site is `luminomorphism.ro`. Local
snapshots are kept in `releases/` (not in Git); the most recent one is:

```text
releases/orbital-atlas-v1.0-public-20260711
```

It predates the current `main` (timeline, wind, currents, Living Himalaya and
later work are not in it). Earlier snapshots (v2.4.2–v2.4.4) remain there as
history.

Historical note (v2.4.2): NASA EONET polygon geometries used by some GDACS-linked flood events can arrive as `[lat, lon]` coordinate pairs, while point geometries remain GeoJSON-style `[lon, lat]`. The event normalization layer now handles both points and polygons before centroid calculation, so markers, Today on Earth cards, Select Event details, and camera targeting stay geographically aligned.

## Documentation Archive

Earlier working documents (the pre-contest README, the platform roadmap v4,
the post-Gate 0 draft and a research artifact) are kept in `docs/archive/`.
The current roadmap is `living-earth-observatory-roadmap-v5.md`.

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
