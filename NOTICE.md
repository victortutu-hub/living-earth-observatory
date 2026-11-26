# Notices And Third-Party Sources

Living Earth Observatory combines original source code and visual direction with
public scientific data, open-source libraries, and selected third-party visual
assets. This document clarifies attribution and usage boundaries.

## Project Code And Visual Direction

The original code, scene composition, reel/export workflow, UI, visual language,
and documentation in this repository are covered by the repository `LICENSE`.

Copyright (c) 2026 Mihai / Victor Daniel. All rights reserved.

## Open-Source Libraries

Since LOT 37 the browser libraries are served from this repository, under
`lib/<package>@<version>/`; no CDN is used at runtime (no unpkg.com,
cdn.jsdelivr.net or esm.sh). The files were extracted unchanged from the npm
registry tarballs by `tools/vendor-libs.mjs`, after checking each tarball against
the registry `dist.integrity` (sha512); `lib/MANIFEST.json` records every file
with its size, SHA-256 and source path, and `tests/lib-vendor.test.js` checks
`lib/` against it. Each library remains governed by its own upstream license,
whose text is kept next to the code:

| Library | Version | Use | License (file) | npm integrity (sha512) |
| --- | --- | --- | --- | --- |
| three.js (Three.js Authors) | 0.185.1 | 3D rendering, OrbitControls, post-processing, KTX2 loader, Line2 | MIT (`lib/three@0.185.1/LICENSE`) | `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==` |
| earcut (Mapbox) | 2.2.4 | polygon triangulation | ISC (`lib/earcut@2.2.4/LICENSE`) | `sha512-/pjZsA1b4RPHbeWZQn66SWS8nZZWLQQ23oE3Eam7aroEFGEvwKAsJfZ9ytiEMycfzXWpca4FA9QIOehf7PocBQ==` |
| Astronomy Engine (Don Cross) | 2.1.19 | Sun and Moon ephemerides | MIT (`lib/astronomy-engine@2.1.19/LICENSE`) | `sha512-8yWKNf7UeNbH458h3sAJ6ZgAjE5jTXp/mNNRFoC20j2SHwZIjAQeEsBB2Q3uCFRaTCCJRv33K2XhkhZQMXoX6w==` |
| satellite.js | 6.0.2 | TLE / SGP4 propagation for ISS tracking | MIT (`lib/satellite.js@6.0.2/LICENSE.md`) | `sha512-XWKxtqVF5xiJ1xAeiYeT/oSSzsukoCLWvk6nO/WFy4un0M3g4djAU9TAtOCqJLtYW9vxx9pkPJ1L9ITOc607GA==` |

Two files in `lib/` are derived, not copied: `lib/earcut@2.2.4/earcut.esm.js`
(an ES-module wrapper around the verbatim CommonJS `src/earcut.js`, which is
also kept) and `lib/astronomy-engine@2.1.19/LICENSE` (the MIT notice from the
header of `esm/astronomy.js`; the package ships no separate licence file).
`vendor/basis/` (the Basis Universal transcoder used by the KTX2 loader) is
unchanged by LOT 37.

When packaging this project for production, keep the `lib/` licence files with
the distributed build.

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

## Earth Coastline (Lot 43)

