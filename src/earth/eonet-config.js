export const EONET_API = 'https://eonet.gsfc.nasa.gov/api/v3/events';

export const categoryColors = {
    wildfires: '#ff6a33',
    severeStorms: '#7fd6ff',
    severeStorm: '#7fd6ff',
    severestorms: '#7fd6ff',
    severstorm: '#7fd6ff',
    volcanoes: '#ff3f7c',
    seaLakeIce: '#b6f3ff',
    earthquakes: '#8ff7ff',
    dustHaze: '#e0a85c',
    floods: '#4da3ff',
    landslides: '#c99766',
    manmade: '#f2f2f2',
    snow: '#ffffff',
    waterColor: '#76d7ff',
    tempExtremes: '#ffb347',
    drought: '#b9893f'
};

export const fallbackColor = '#c4d7ff';
export const futureDateToleranceMs = 2 * 3600000;

export const officialCategories = [
    { id: 'drought', label: 'Drought' },
    { id: 'dustHaze', label: 'Dust and haze' },
    { id: 'earthquakes', label: 'Earthquakes' },
    { id: 'floods', label: 'Floods' },
    { id: 'landslides', label: 'Landslides' },
    { id: 'manmade', label: 'Manmade' },
    { id: 'seaLakeIce', label: 'Sea/lake ice' },
    { id: 'severeStorms', label: 'Severe storms' },
    { id: 'snow', label: 'Snow' },
    { id: 'tempExtremes', label: 'Temperature extremes' },
    { id: 'volcanoes', label: 'Volcanoes' },
    { id: 'waterColor', label: 'Water color' },
    { id: 'wildfires', label: 'Wildfires' }
];

export const officialCategoryLabels = new Map(officialCategories.map(category => [category.id, category.label]));
