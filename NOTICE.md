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
- NASA GIBS: daily cloud imagery/snapshots.
- NASA FIRMS: MODIS/VIIRS wildfire hotspot data, accessed through a local proxy
  with a user-provided `FIRMS_MAP_KEY`.
- GDACS: EU JRC / UN OCHA global disaster alerts.
- USGS: earthquake feeds.
- NOAA SWPC OVATION: aurora forecast data.
- NOAA/ETOPO-derived relief assets: Earth relief and bathymetry sources.
- Public TLE/SGP4 sources: ISS orbital tracking inputs.

The app is an artistic/scientific visualization, not an operational emergency
system. Always consult the original providers for authoritative data.

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
