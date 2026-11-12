export const GATEWAY_DATA_SOURCES = Object.freeze({
  // NASA GIBS WMTS Blue Marble Next Generation, level z2 of the EPSG:4326 500m
  // set: 5 x 3 tiles cropped to 360 x 180 (2560 x 1280), drawn at 2048 x 1024.
  // Tiles, not WMS: GIBS WMS answered in 45-160 s or 504 (measured 2026-11-12).
  earthTexture: Object.freeze({ kind: 'gibs-wmts-mosaic', layer: 'blueMarble', z: 2, width: 2048, height: 1024 }),
  eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100',
  alphaFoldPrediction: 'https://alphafold.ebi.ac.uk/api/prediction/P04637'
});
