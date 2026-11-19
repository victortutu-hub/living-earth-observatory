// Capability declarations are intentionally separate from visual status.
// A module can be research-mapped without claiming a runtime capability.

const EMPTY_CAPABILITIES = Object.freeze([]);

export const CAPABILITY_DEFINITIONS = Object.freeze({
  data: Object.freeze({
    id: 'data',
    label: 'Data ingestion',
    group: 'data',
    description: 'Consumes documented source data through an observatory-specific adapter.',
  }),
  provenance: Object.freeze({
    id: 'provenance',
    label: 'Source provenance',
    group: 'data',
    description: 'Exposes source, provider, update time and representation boundaries.',
  }),
  'historical-time': Object.freeze({
    id: 'historical-time',
    label: 'Historical time',
    group: 'time',
    description: 'Supports documented navigation through a historical time window or replay.',
  }),
  story: Object.freeze({
    id: 'story',
    label: 'Editorial story',
    group: 'experience',
    description: 'Builds a guided narrative from documented signals or model context.',
  }),
  'vertical-export': Object.freeze({
    id: 'vertical-export',
    label: 'Vertical export',
    group: 'export',
    description: 'Composes social-first 9:16 output with safe framing and caption layout.',
  }),
  'still-export': Object.freeze({
    id: 'still-export',
    label: 'Still export',
    group: 'export',
    description: 'Exports a still image from the current observatory composition.',
  }),
  'video-export': Object.freeze({
    id: 'video-export',
    label: 'Video export',
    group: 'export',
    description: 'Exports a timed video reel from the observatory scene.',
  }),
  'live-layers': Object.freeze({
    id: 'live-layers',
    label: 'Live layers',
    group: 'runtime',
    description: 'Combines live or near-live source layers in the active scene.',
  }),
  'diagnostic-replay': Object.freeze({
    id: 'diagnostic-replay',
    label: 'Diagnostic replay',
    group: 'runtime',
    description: 'Participates in the platform diagnostic and cached-state replay workflow.',
  }),
});

export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITY_DEFINITIONS));

export const OBSERVATORY_CAPABILITIES = Object.freeze({
  'living-earth': Object.freeze([
    'data',
    'provenance',
    'historical-time', // LOT 17: time-scrub (LOT 5/9/11); limits below
    'story',
    'vertical-export',
    'still-export',
    'video-export',
    'live-layers',
    'diagnostic-replay',
  ]),
  'living-protein': Object.freeze([
    'data',
    'provenance',
    'story',
    'diagnostic-replay',
  ]),
  // Only what runs on production (deploy-himalaya-9) and is covered by tests.
  // Not declared: story, exports, diagnostic-replay (the page keeps its own
  // request runtimes outside the platform replay workflow).
  'living-himalaya': Object.freeze([
    'data',
    'provenance',
    'historical-time',
    'live-layers',
  ]),
});

// Optional per-observatory evidence: which registered sources (source-registry)
// back each declared capability; their provenance is read from the source
// definition. When an observatory has an evidence map, every declared
// capability must name at least one source the observatory declares
// (validated in module-contract.js).
export const OBSERVATORY_CAPABILITY_EVIDENCE = Object.freeze({
  'living-himalaya': Object.freeze({
    data: Object.freeze({
      sources: Object.freeze(['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'sentinel2L2a', 'openMeteoPressureLevels', 'astronomy', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps', 'himalayaSkyNight', 'himalayaSkyTwilight']),
      note: 'Cited summit list, GLO-30 patches and Terrarium tiles, Sentinel-2 L2A read in the browser, Open-Meteo GFS at summit height, Sun and Moon from Astronomy Engine, Himalayan Database aggregates (14 eight-thousanders), optional routes and camps, the real sky from the summit (NASA SVS Milky Way, HYG stars, twilight fit).',
    }),
    provenance: Object.freeze({
      sources: Object.freeze(['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'sentinel2L2a', 'openMeteoPressureLevels', 'astronomy', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps', 'himalayaSkyNight', 'himalayaSkyTwilight', 'himalayaSkyTransition', 'himalayaSkyDay']),
      note: 'Provenance bar (with the sky regime: night observed, twilight observed fit, transition and day interpretive) and per-field provenance in the summit panel; sources and attributions panel.',
    }),
    'historical-time': Object.freeze({
      sources: Object.freeze(['astronomy', 'sentinel2L2a', 'openMeteoPressureLevels', 'himalayaSkyNight']),
      note: 'A date from Living Earth (up to 366 days back) and a Sun time-of-day slider: Sun, Moon and the sky follow it, Sentinel-2 shows the latest clear scene up to that date; summit weather only for the current day.',
    }),
    'live-layers': Object.freeze({
      sources: Object.freeze(['sentinel2L2a', 'openMeteoPressureLevels']),
      note: 'Latest clear Sentinel-2 L2A scene of the last 30 days; current Open-Meteo GFS run at summit height.',
    }),
  }),
});

