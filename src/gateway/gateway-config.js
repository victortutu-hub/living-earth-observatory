export const GATEWAY_DATA_SOURCES = Object.freeze({
  earthTexture: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?service=WMS&request=GetMap&version=1.3.0&layers=BlueMarble_ShadedRelief&styles=&format=image/jpeg&transparent=false&height=1024&width=2048&crs=EPSG:4326&bbox=-90,-180,90,180',
  eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100',
  alphaFoldPrediction: 'https://alphafold.ebi.ac.uk/api/prediction/P04637'
});
