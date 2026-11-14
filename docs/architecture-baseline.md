# Architecture baseline — F0

## Identity and scope

- Baseline date: 2026-09-05
- Branch: `dev/post-hackathon`
- HEAD: `9a8b978d0540fe6d566f657a8b85d5314f2756db`
- Node: `v22.22.2`
- npm: `10.5.0`
- Working tree: **dirty before F0**; staging was empty.

Pre-existing modifications: `earth-eonet-relief.html`,
`src/earth/app-services.js`, `src/earth/earth-appearance.js`,
`src/earth/export-system.js`, `src/earth/living-earth-module.js`,
`src/earth/scene-runtime.js` (27 insertions, 18 deletions). An untracked image,
`assets/ChatGPT Image Aug 17, 2026, 09_33_03 AM.png`, was also present.
These changes are not part of F0; F0 does not touch those files. This document
describes the inspected working tree, not a claim that HEAD alone reproduces it.

## Current platform topology

```text
Platform Registry
 ├─ Observatory Registry / Module Contract
 ├─ Module Host / Module Context
 ├─ DataBroker
 ├─ Request Runtime
 ├─ Persistent Cache
 ├─ Runtime Status
 ├─ Diagnostics / Replay
 ├─ Atlas
 ├─ Gateway
 ├─ Living Earth
 └─ Living Protein
```

This is a responsibility map, not a single object owning every service.
`src/core/platform-registry.js` validates observatory definitions from
`src/config/` and creates module contexts. The host provides start/stop/destroy
and snapshots. Contexts provide cancellation and cleanup registration.

**Shared implementation != shared runtime instance.** Atlas coordinates Earth
and Protein through same-origin iframe adapters. Each child initializes its own
module host and JavaScript runtime. Shared-origin persistent storage does not
make in-memory requests, status, offline control or replay one global instance.
The current platform is not a fully unified runtime.

`src/core/data-broker.js` wraps request/cache infrastructure. The request runtime
implements retry, timeout, deduplication, subscriber abort and fresh/stale
handling. Persistent cache uses IndexedDB, localStorage or memory. Diagnostics
and replay operate on the runtime passed to them. `sw.js` adds a separate browser
cache layer for shell, GIBS and selected live feeds.

Gateway owns a separate WebGL preview renderer and quality/prefetch policies,
with two explicit slots. Earth uses Three.js and composes scene, scientific
systems, feeds, visual layers and export. Protein uses Three.js, AlphaFold and
UniProt providers, geometry analysis and a module wrapper.

`nasa-proxy-server.js` is a CommonJS Node server with fixed-source proxy routes
and FFmpeg conversion. Frontend `.js` is ESM. The package has no `type: module`;
F0 preserves this distinction. Critical browser dependencies remain CDN imports
(including Three.js 0.185.1); the npm lockfile currently covers test tooling,
not a reproducible production build. CI uses Node 22 and `npm ci`.

## Executable evidence

The preceding baseline audit established:

- Actual registry validation: 11 observatories, valid, no errors or warnings.
- Vitest: 6 test files / 25 tests passed.
- Syntax: 148 JavaScript/module files checked / 0 failures before F0 scripts.
- Shared Earth runtime smoke: EONET, USGS and OVATION made 3 initial requests;
  repeating the calls kept total requests at 3, with 3 cache hits and matching
  diagnostic keys. This is bounded evidence, not global iframe replay proof.
  The historical smoke lived in ignored local validation storage, not CI.
- No GitHub Actions run was found for this exact HEAD in the baseline audit;
  successful runs on other SHAs do not validate this dirty tree.

F0 acceptance commands are `npm run check:syntax`, `npm test`,
`npm run validate:registry`, and `npm run verify:f0`. The syntax script includes
the two new F0 tools; the count is computed, not frozen at 148. CI now invokes
`verify:f0`; a local pass does not claim that this uncommitted CI revision ran
on GitHub. These gates do not measure browser visuals, GPU performance or
production security.

## Known P0 blockers

### Lifecycle race — scheduled for F1

The audit reproduced this ordering in the actual module context:

```text
start pending
→ destroy
→ state = destroyed
→ initializer resolves later
→ state becomes running (cleanup calls = 0)
```