// Optional limits of a declared capability (text shown in the inspector), for an
// observatory without an evidence map. LOT 17: Living Earth historical time,
// from EARTH_TIME_CAPABILITIES (src/earth/temporal-provenance.js) and the
// time-scrub slider (365 days).
export const OBSERVATORY_CAPABILITY_LIMITS = Object.freeze({
  'living-earth': Object.freeze({
    'historical-time': 'Time-scrub up to 365 days back (one UTC day at a time). Follow the chosen day: NASA EONET and USGS earthquakes (7-day window), NASA FIRMS (from 1 Nov 2000, 1-day lag), Snow & ice (MODIS Terra, from 24 Feb 2000, 1-day lag, known gaps), wind (ERA5, about 6-day lag) and ocean currents (SMOC, from 2022, 1-day lag); the Sun, the Moon and the real sky follow the scene time. Hidden in history (live only): GDACS, aurora (OVATION), daily clouds, the ISS. Do not follow the date: the GVP volcano catalogue (as published today), Blue Marble, Black Marble 2016, ETOPO relief and the procedural airglow, zodiacal light and noctilucent clouds.',
  }),
});

// What an observatory explicitly has NOT measured (shown in the inspector).
// LOT 20: the GTX 1650 desktop, the real phone and the load times are now measured (OBSERVATORY_MEASURED).
export const OBSERVATORY_UNMEASURED = Object.freeze({
  'living-himalaya': Object.freeze([
    'Rendering headroom above 60 FPS: every measured run was capped by a 60 Hz display (vsync); 120 Hz+ screens not measured',
    'GPU time per frame on the phone (its browser exposes no GPU timer)',
    'Other GPUs and browsers (only GeForce GTX 1650 with Edge 157 on Windows and Adreno 740 with Edge 157 on Android were measured)',
  ]),
  // LOT 29: Living Earth measured on the GTX 1650 desktop and the real phone (OBSERVATORY_MEASURED).
  'living-earth': Object.freeze([
    'Rendering headroom above 60 FPS: both measured runs were capped by a 60 Hz display (vsync); 120 Hz+ screens not measured',
    'GPU time per frame and the sky cost on the phone (its browser exposes no GPU timer)',
    'JavaScript memory on the phone (its browser reports a fixed coarse value)',
    'Wind and currents of a past day (ERA5 / SMOC through the proxy): scenario B measured the live Open-Meteo fields only',
    'Other GPUs and browsers (only GeForce GTX 1650 with Edge 157 on Windows and Adreno 740 with Edge 157 on Android were measured)',
  ]),
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

// LOT 20: measured performance, one entry per real-device run of the ?perf=1 mode (schema
// lumi-himalaya-perf/1; LOT 29: Living Earth, lumi-earth-perf/1). Values copied from the reports in docs/perf/ (versioned, not deployed);
// tests compare every value and the SHA-256 with the files. Frame times in ms (rAF intervals),
// GPU = TIME_ELAPSED per frame, load = ms since the navigation start, summit switch = Everest -> K2.
export const OBSERVATORY_MEASURED = deepFreeze({
  'living-himalaya': [
   {
    "id": "2026-11-18-desktop-gtx1650-edge157",
    "role": "desktop",
    "primary": true,
    "device": "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "browser": "Edge 157 desktop (Windows)",
    "date": "2026-11-18",
    "createdAt": "2026-11-18T08:43:13.919Z",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0",
    "devicePixelRatio": 1.25,
    "viewport": [
     1528,
     698
    ],
    "canvas": [
     1910,
     872
    ],
    "headless": false,
    "allScenariosValid": true,
    "refreshHz": 60,
    "frames": {
     "A": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.9
     },
     "B": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.9
     },
     "C": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 17.3
     },
     "E": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.9
     }
    },
    "gpu": {
     "A": {
      "p50Ms": 2.092,
      "p95Ms": 6.342
     },
     "B": {
      "p50Ms": 2.289,
      "p95Ms": 5.87
     },
     "C": {
      "p50Ms": 2.413,
      "p95Ms": 5.666
     },
     "E": {
      "p50Ms": 3.058,
      "p95Ms": 3.337
     }
    },
    "skyGpuMs": {
     "A": 0.332,
     "C": 0.135
    },
    "memory": {
     "A": {
      "usedMB": 78.6
     },
     "B": {
      "usedMB": 72
     },
     "C": {
      "usedMB": 70.4
     },
     "E": {
      "usedMB": 105.4
     }
    },
    "load": {
     "firstFrameMs": 525,
     "reliefReadyMs": 1392
    },
    "summitSwitch": {
     "firstReadyMs": 667,
     "firstSource": "http-cache",
     "secondReadyMs": 417,
     "secondSource": "memory"
    },
    "file": "docs/perf/2026-11-18-desktop-gtx1650-edge157.json",
    "sha256": "5e11e530c38b7ad53930b677aedf7bbeaf77bb016d546a436f29fafa45fca542",
    "note": "Owner run on the production site, Windows desktop, 60 Hz display (all scenarios vsync-limited: frame times show the refresh, GPU time shows the rendering cost). The report does not record the page origin; production is as stated by the owner."
   },
   {
    "id": "2026-11-18-mobile-adreno740-edge157",
    "role": "mobile",
    "primary": true,
    "device": "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
    "browser": "Edge 157 Android",
    "date": "2026-11-18",
    "createdAt": "2026-11-18T08:52:29.981Z",
    "userAgent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36 EdgA/157.0.0.0",
    "devicePixelRatio": 4,
    "viewport": [
     360,
     615
    ],
    "canvas": [
     720,
     1232
    ],
    "headless": false,
    "allScenariosValid": true,
    "refreshHz": 60,
    "frames": {
     "A": {
      "p50Ms": 16.7,
      "p95Ms": 16.7,
      "maxMs": 16.8
     },
     "B": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     },
     "C": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     },
     "E": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     }
    },
    "gpu": "GPU timer unavailable",
    "skyGpuMs": null,
    "memory": "not measurable (browser reports a fixed coarse value)",
    "load": {
     "firstFrameMs": 443,
     "reliefReadyMs": 1268
    },
    "summitSwitch": {
     "firstReadyMs": 628,
     "firstSource": "http-cache",
     "secondReadyMs": 417,
     "secondSource": "memory"
    },
    "file": "docs/perf/2026-11-18-mobile-adreno740-edge157.json",
    "sha256": "03f365920165b120ff6e2409786a97ca50a85b21012c00737dcf57dfbfdcacff",
    "note": "Owner run on the production site, real phone in its normal mobile layout (bottom sheet), 60 Hz. The browser exposes no GPU timer; its JS memory figures are a fixed coarse value (76.6 / 91.7 MB in every scenario of both phone runs), so memory is not measurable here."
   },
   {
    "id": "2026-11-18-mobile-adreno740-edge157-desktopsite",
    "role": "mobile-desktop-site",
    "primary": false,
    "device": "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
    "browser": "Edge 157 Android (Desktop-site mode)",
    "date": "2026-11-18",
    "createdAt": "2026-11-18T08:46:41.489Z",
    "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.4341.53",
    "devicePixelRatio": 4,
    "viewport": [
     980,
     1676
    ],
    "canvas": [
     1960,
     3352
    ],
    "headless": false,
    "allScenariosValid": true,
    "refreshHz": 60,
    "frames": {
     "A": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 108.3
     },
     "B": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     },
     "C": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 25.1
     },
     "E": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 41.8
     }
    },
    "gpu": "GPU timer unavailable",
    "skyGpuMs": null,
    "memory": "not measurable (browser reports a fixed coarse value)",
    "load": {
     "firstFrameMs": 845,
     "reliefReadyMs": 2105
    },
    "summitSwitch": {
     "firstReadyMs": 1532,
     "firstSource": "network",
     "secondReadyMs": 417,
     "secondSource": "memory"
    },
    "file": "docs/perf/2026-11-18-mobile-adreno740-edge157-desktopsite.json",
    "sha256": "520998ff54504faee95dec573a0260634dd81d075eb2536bb7e4d74bd7f544a7",
    "note": "Secondary: phone in Desktop-site mode (desktop UA, 980 px viewport, 1960×3352 canvas) — heavier than normal; mobile layout not exercised. Does not count as the mobile run."
   }
  ],
  // LOT 29: Living Earth (lumi-earth-perf/1, scenarios A-D, generated from docs/perf/ by
  // tmp/lot29/gen-measured.mjs): + GIBS surface / runtime LIVE times, sky A (day) / D (night), layout checks.
  'living-earth': [
   {
    "id": "2026-11-19-earth-desktop-gtx1650-edge157",
    "role": "desktop",
    "primary": true,
    "device": "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "browser": "Edge 157 desktop (Windows)",
    "date": "2026-11-19",
    "createdAt": "2026-11-19T13:16:19.390Z",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0",
    "devicePixelRatio": 1.25,
    "viewport": [
     1528,
     698
    ],
    "canvas": [
     1910,
     872
    ],
    "headless": false,
    "allScenariosValid": true,
    "refreshHz": 60,
    "frames": {
     "A": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 17
     },
     "B": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.9
     },
     "C": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 17
     },
     "D": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.9
     }
    },
    "gpu": {
     "A": {
      "p50Ms": 3.498,
      "p95Ms": 3.828
     },
     "B": {
      "p50Ms": 3.781,
      "p95Ms": 3.9
     },
     "C": {
      "p50Ms": 3.544,
      "p95Ms": 4.842
     },
     "D": {
      "p50Ms": 3.789,
      "p95Ms": 4.778
     }
    },
    "skyGpuMs": {
     "A": 0.293,
     "D": 0.281
    },
    "memory": {
     "A": {
      "usedMB": 43.3
     },
     "B": {
      "usedMB": 49.5
     },
     "C": {
      "usedMB": 47.7
     },
     "D": {
      "usedMB": 47.2
     }
    },
    "load": {
     "firstFrameMs": 966,
     "surfaceShownMs": 1617,
     "runtimeLiveMs": 4805
    },
    "layout": {
     "mobileLayout": false,
     "allPass": true,
     "checks": [
      {
       "id": "viewport",
       "pass": true,
       "value": [
        1528,
        698
       ]
      },
      {
       "id": "no-horizontal-scroll",
       "pass": true,
       "value": {
        "scrollWidth": 1528,
        "innerWidth": 1528
       }
      },
      {
       "id": "hud-toggle",
       "pass": true,
       "value": {
        "present": true,
        "shown": false
       }
      },
      {
       "id": "buttons-in-viewport",
       "pass": true,
       "value": {
        "checked": 43,
        "outside": []
       }
      },
      {
       "id": "base-text-px",
       "pass": true,
       "value": {
        "minPx": 12,
        "elements": 3,
        "bodyPx": 16
       }
      }
     ]
    },
    "layoutAllPass": true,
    "file": "docs/perf/2026-11-19-earth-desktop-gtx1650-edge157.json",
    "sha256": "b1eb8dc8893e0ac5472ce13acca88251d870e49d50ff487b6eb5b5f4877b7aa4"
   },
   {
    "id": "2026-11-19-earth-mobile-adreno740-edge157",
    "role": "mobile",
    "primary": true,
    "device": "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
    "browser": "Edge 157 Android",
    "date": "2026-11-19",
    "createdAt": "2026-11-19T13:16:12.530Z",
    "userAgent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36 EdgA/157.0.0.0",
    "devicePixelRatio": 4,
    "viewport": [
     360,
     615
    ],
    "canvas": [
     720,
     1230
    ],
    "headless": false,
    "allScenariosValid": true,
    "refreshHz": 60,
    "frames": {
     "A": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     },
     "B": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 25.1
     },
     "C": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     },
     "D": {
      "p50Ms": 16.7,
      "p95Ms": 16.8,
      "maxMs": 16.8
     }
    },
    "gpu": "GPU timer unavailable",
    "skyGpuMs": null,
    "memory": "not measurable (browser reports a fixed coarse value)",
    "load": {
     "firstFrameMs": 2725,
     "surfaceShownMs": 4200,
     "runtimeLiveMs": 6199
    },
    "layout": {
     "mobileLayout": true,
     "allPass": true,
     "checks": [
      {
       "id": "viewport",
       "pass": true,
       "value": [
        360,
        615
       ]
      },
      {
       "id": "no-horizontal-scroll",
       "pass": true,
       "value": {
        "scrollWidth": 360,
        "innerWidth": 360
       }
      },
      {
       "id": "hud-toggle",
       "pass": true,
       "value": {
        "before": true,
        "afterFirst": false,
        "afterSecond": true
       }
      },
      {
       "id": "buttons-in-viewport",
       "pass": true,
       "value": {
        "checked": 44,
        "outside": []
       }
      },
      {
       "id": "base-text-px",
       "pass": true,
       "value": {
        "minPx": 12,
        "elements": 3,
        "bodyPx": 16
       }
      }
     ]
    },
    "layoutAllPass": true,
    "file": "docs/perf/2026-11-19-earth-mobile-adreno740-edge157.json",
    "sha256": "6b208098fb08c7e4c3558ff51fe20aa7463ed4bcba5ef9dedec0fea5db2dc358"
   }
  ],
});