- Coastline: Natural Earth 10m land v5.1.1 (public domain), rasterized locally.
  `assets/earth/coast-distance-ne10m-8192x4096-<hash>.png` is the signed
  distance to the coast (km, + land, - water, ±32 km in 8 bits) built by
  `tools/build-coast-distance.mjs` from `ne_10m_land.zip`
  (https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip, 3,269,070
  bytes, SHA-256
  `e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc`; page
  https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/:
  "Land polygons including major islands. Derived from 10m coastline.").
  Terms (https://www.naturalearthdata.com/about/terms-of-use/): "No
  permission is needed to use Natural Earth. Crediting the authors is
  unnecessary." and "All versions of Natural Earth raster + vector map data
  found on this website are in the public domain." Made with Natural Earth.
- It sets the land / water weight near the coast only. The inland water mask
  MOD44W (`assets/mod44w-water-2160x1080.png`, above) remains: lakes, rivers
  and the far field keep the MOD44W water fraction.

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

## Moon Lighting (Lot 31)

The Moon is lit only by the real Sun direction and a physical earthshine
(`src/earth/earthshine.js`): E / E_sun = p · (R⊕/d)² · Φ(α⊕), with p = 0.434, the
Earth's geometric albedo from the NASA Earth Fact Sheet
(https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html: "Geometric albedo
0.434"; the Bond albedo 0.294 there is not used), the Lambert-sphere phase function
Φ (an approximation), the Earth–Moon distance d from Astronomy Engine and the
Earth's phase angle α⊕ seen from the Moon. The order of magnitude agrees with the
published value of earthshine at maximum Earth phase, "approximately 0.15 W m−2"
or "only 0.01% of the radiance from direct Sunlight" (Glenar et al. 2019, as quoted
by https://en.wikipedia.org/wiki/Earthshine). "Earthshine view" raises the Moon
exposure by 11 EV (10 EV before Lot 38; lit side clipped, as in photographs; drawn after
the bloom since Lot 38). The Earth keeps a
declared artistic fill (a cool light opposite the Sun and an ambient light).

## Moon Reflectance And Earthshine Colour (Lot 38)

- Reflectance: McEwen's lunar-Lambert photometric function with the coefficients
  of USGS ISIS `LunarLambertMcEwen`
  (https://isis.astrogeology.usgs.gov/8.1.0/Object/Programmer/_lunar_lambert_mc_ewen_8cpp_source.html,
  CC0; McEwen 1991, Icarus 92), L(g) clamped to [0, 1], scaled by 2/3 so the
  full-Moon disc mean of the previous Lambert rendering is kept
  (`src/earth/moon-photometry.js`; physical-model, approximated).
- Moon exposure "auto" (default) is interpretive: one exposure for the whole Moon,
  from the phase seen by the camera, up to +3 EV; "fixed" keeps +0 EV.
- Earthshine colour: the earthlit side of the Moon is 0.150 ± 0.005 mag bluer in
  B−V than the sunlit side (Thejll et al. 2014, "On the colour of the dark side of
  the Moon", A&A 563, A38, arXiv:1401.1994; observed). Applied as a power-law
  spectral tilt through the Johnson B and V bands, evaluated at the sRGB primaries
  and scaled to keep the luminance (`src/earth/earthshine.js`; approximated).

## Local Earth Textures (Lot 30)

These replaced three files that were loaded from threejs.org with no declared source:

- `assets/earth/black-marble-2016-3600x1800-<hash>.jpg`: NASA Black Marble 2016
  colour map, 0.1° global (NASA Earth Observatory, "Earth at Night" flat maps,
  https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/: "These
  images show Earth's night lights as observed in 2016."), byte-for-byte. Used
  as the night-lights fallback until NASA GIBS Black Marble loads. The page
  gives no credit line of its own; NASA is acknowledged as the source (NASA
  media guidelines, quoted in the Moon section).
- `assets/earth/blue-marble-clouds-2048x1024-<hash>.jpg`: NASA Blue Marble cloud
  image `cloud_combined_2048.jpg` (The Blue Marble 2002,
  https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/):
  "Image by Reto Stöckli (land surface, shallow water, clouds)."; "The cloud image
  is a composite of two days of imagery collected in visible light wavelengths
  and a third day of thermal infra-red imagery over the poles."; "These images
  are freely available to educators, scientists, museums, and the public."
  Byte-for-byte; shown as a static layer with an animated drift, not the clouds
  of the scene day.
- `assets/earth/specular-mod44w-<hash>.png`: ocean specular mask derived from the
  local MOD44W water fraction (`assets/mod44w-water-2160x1080.png`) by
  `tools/build-earth-textures.mjs`.

## Fonts

- `assets/fonts/inter-4.1-var-<hash>.woff2`: Inter, Version 4.001 (rsms/inter
  release v4.1, https://github.com/rsms/inter/releases/tag/v4.1), © 2016 The
  Inter Project Authors, licensed under the SIL Open Font License, Version 1.1
  (`assets/fonts/OFL.txt`, copied unchanged from the release). Subset by
  `tools/build-inter-font.py` (weights 200–600, latin, latin-ext and greek
  ranges); served locally instead of Google Fonts.

## Moon Textures And Lunar Assets

Every Moon texture comes from the NASA SVS CGI Moon Kit
(https://svs.gsfc.nasa.gov/4720). The page asks: "Please give credit for this
item to: NASA's Scientific Visualization Studio", and notes that the colour map
is "optimized for aesthetics, not science". It states no licence of its own and
links to NASA's media guidelines
(https://www.nasa.gov/nasa-brand-center/images-and-media/), which say that NASA
images "generally are not subject to copyright in the United States", that
"NASA should be acknowledged as the source of the material", and that a use
"must not explicitly or implicitly convey NASA's endorsement of commercial goods
or services". No further rights statement was confirmed.

- `assets/moon/moon-lroc-color-4k-<hash>.jpg`: LROC WAC colour, 4096×2048,
  re-encoded from `lroc_color_poles_4k.tif` without resampling or colour change
  by `tools/build-moon-color.mjs` (input pinned by SHA-256). Observed.
- `assets/moon/moon-lola-normal-4k-<hash>.jpg`: normal map reconstructed from
  the LOLA topography `ldem_16_uint.tif` by `tools/build-moon-normal.mjs`
  (2.665 km per pixel, vertical exaggeration 1×; the east-west step is clamped
  near the poles, documented in the tool). Reconstructed, not observed.
- `assets/moon-lroc-color-1k-1024x512.jpg` (LROC WAC colour, used only as the
  labelled fallback when the 4K colour map does not load) and
  `assets/moon-ldem-elevation-1024x512.jpg` (LOLA elevation for displacement
  and bump), from the same kit.

## Generated Media

Videos and stills exported from the application may include data, imagery, or
third-party visual assets listed above. Distribution of generated media must
respect the same provider/source constraints.

For safest public sharing:

- credit the Moon textures to NASA's Scientific Visualization Studio;
- keep data-source attribution visible in captions, descriptions, or project
  metadata;
- avoid presenting procedural layers as exact live measurements when they are
  only physically grounded approximations.

<!-- glaciers:begin (generated by tools/build-himalaya-glaciers.mjs) -->
### Glacier outlines (Living Himalaya)

RGI 7.0 Consortium, 2023. Randolph Glacier Inventory - A Dataset of Global Glacier Outlines, Version 7.0. Boulder, Colorado USA. NSIDC: National Snow and Ice Data Center. doi:10.5067/f6jmovy5navz. Online access: https://doi.org/10.5067/f6jmovy5navz

subset: regions 14–15, clipped to the summit patches, simplified at 15 m. No explicit license stated by NSIDC/data.gov; distributed openly by NSIDC with citation required.

GLIMS submissions used in this subset (from the RGI 7.0 submission_info.csv files):
- Region 14, submission 752: Sakai, Akiko (analysts), Nagoya University; 161 outlines in the subset; analysis 2018-07-01.
- Region 15, submission 752: Sakai, Akiko (analysts), Nagoya University; 869 outlines in the subset; analysis 2018-07-01.
- Region 15, submission 765: Bolch, Tobias (analysts), Graz University of Technology; 9 outlines in the subset; analysis 2022-05-01.
<!-- glaciers:end -->
