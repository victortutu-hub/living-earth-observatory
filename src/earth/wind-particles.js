// Sprint 2.2 - particule de vant. Wrapper subtire peste motorul generic
// createFieldParticles (field-particles.js), care contine toata logica de
// advectie GPU + trail-uri echirectangulare. Aici doar sursa (Open-Meteo
// wind_speed_10m / wind_direction_10m) si parametrii vizuali de vant.
import { createFieldParticles } from './field-particles.js';
import { fetchWindFieldTexture } from './wind-field-provider.js';

export function createWindParticles({ THREE, renderer, earthGroup, gridSize = 128 }) {
    return createFieldParticles({
        THREE,
        renderer,
        earthGroup,
        gridSize,
        fetchField: fetchWindFieldTexture,
        label: 'Wind',
        sourceLabel: 'Open-Meteo current field',
        landAware: false,
        speedScale: 50000,
        trailFade: 0.985,
        headColor: [0.62, 0.80, 1.0],
        headAlpha: 0.6,
        pointSize: 2.0,
        displayOpacity: 0.85,
    });
}