Invariant: **destroyed must be terminal**. The late initializer is not guarded
against destruction. Iframe readiness failure also needs resource ownership
coverage. Cleanup implementations exist, but 20 mount/destroy cycles and zero
remaining requests/timers/RAF are not established. F0 does not fix this race.

### H.264 service boundary — scheduled for F2

`/convert-h264` requires dedicated access/security/resource-boundary hardening.
Code-level concerns: 300 MiB request allowance buffered in memory, FFmpeg process
lifetime (5-minute timeout), absent concurrency/resource budgets, no explicit
client-disconnect cancellation, access boundary (CORS is not authorization and
listen does not specify loopback), and whole-output MP4 buffering in memory.
This does **not** establish Internet exposure: deployment evidence is required.
F0 does not harden the endpoint. The proxy also declares a cache TTL without
applying it to skip fresh upstream requests.

## Data and provenance debt

1. **DataBroker paths:** Protein AlphaFold/UniProt; Earth EONET, USGS, OVATION,
   CelesTrak via `earth-data-runtime.js`; Gateway preview resources.
2. **Shared infrastructure without broker facade:** GDACS uses
   `defineFeedAdapter` → shared request runtime. This is reuse, not an independent
   networking architecture. Event providers need not become visual plugins.
3. **Independent fetch/cache paths:** FIRMS, GVP, Wind, Ocean currents and
   `layer-plugin-registry`. Wind/Marine use sessionStorage. *LOT 5 (Nov 2026):*
   a second USGS path existed, `src/earth/live-seismic-layer.js` (direct
   `fetch()` on `all_day.geojson`, never imported by the app); it was removed,
   and USGS is now requested only by `usgs-earthquakes.js` through
   `earth-data-runtime.js` / DataBroker (summary feeds in Live, FDSN
   `starttime/endtime` for a historical day; see `tests/usgs-single-path.test.js`).
   Image/TextureLoader, service-worker requests and conversion jobs also have
   distinct paths; direct fetch is not automatically wrong, but the policy,
   ownership and provenance must be explicit. Code presence alone does not
   prove a layer is active in the current UI.

The global source registry is incomplete for at least Open-Meteo Wind,
Open-Meteo Marine and Smithsonian GVP. Local layer provenance is not equivalent
to global registration. GIBS has a generic entry but multiple Earth products
and processing paths; the runtime resource catalog is also incomplete.

## P0–P8 state against platform roadmap V4

| Milestone | Status | Remaining evidence / implementation gap |
| --- | --- | --- |
| P0 Baseline Freeze | PARTIAL | Versionable baseline begins here; current captures/performance and freeze remain |
| P1 Build Foundation | PARTIAL | npm test setup exists; production dependency/build freeze absent |
| P2 Observatory Module Contract | ADVANCED / PARTIAL | Registry/host/adapters exist; async terminal-state integrity and full contract coverage incomplete |
| P3 Unified Data Runtime | PARTIAL | Partial provider migration, separate iframe instances |
| P4 Server Gateway | PARTIAL | Proxy exists; health/access/resource hardening incomplete |
| P5 Lifecycle / Resource Ownership | BLOCKED | Reproduced start/destroy race; resource-cycle gate absent |
| P6 Platform Quality Service | PARTIAL | Gateway and observatory rules remain separate |
| P7 Provenance Service | PARTIAL | Registry/inspector exist; source coverage and asset lineage incomplete |
| P8 Testing / CI / Regression | PARTIAL | Unit/foundation gate exists; browser/core/lifecycle/security/performance gates incomplete |

No milestone is COMPLETE without current evidence satisfying its roadmap gate.
Roadmap V4 describes an older archive: statements that package/proxy/tests do
not exist are stale. July performance notes are historical, not current GPU
acceptance. Their pre/post-KTX2 comparison needs raw-capture accounting review;
do not rely on an unverified memory-reduction percentage. F0 has no new FPS or
Spector measurement.

## Next sequence

```text
F0 Repository Contract & Versionable Baseline
F1 Async Lifecycle Integrity & Resource Ownership
F2 H.264 Boundary Hardening
F3 Baseline Freeze / Current Performance Evidence
F4 Reproducible Build Foundation
F5 Data + Provenance Closure
F6 Core Verification Expansion
Gate 1
then resume visual/scientific roadmap work
```
