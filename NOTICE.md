# Notices And Third-Party Sources

Living Earth Observatory combines original source code and visual direction with
public scientific data, open-source libraries, and selected third-party visual
assets. This document clarifies attribution and usage boundaries.

## Project Code And Visual Direction

The original code, scene composition, reel/export workflow, UI, visual language,
and documentation in this repository are covered by the repository `LICENSE`.

Copyright (c) 2026 Mihai / Victor Daniel. All rights reserved.

## Open-Source Libraries

The project currently uses browser/CDN imports rather than local npm packages.
Each library remains governed by its own upstream license:

- Three.js: 3D rendering framework.
- Earcut: polygon triangulation.
- Astronomy Engine: solar and lunar astronomical calculations.
- satellite.js: TLE/SGP4 orbital propagation for ISS tracking.

When packaging this project for production, keep library license files or links
with the distributed build.

## Scientific And Disaster Data Sources

The following providers are used for live, near-real-time, or daily scientific
signals. Their data remains governed by each provider's own terms and metadata
policies:

- NASA EONET: natural event metadata.
- NASA GIBS (WMTS): Blue Marble Next Generation surface, VIIRS Black Marble
  annual night lights (2016) and MODIS Terra NDSI Snow Cover (daily). The
  GIBS daily cloud snapshot is temporarily paused (not shown).
- NASA FIRMS: MODIS active-fire hotspot data, accessed through the proxy
  with a server-side `FIRMS_MAP_KEY`.
- GDACS: EU JRC / UN OCHA global disaster alerts.
- USGS: earthquake feeds.
- Smithsonian Institution – Global Volcanism Program (GVP): volcano catalog,
  through the proxy; Smithsonian GVP terms, attribution retained.
- Open-Meteo (Earth wind and ocean currents), "Weather data by Open-Meteo.com"
  (CC BY 4.0):
  - Forecast API: live wind field (model prediction);
  - Historical Weather API (ERA5 reanalysis, past days through the proxy):
    "Contains modified Copernicus Climate Change Service information";
  - Marine API: ocean currents; SMOC total surface current, "Ocean currents:
    Copernicus Marine Service / Météo-France".
- AlphaFold DB (EMBL-EBI): predicted protein structures and per-residue pLDDT
  for Living Protein (model predictions, not experimental structures);
  CC BY 4.0, citation and provider attribution retained.
- UniProt (UniProt Consortium): protein names and feature annotations for
  Living Protein (CC BY 4.0).
- NOAA SWPC OVATION: aurora forecast data.
- NOAA/ETOPO-derived relief assets: Earth relief and bathymetry sources.
- Public TLE/SGP4 sources: ISS orbital tracking inputs.
- Open-Meteo (Living Himalaya summit weather): "Weather data by Open-Meteo.com"
  (CC BY 4.0); model NOAA NCEP GFS 0.25° on pressure levels (Model prediction).
- Copernicus Sentinel-2 L2A (Living Himalaya "Satellite" mode): read at runtime
  from the AWS Open Data `sentinel-cogs` COGs found through Earth Search
  (Element 84); bands B4/B3/B2 reprojected and with a fixed stretch, so the
  notice is "Contains modified Copernicus Sentinel data <year of the scene>".

The app is an artistic/scientific visualization, not an operational emergency
system. Always consult the original providers for authoritative data.

## Bundled Earth Relief And Water Mask

- `assets/etopo2022-surface-m-2160x1080.ktx2` and
  `assets/etopo2022-surface-m-2160x1080.r16f.bin` (metadata in
  `assets/etopo2022-surface-m-2160x1080.json`): surface elevation in metres
  (half float; the top of the Greenland/Antarctic ice sheets, bedrock
  elsewhere), derived from NOAA National Centers for Environmental
  Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model, 60
  arc-second ice-surface GeoTIFF. DOI: 10.25921/fd45-gt74. Area-averaged
  (cos-latitude weighted) to 1/6° by `tools/build-relief.mjs`. NOAA data are
  in the public domain; attribution to NOAA NCEI is retained. ETOPO holds no
  lake levels: lake surfaces are rendered at 0 m.
