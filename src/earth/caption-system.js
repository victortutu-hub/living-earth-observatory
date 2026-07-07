export const captionStyles = {
    minimal: {
        label: 'Minimal',
        tone: 'minimal',
        headerWeight: 650,
        titleWeight: 780,
        cardAlpha: 0.72,
        strokeAlpha: 0.42,
        lineWidth: 2,
        titleMaxSize: 42,
        metaMaxSize: 24,
        footerMaxSize: 18
    },
    cinematic: {
        label: 'Cinematic',
        tone: 'cinematic',
        headerWeight: 720,
        titleWeight: 840,
        cardAlpha: 0.84,
        strokeAlpha: 0.62,
        lineWidth: 3,
        titleMaxSize: 48,
        metaMaxSize: 30,
        footerMaxSize: 22
    },
    impact: {
        label: 'Impact',
        tone: 'impact',
        headerWeight: 850,
        titleWeight: 920,
        cardAlpha: 0.9,
        strokeAlpha: 0.76,
        lineWidth: 5,
        titleMaxSize: 52,
        metaMaxSize: 28,
        footerMaxSize: 20
    }
};

const poeticLines = {
    wildfires: [
        'A hot signal crossing the living skin of Earth.',
        'The planet exhales heat in a visible trace.'
    ],
    severestorms: [
        'Weather gathers force over a moving world.',
        'A spiral of atmosphere becomes a story.'
    ],
    severeStorms: [
        'Weather gathers force over a moving world.',
        'A spiral of atmosphere becomes a story.'
    ],
    seaLakeIce: [
        'Ice drifts quietly through a changing ocean.',
        'A frozen fragment keeps its own slow clock.'
    ],
    volcanoes: [
        'Stone, ash, and heat speak from below.',
        'The interior of Earth leaves a signal in the air.'
    ],
    earthquakes: [
        'A brief motion written through the crust.',
        'The ground remembers energy in a single pulse.'
    ],
    default: [
        'A real signal, momentary and luminous.',
        'The data becomes a small light on the globe.'
    ]
};

function sourceLabel(event) {
    const ids = (event.sources || []).map(source => String(source.id || '').toUpperCase());
    if (event.usgs || ids.includes('USGS')) return 'USGS';
    if (ids.includes('EONET')) return 'NASA EONET';
    if (ids.includes('NOAA')) return 'NOAA';
    return 'NASA EONET';
}

function cleanCategoryLabel(label, category) {
    const raw = String(label || category || 'earth signal').replace(/-/g, ' ');
    return raw.replace(/\b\w/g, match => match.toUpperCase());
}

function deterministicPoeticLine(category, title) {
    const lines = poeticLines[category] || poeticLines.default;
    const seed = String(title || category || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return lines[seed % lines.length];
}

export function getCaptionStyle(state) {
    return captionStyles[state?.captionStyle] || captionStyles.cinematic;
}

export function createCaptionSystem({
    state,
    latestGeometry,
    eventCategory,
    officialCategoryLabels,
    eventLonLat
}) {
    function buildEventCaption(event, { snap = false, index = 1, total = 3 } = {}) {
        const category = eventCategory(event);
        const categoryLabel = cleanCategoryLabel(officialCategoryLabels.get(category), category);
        const ll = eventLonLat(event);
        const date = (latestGeometry(event)?.date || 'unknown').slice(0, 10);
        const source = sourceLabel(event);
        const signalLabel = `SIGNAL ${String(index).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
        const style = getCaptionStyle(state);
        const header = style.tone === 'impact'
            ? `${signalLabel} - IMPACT LOCK`
            : style.tone === 'minimal'
                ? `${signalLabel} - ${source}`
                : `${signalLabel} - ${snap ? 'SNAP FOCUS' : categoryLabel.toUpperCase()}`;
        const meta = ll
            ? `${date}  -  ${ll.lat.toFixed(1)} lat, ${ll.lon.toFixed(1)} lon`
            : date;
        const footer = `${source} - ${categoryLabel.toLowerCase()} signal`;
        const poetic = state.poeticCaptions
            ? deterministicPoeticLine(category, event.title)
            : '';

        return {
            style,
            category,
            categoryLabel,
            source,
            header,
            title: event.title,
            meta,
            footer,
            poetic
        };
    }

    function buildTransitionCaption(event, { index = 1, total = 3 } = {}) {
        const category = eventCategory(event);
        const categoryLabel = cleanCategoryLabel(officialCategoryLabels.get(category), category);
        const style = getCaptionStyle(state);
        return {
            style,
            category,
            categoryLabel,
            source: sourceLabel(event),
            header: `${style.tone === 'impact' ? 'TARGET SHIFT' : style.tone === 'minimal' ? 'NEXT' : 'TRANSITION'} ${String(index).padStart(2, '0')}/${String(total).padStart(2, '0')}`,
            title: categoryLabel.toUpperCase(),
            meta: style.tone === 'minimal' ? 'moving to verified signal' : 'locking camera to the next real-world signal',
            footer: `${sourceLabel(event)} near real-time feed`
        };
    }

    function buildTitleCaption(mode, count = 3) {
        const style = getCaptionStyle(state);
        if (mode === 'intro') {
            return {
                style,
                header: 'NASA EONET - NEAR REAL-TIME EARTH SIGNALS',
                title: `${count || 3} SIGNALS`,
                subtitle: 'ON EARTH NOW',
                footer: state.poeticCaptions ? 'A cinematic reading of real planetary data' : ''
            };
        }
        if (mode === 'earthshine') {
            return {
                style,
                header: 'ASTRONOMY ENGINE - REAL MOON GEOMETRY',
                title: 'EARTHSHINE',
                subtitle: 'THE DARK SIDE LIT BY EARTH',
                meta: 'Phase, distance and lunar orientation are calculated live',
                footer: 'Cinematic visibility boost, physically bounded'
            };
        }
        if (mode === 'iss') {
            return {
                style,
                header: 'CELESTRAK TLE - SGP4 ORBIT PROPAGATION',
                title: 'INTERNATIONAL',
                subtitle: 'SPACE STATION',
                meta: 'Live orbital position, altitude and velocity',
                footer: 'NORAD 25544 - trail generated from the current orbit'
            };
        }
        return {
            style,
            header: 'REAL NASA EONET DATA',
            title: 'EARTH OBSERVATORY',
            subtitle: 'LIVE WINDOW',
            meta: `${count || 3} highlighted events from the current feed`,
            footer: 'Generated directly from the observatory scene'
        };
    }

    return {
        buildEventCaption,
        buildTransitionCaption,
        buildTitleCaption
    };
}