export function getCapabilityDefinition(capabilityId) {
  return CAPABILITY_DEFINITIONS[capabilityId] || null;
}

export function getObservatoryCapabilities(observatoryId) {
  return OBSERVATORY_CAPABILITIES[observatoryId] || EMPTY_CAPABILITIES;
}

export function getCapabilityEvidence(observatoryId, capabilityId) {
  return OBSERVATORY_CAPABILITY_EVIDENCE[observatoryId]?.[capabilityId] || null;
}

export function getCapabilityLimits(observatoryId, capabilityId) {
  return OBSERVATORY_CAPABILITY_LIMITS[observatoryId]?.[capabilityId] || null;
}

export function getObservatoryMeasured(observatoryId) {
  return OBSERVATORY_MEASURED[observatoryId] || EMPTY_CAPABILITIES;
}

const fmtMs = (v) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 1 ? 2 : 1 })} ms`;
/** GPU name from a WebGL renderer string, e.g. "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)" -> "Adreno 740". */
export function gpuName(renderer) {
  const field = String(renderer).match(/^ANGLE \([^,]+, ([^,]+)/)?.[1] || String(renderer);
  return field.replace(/\(TM\)\s*/g, '').replace(/\s*\(0x[0-9A-Fa-f]+\).*$/, '').replace(/\s+(Direct3D|OpenGL).*$/, '').trim();
}

/** LOT 21: short run title, e.g. "Desktop · GTX 1650 · Edge 157" / "Phone · Adreno 740 · Edge 157 Android". */
export function measuredRunTitle(run) {
  const who = run.role === 'desktop' ? 'Desktop' : 'Phone';
  const gpu = gpuName(run.device).replace(/^NVIDIA GeForce /, '');
  const browser = run.browser.replace(/ desktop \(Windows\)$/, '').replace(/ \(Desktop-site mode\)$/, '');
  return `${who} · ${gpu} · ${browser}`;
}

/**
 * LOT 21: the inspector's view of one run - a title, a subtitle (date, viewport, canvas) and
 * key-value rows, all derived from OBSERVATORY_MEASURED (no value of its own).
 */
export function measuredRunView(run) {
  const scenarios = Object.values(run.frames);
  const maxOf = (values) => Math.max(...values);
  // Numbers without a unit, the unit once per value: "16.7 / 16.8 / 17.3 ms".
  const num = (v) => fmtMs(v).replace(/ ms$/, '');
  const span = (values) => { const lo = Math.min(...values); const hi = Math.max(...values); return lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`; };
  const rows = [
    ['Frames (p50 / p95 / max)', `${span(scenarios.map((s) => s.p50Ms))} / ${num(maxOf(scenarios.map((s) => s.p95Ms)))} / ${num(maxOf(scenarios.map((s) => s.maxMs)))} ms · ${run.refreshHz} Hz vsync`],
    ['GPU (p50 / p95)', typeof run.gpu === 'string' ? run.gpu : `${span(Object.values(run.gpu).map((g) => g.p50Ms))} / ≤ ${num(maxOf(Object.values(run.gpu).map((g) => g.p95Ms)))} ms`],
  ];
  // Day / night sky keys: Himalaya A / C, Living Earth A / D (LOT 29).
  if (run.skyGpuMs) { const [day, night] = Object.values(run.skyGpuMs); rows.push(['Sky (day / night)', `${num(day)} / ${num(night)} ms`]); }
  if (run.summitSwitch) {
    rows.push(
      ['First frame', fmtMs(run.load.firstFrameMs)],
      ['Relief ready', fmtMs(run.load.reliefReadyMs)],
      ['Everest → K2 (first / second)', `${num(run.summitSwitch.firstReadyMs)} ms, ${run.summitSwitch.firstSource} / ${num(run.summitSwitch.secondReadyMs)} ms, ${run.summitSwitch.secondSource}`],
    );
  } else {
    // LOT 29 (Living Earth): page-load times and the layout checks of the same run.
    rows.push(
      ['First frame', fmtMs(run.load.firstFrameMs)],
      ['GIBS surface shown', fmtMs(run.load.surfaceShownMs)],
      ['Runtime LIVE', fmtMs(run.load.runtimeLiveMs)],
      ['Layout', layoutSummary(run.layout)],
    );
  }
  return { title: measuredRunTitle(run), subtitle: `${run.date} · viewport ${run.viewport.join('×')} · canvas ${run.canvas.join('×')}`, rows };
}