- `assets/mod44w-water-2160x1080.png`: water fraction per 1/6° texel from the
  NASA GIBS layer `MODIS_Water_Mask` (MOD44W, MODIS/SRTM water mask; EPSG:4326
  250m set, level 5), built by `tools/build-relief.mjs`; decoded to an R8
  texture at runtime. NASA data are public domain; attribution to NASA is
  retained.

## Living Himalaya Terrain

- `assets/himalaya/glo30-<peak>-<hash>.ktx2` (metadata in
  `src/config/himalaya-terrain-patches.js`): 20 × 20 km height grids at
  1 arc-second around the 14 summits above 8000 m and 5 selected Nepal peaks
  (Yalung Kang uses the Kangchenjunga patch), cut from the Copernicus DEM
  GLO-30 Public (2021 release, AWS Open Data bucket `copernicus-dem-30m`) and
  quantized to 0.25 m (KTX2 R16_UNORM + Zstd) by
  `tools/build-himalaya-patches.mjs`. Required notice for adapted data:
  “produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
  Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
  Union and ESA; all rights reserved”. The share of pixels that the GLO-30
  Filling Mask flags as filled from other DEMs (ASTER, SRTM, GMTED2010, AW3D30
  and others; Product Handbook I6.1, Table 7) is stored per patch and shown in
  the observatory.
- Overview and alternative detail: AWS Open Data “Terrain Tiles” (Terrarium
  encoding, Tilezen joerd), fetched at runtime. Attribution: Mapzen; United
  States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy
  of the U.S. Geological Survey; Global ETOPO1 terrain data U.S. National
  Oceanic and Atmospheric Administration.

## Real Sky (Living Earth)

These two files are distributed under their own terms, separately from the
licence of this repository:

- `assets/sky/milkyway-2020-luminance-<hash>.ktx2` and
  `assets/sky/milkyway-2020-chroma-<hash>.ktx2` (metadata in
  `src/config/sky-map.js`): the Milky Way background of NASA's Scientific
  Visualization Studio “Deep Star Maps 2020” (svs.gsfc.nasa.gov/4851,
  `milkyway_2020_4k.exr`, the map without the Hipparcos and Tycho stars),
  re-projected to cube maps and re-encoded by `tools/build-sky-map.mjs`.
  Credit: “NASA/Goddard Space Flight Center Scientific Visualization Studio.
  Gaia DR2: ESA/Gaia/DPAC.” SVS content is public domain unless noted; the map
  is built on Gaia DR2 data, distributed under **CC BY-NC 3.0 IGO**: use here
  is **non-commercial**. The SVS values are relative and clipped at 1.0 (not
  absolute photometry); the brightness scale is calibrated on the SVS
  bright-star layer (`hiptyc_2020_4k.exr`, used locally only).
