// gdacs-provider.refactored.js
//
// Aceeasi sursa GDACS, dar construita peste contractul unic din
// src/core/feed-adapter.js. Comparata cu gdacs-provider.js original:
//   - dispare tot codul de fetch / AbortController / timeout / try-catch /
//     urmarire manuala de status (lastError, lastCount, lastUpdated...),
//   - ramane DOAR ce e specific GDACS: cum arata un feature GDACS si cum il
//     transform intr-un eveniment intern (featureToEvent + ajutoarele lui).
//   - in plus, castiga gratis: reincercari, cache persistent, fallback pe
//     cache vechi si raportare in panoul uniform de sanatate (statusKey 'gdacs').
//
// Interfata e identica: createGdacsProvider({timeoutMs, maxEvents})
//   -> { fetchEvents, getStatus, dispose }
// app-services.js foloseste acest provider; contractul ramane compatibil cu
// restul runtime-ului Earth.

import { defineFeedAdapter } from '../core/feed-adapter.js';
import { createProxyRequiredError, isPublicProxyDisabledRuntime } from './public-runtime.js';
import { normalizeLonLatCoordinates } from './event-utils.js';

// ---------------------------------------------------------------------------
// Normalizare specifica GDACS (identica cu originalul)
// ---------------------------------------------------------------------------

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function normalizeEventType(value, title = '') {
  const raw = String(value || '').trim().toUpperCase();
  const lowerTitle = title.toLowerCase();
  if (raw === 'EQ' || lowerTitle.includes('earthquake')) return 'earthquakes';
  if (raw === 'TC' || lowerTitle.includes('cyclone') || lowerTitle.includes('hurricane') || lowerTitle.includes('typhoon')) return 'severeStorms';
  if (raw === 'FL' || lowerTitle.includes('flood')) return 'floods';
  if (raw === 'VO' || lowerTitle.includes('volcano')) return 'volcanoes';
  if (raw === 'DR' || lowerTitle.includes('drought')) return 'drought';
  if (raw === 'WF' || lowerTitle.includes('fire')) return 'wildfires';
  return 'manmade';
}

function readProxyBase() {
  const params = new URLSearchParams(window.location.search);
  return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
}

function sourceConfidence(alertLevel) {
  const level = String(alertLevel || '').toLowerCase();
  if (level.includes('red')) return 'red alert';
  if (level.includes('orange')) return 'orange alert';
  if (level.includes('green')) return 'green alert';
  return alertLevel || 'GDACS alert';
}

function featureToEvent(feature, proxyBase) {
  const props = feature?.properties || {};
  const title = props.eventname || props.name || 'GDACS disaster alert';
  const link = props.url?.report || props.report || `${proxyBase}/nasa-proxy?source=gdacs`;
  const eventType = props.eventtype || '';
  const alertLevel = props.alertlevel || props.episodealertlevel || '';
  const date = parseDate(props.fromdate) || new Date();
  const coords = normalizeLonLatCoordinates(feature?.geometry?.coordinates);
  if (!coords) return null;

  const idSeed = `${props.eventtype || ''}-${props.eventid || ''}-${props.episodeid || ''}` || `${title}:${date.toISOString()}`;
  const category = normalizeEventType(eventType, title);
  const severity = props.severitydata?.severity;
  const country = props.country || '';

  return {
    id: `gdacs:${idSeed}`.replace(/\s+/g, '-'),
    title,
    description: props.description || props.htmldescription || '',
    categories: [{ id: category, title: category }],
    sources: [{ id: 'GDACS', url: link }],
    geometry: [{
      type: 'Point',
      coordinates: coords,
      date: date.toISOString(),
      magnitudeValue: Number.isFinite(severity) ? severity : null,
      magnitudeUnit: Number.isFinite(severity) ? (props.severitydata?.severityunit || 'GDACS severity') : ''
    }],
    sourceProvider: 'GDACS',
    sourceMode: 'fallback',
    sourceUrl: link,
    sourceUpdatedAt: date.toISOString(),
    sourceConfidence: sourceConfidence(alertLevel),
    gdacs: {
      provider: 'EU JRC / UN OCHA',
      eventType: eventType || 'unknown',
      alertLevel: alertLevel || 'unknown',
      country: country || 'unknown',
      severity: severity ?? ''
    }
  };
}

// ---------------------------------------------------------------------------
// Providerul - acum doar configurare peste contractul unic
// ---------------------------------------------------------------------------

export function createGdacsProvider({ timeoutMs = 15000, maxEvents = 120 } = {}) {
  return defineFeedAdapter({
    key: 'gdacs-disaster-alerts',
    statusKey: 'gdacs',
    label: 'GDACS',
    unit: 'fallback alerts',
    timeout: timeoutMs,
    maxEvents,
    ttl: 60_000,
    staleTtl: 24 * 60 * 60_000,
    preflight() {
      if (isPublicProxyDisabledRuntime()) {
        const error = createProxyRequiredError('GDACS');
        error.proxyRequired = true;
        throw error;
      }
    },
    resolveUrl() {
      return `${readProxyBase()}/nasa-proxy?source=gdacs`;
    },
    normalize(payload) {
      const proxyBase = readProxyBase();
      return (payload.data?.features || []).map((feature) => featureToEvent(feature, proxyBase));
    },
  });
}