/** LOT 29: "mobile layout · 5 of 5 checks pass" (or the failed check ids). */
export function layoutSummary(layout) {
  const failed = layout.checks.filter((c) => !c.pass).map((c) => c.id);
  return `${layout.mobileLayout ? 'mobile' : 'desktop'} layout · ${layout.checks.length - failed.length} of ${layout.checks.length} checks pass${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`;
}

const range = (values) => { const lo = Math.min(...values); const hi = Math.max(...values); return lo === hi ? fmtMs(lo) : `${fmtMs(lo)}–${fmtMs(hi)}`; };
/** One line per measured run for the inspector. */
export function describeMeasuredRun(run) {
  const scenarios = Object.values(run.frames);
  const gpu = typeof run.gpu === 'string' ? run.gpu : `GPU p50 ${range(Object.values(run.gpu).map((g) => g.p50Ms))}, p95 ≤ ${fmtMs(Math.max(...Object.values(run.gpu).map((g) => g.p95Ms)))}`;
  const [skyDay, skyNight] = run.skyGpuMs ? Object.values(run.skyGpuMs) : [];
  const sky = run.skyGpuMs ? `; sky ${fmtMs(skyDay)} by day, ${fmtMs(skyNight)} at night` : '';
  const who = run.role === 'desktop' ? 'Desktop' : run.role === 'mobile' ? 'Phone' : 'Phone, Desktop-site mode (secondary)';
  return `${who} · ${gpuName(run.device)} · ${run.browser} · ${run.date} · ${run.viewport.join('×')} CSS px (canvas ${run.canvas.join('×')}): `
    + `frames p50 ${range(scenarios.map((s) => s.p50Ms))} (${run.refreshHz} Hz vsync), p95 ≤ ${fmtMs(Math.max(...scenarios.map((s) => s.p95Ms)))}, max ≤ ${fmtMs(Math.max(...scenarios.map((s) => s.maxMs)))}; ${gpu}${sky}; `
    + (run.summitSwitch
      ? `first frame ${fmtMs(run.load.firstFrameMs)}, relief ready ${fmtMs(run.load.reliefReadyMs)}; Everest → K2 ${fmtMs(run.summitSwitch.firstReadyMs)} (${run.summitSwitch.firstSource}), again ${fmtMs(run.summitSwitch.secondReadyMs)} (${run.summitSwitch.secondSource}).`
      : `first frame ${fmtMs(run.load.firstFrameMs)}, GIBS surface ${fmtMs(run.load.surfaceShownMs)}, runtime LIVE ${fmtMs(run.load.runtimeLiveMs)}; ${layoutSummary(run.layout)}.`);
}

export function getObservatoryUnmeasured(observatoryId) {
  return OBSERVATORY_UNMEASURED[observatoryId] || EMPTY_CAPABILITIES;
}

export function hasObservatoryCapability(observatoryId, capabilityId) {
  return getObservatoryCapabilities(observatoryId).includes(capabilityId);
}
