// Sprint 2.3 - curenti oceanici. Wrapper subtire peste acelasi motor generic
// ca vantul (field-particles.js). Diferentele fata de vant:
//  - sursa: Open-Meteo Marine (ocean_current_velocity / direction);
//  - landAware: true - masca de uscat opreste particulele la coaste;
//  - viteza reala e mult mai mica (~1 m/s vs ~10 m/s la vant), deci speedScale
//    e mai mare ca sa ramana vizibila curgerea;
//  - paleta distincta (teal-verde), ca sa nu se confunde cu vantul.
import { createFieldParticles } from './field-particles.js';
import { buildOceanDayTexture, fetchOceanCurrentTexture } from './ocean-current-provider.js';
import { fetchFieldDay } from './field-day-history.js';

export function createOceanCurrents({ THREE, renderer, earthGroup, gridSize = 128 }) {
    return createFieldParticles({
        THREE,
        renderer,
        earthGroup,
        gridSize,
        fetchField: fetchOceanCurrentTexture,
        // LOT 11: a past UTC day = SMOC total surface current through the proxy (currents-day).
        fetchFieldDay: (options) => fetchFieldDay('currents', options),
        buildDayTexture: buildOceanDayTexture,
        history: {
            provenanceKey: 'openMeteoMarineArchive',
            text: 'SMOC (Open-Meteo Marine) · total surface current (includes tides and wave-driven drift)',
            notes: 'Ocean currents: Copernicus Marine Service / Météo-France (SMOC). Weather data by Open-Meteo.com (CC BY 4.0).',
        },
        label: 'Ocean currents',
        sourceLabel: 'Open-Meteo Marine',
        provenanceKey: 'openMeteoMarine',
        landAware: true,
        speedScale: 200000,
        trailFade: 0.985,
        // Radius usor sub vant, ca sa nu se suprapuna exact daca ambele sunt on.
        displayRadius: 2.045,
        headColor: [0.28, 0.85, 0.78],
        headAlpha: 0.6,
        pointSize: 2.0,
        displayOpacity: 0.85,
    });
}