- `assets/sky/hyg-v44-stars-<hash>.bin` (metadata in
  `src/config/sky-stars.js`): 8870 Hipparcos stars with V ≤ 6.5 derived
  from the HYG database v4.4 (astronexus, https://codeberg.org/astronexus/hyg),
  licensed **CC BY-SA 4.0**; this derived file is published under CC BY-SA 4.0.
  Positions J2000 (epoch and equinox 2000.0), V magnitude and B−V colour index.
- Provenance: `observed` (survey render and catalogue). The sky is shown at
  +19 stops relative to the Earth exposure (declared; the only display
  choice, derived from the data and the lowest bloom threshold); Gaia colours
  in the SVS map were balanced by eye by SVS.

## Real Sky (Living Himalaya)

- The same two sky asset sets as Living Earth (terms above), drawn from the
  selected summit with the same photometric scale (not amplified).
- Day sky: the Preetham, Shirley & Smits (1999) analytic daylight model,
  adapted in `src/core/sky/sky-atmosphere.js` from three.js r185
  `examples/jsm/objects/Sky.js` (in-scattering term only; Rayleigh scaled by
  the pressure at the summit height). three.js is © 2010–2025 three.js
  authors, MIT License (https://github.com/mrdoob/three.js/blob/dev/LICENSE).
  Provenance: `interpretive`, absolute brightness not photometric.
- Twilight: the published V-band fit of Patat, Ugolnikov & Postylyakov 2006
  (A&A 455, 385), Table 1; dark sky: Patat 2003 (A&A 400, 1183); extinction:
  Buton et al. 2013 (A&A 549, A8), Table 6; airmass: Kasten & Young 1989
  (Applied Optics 28, 4735). Coefficients cited, no data files redistributed.

## Living Himalaya Routes And Camps (OpenStreetMap, Wikidata)

- `assets/himalaya/routes-<hash>.json` (metadata in `src/config/himalaya-routes.js`,
  built offline by `tools/build-himalaya-routes.mjs` from
  `tools/data/himalaya-routes-source.json`) is published under the
  **Open Database License (ODbL 1.0)**, separately from the licence of this
  repository. It contains camp positions from OpenStreetMap —
  “© OpenStreetMap contributors”, https://www.openstreetmap.org/copyright —
  and from Wikidata (CC0).
- Camp elevations are cited facts, each with its source: OpenStreetMap,
  Wikidata, Alan Arnette (alanarnette.com: Everest, Lhotse, K2 and Manaslu FAQ),
  ExplorersWeb (Manaslu and Ama Dablam climbers' guides; Second Seven Summits:
  K2), Philippe Gatta (K2 expedition) and SummitPost (The Abruzzi Spur). No text
  is copied; no data from The Himalayan Database is used.
- Route lines are `interpretive` (drawn through the reported camps and named
  features; not GPS tracks); camp positions are `reported`. Approximate routes,
  for visualization only — not for navigation. GLO-30 elevations at each camp
  come from the Copernicus DEM patches listed above.

## Living Himalaya History (The Himalayan Database)

- `assets/himalaya/hdb-aggregates-<hash>.json` (metadata in
  `src/config/himalaya-history.js`): per-peak aggregates only (successful
  expeditions, member summits, first ascent year and season, total deaths of
  members and hired staff, season totals) for the eight-thousanders the
  database covers, used with written permission (2026-11-16). No records,
  names or raw tables are published; the licensed copy stays local to the
  author. Provenance: `reported` (compiled from expedition accounts, not
  measurements).
- Credit, as shown in the observatory: “Source: The Himalayan Database ©
  (Elizabeth Hawley / Richard Salisbury et al.), version 2.75, Autumn–Winter
  2025 update, extracted 2026-11-16”.
- Link (home page only): https://www.himalayandatabase.com
- The Himalayan Database covers Nepal and its border peaks; the six 8000 m
  peaks in Pakistan and Tibet are not covered. No Himalayan Database data are
  shown for the 6 selected Nepal peaks (the permission covers the 14
  eight-thousanders only).

## Bundled Earth Surface Texture

- `assets/blue-marble-ng-4096x2048.jpg`: NASA Blue Marble: Next Generation
  (NASA Earth Observatory / Reto Stöckli), downloaded once from NASA GIBS
  (WMS layer `BlueMarble_NextGeneration`, EPSG:4326, 4096×2048, JPEG).
  NASA imagery is public domain; attribution to NASA is retained. Used as the
  initial surface texture and as the fallback when GIBS is unreachable. This
  product has no baked hillshade; relief shading comes from the ETOPO normals
  lit by the computed Sun position.

## Moon Textures And Lunar Assets

The Moon system supports multiple visual sources:

- NASA LROC WAC / NASA SVS material is the preferred public-domain path for
  clear redistribution and public presentation.
- CoryG89 MoonDemo imagery is currently used as the default cinematic texture
  option in the app because it has strong visual quality. However, the upstream
  source chain includes lunar imagery with wording that may be limited to
  personal or non-commercial use. Treat this texture path as optional and
  non-commercial unless you independently verify broader rights.

For public, commercial, packaged, or client-facing distribution, prefer the NASA
Moon texture option or replace the CoryG89 path with a clearly licensed local
asset.

The lunar relief/displacement work in this project is intended to be based on
NASA/LOLA-style public scientific sources where available. Keep source notes
with any packaged lunar assets.

## Generated Media

Videos and stills exported from the application may include data, imagery, or
third-party visual assets listed above. Distribution of generated media must
respect the same provider/source constraints.

For safest public sharing:

- use NASA/public-domain Moon textures;
- keep data-source attribution visible in captions, descriptions, or project
  metadata;
- avoid presenting procedural layers as exact live measurements when they are
  only physically grounded approximations.
