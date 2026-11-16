# LUMINOMORPHISM — Roadmap V4 pentru platforma multi-observator
## Fundație comună, observatoare existente și portofoliu extins de module cu impact

**Versiune document:** 4.0  
**Data:** iulie 2026  
**Bază:** `luminomorphism-platform-roadmap-adaptat-v3.md`  
**Proiect analizat:** `index.zip`  
**Principiu director:** **Measured first → Physics second → Generative residual last**

---

# Notă de compatibilitate V4

Versiunea 4 **nu elimină și nu înlocuiește niciun element din V3**.

Documentul V3 este păstrat integral în **Partea I**. Partea a II-a adaugă:

- un portofoliu de opt observatoare noi;
- o selecție prioritară de minimum cinci module cu impact;
- extensii de taxonomie pentru module matematice și computaționale;
- contracte de integrare în Atlas, Gateway, Runtime, Provenance, Quality și Editorial;
- surse de date candidate și niveluri de reprezentare;
- MVP-uri, etape, riscuri, criterii de acceptare și bugete de performanță;
- o ordine realistă de implementare care nu blochează fundația stabilită în V3.

## Cele cinci module recomandate cu prioritate maximă

1. **Living Sun Observatory** — legătura dintre spațiul cosmic, vremea spațială și Living Earth;
2. **Living Cell Observatory** — continuarea naturală Protein → Cell;
3. **Quantum Materials Observatory** — transformarea Phase Lab într-un observator al materialelor reale;
4. **Living Ocean Observatory** — un observator planetar bazat pe curenți, temperatură și biogeochimie;
5. **Living Brain Observatory** — structură neuronală și conectivitate, cu separarea strictă a scărilor și provenienței.

## Module suplimentare recomandate

6. **Living Cosmos Observatory** — Gaia, exoplanete și dinamica vecinătății galactice;
7. **Dynamical Systems Observatory** — haos, atractori, bifurcații și sisteme emergente;
8. **Network Pulse Observatory** — topologia și latența Internetului din măsurători publice, fără trafic privat.

---

# PARTEA I — ROADMAP V3 PĂSTRAT INTEGRAL

Următorul conținut este inclus integral pentru continuitate, auditabilitate și compatibilitate cu deciziile deja luate.

---

# LUMINOMORPHISM — Roadmap adaptat pentru platforma multi-observator
## Arhitectură modulară, runtime comun, proveniență, realism și evoluția observatoarelor

**Versiune document:** 3.0  
**Data:** iulie 2026  
**Proiect analizat:** arhiva `index.zip`  
**Direcție:** platformă extensibilă de observatoare științifico-vizuale  
**Principiu director:** **Measured first → Physics second → Generative residual last**

---

# 1. Concluzia arhitecturală principală

Proiectul analizat nu mai este un singur produs numit *Living Earth Observatory*.

Este deja începutul unei platforme mai mari, alcătuită din:

1. **Atlas / Platform Shell** — pagina principală, taxonomia, prezentarea observatoarelor și proveniența;
2. **Gateway Renderer** — portalurile vizuale care preîncarcă și reprezintă observatoarele;
3. **Platform Runtime** — request runtime, cache persistent, statusuri, control offline și diagnostic replay;
4. **Living Earth Observatory** — observatorul planetar complet;
5. **Living Protein Observatory** — observatorul molecular;
6. **viitoare observatoare** — sisteme din familiile cosmic, matter & fields, mathematical și computational.

Prin urmare, roadmapul anterior dedicat realismului Pământului nu trebuie eliminat, dar trebuie mutat într-un **track specializat Earth**.

Roadmapul principal trebuie să răspundă mai întâi la întrebarea:

> Cum devine fiecare observator un modul autonom, conectat la același runtime, aceeași proveniență, aceleași diagnostice și aceeași platformă editorială?

Abia apoi se dezvoltă în paralel:

- realismul Living Earth;
- maturizarea Living Protein;
- integrarea Perceptual Phase Lab;
- viitoarele observatoare.

---

# 2. Ce a fost analizat

Arhiva conține aproximativ:

- **142 de fișiere**;
- **109 module JavaScript**;
- aproximativ **18.000 de linii JavaScript**;
- aproximativ **18,6 MB** de active și cod;
- două observatoare complete sau funcționale;
- un Gateway custom WebGL;
- un runtime avansat de cache și diagnostic;
- șase familii și zece scări pregătite în taxonomia platformei.

Distribuția aproximativă a codului JavaScript:

| Zonă | Fișiere | Linii aproximative |
|---|---:|---:|
| `src/earth/` | 58 | 11.135 |
| `src/gateway/` | 24 | 2.698 |
| `src/core/` | 11 | 1.782 |
| `src/control-center/` | 2 | 825 |
| `src/atlas/` | 4 | 746 |
| `src/protein/` | 5 | 533 |
| `src/config/` | 3 | 193 |
| bootstrap și continuitate | 2 | 175 |

Toate modulele JavaScript au trecut verificarea sintactică `node --check`.

Importurile relative existente se rezolvă corect în structura arhivei.

---

# 3. Harta reală a proiectului

```text
LUMINOMORPHISM
│
├── Platform Shell
│   ├── index.html
│   ├── atlas
│   ├── taxonomy
│   ├── source inspector
│   ├── telemetry
│   └── runtime control center
│
├── Gateway
│   ├── custom WebGL portal renderer
│   ├── portal adapters
│   ├── portal materials
│   ├── prefetch budget
│   ├── quality manager
│   └── portal interaction / continuity
│
├── Shared Platform Runtime
│   ├── data broker
│   ├── request runtime
│   ├── persistent cache
│   ├── source status store
│   ├── observatory runtime store
│   ├── offline simulation
│   ├── diagnostic snapshot
│   └── diagnostic replay
│
├── Living Earth Observatory
│   ├── Three.js scene
│   ├── Earth material and atmosphere
│   ├── astronomical systems
│   ├── live data layers
│   ├── event storytelling
│   ├── vertical director
│   └── export system
│
├── Living Protein Observatory
│   ├── AlphaFold provider
│   ├── UniProt provider
│   ├── C-alpha geometry
│   ├── pLDDT encoding
│   └── feature inspector
│
└── Future Observatory Modules
    ├── Perceptual Phase Lab
    ├── cosmic observatories
    ├── matter & fields
    ├── mathematical systems
    └── computational systems
```

---

# 4. Punctele forte care trebuie conservate

## 4.1 Registry și taxonomie deja bine concepute

`src/config/platform-taxonomy.js` definește deja:

- familii;
- scări;
- statusuri;
- clase de reprezentare.

`src/config/observatory-registry.js` descrie observatoarele fără a codifica direct interfața în renderer.

Aceasta este fundația corectă pentru o platformă extensibilă.

Nu trebuie înlocuită cu o listă nouă, ci extinsă cu un contract de modul.

## 4.2 Gateway bazat pe adaptoare

Gateway-ul are deja:

- adapter registry;
- material registry;
- prefetch policies;
- prefetch budget;
- resource policies;
- validarea sloturilor.

Aceasta este o bază bună pentru preview-uri specifice fiecărui observator.

## 4.3 Request runtime și cache persistent

`src/core/runtime/request-runtime.js` implementează deja:

- cache fresh;
- stale-if-error;
- timeout;
- retry cu backoff;
- request deduplication;
- abort pe subscriber;
- conditional requests;
- diagnostic records;
- offline simulation.

Aceasta este una dintre cele mai valoroase componente ale proiectului și trebuie să devină infrastructura tuturor observatoarelor, nu doar a Gateway-ului.

## 4.4 Diagnostic snapshot și replay

Proiectul poate:

- exporta statusurile;
- exporta request diagnostics;
- include payloaduri de cache;
- verifica integritatea snapshotului;
- activa un replay izolat;
- reveni la starea anterioară.

Această funcție este neobișnuit de matură pentru stadiul proiectului.

Trebuie păstrată și extinsă către Earth, Protein și viitoarele module.

## 4.5 Living Earth este deja modularizat funcțional

Deși este mare, Earth nu mai este un monolit unic.

Există module separate pentru:

- atmosferă;
- materiale;
- nori;
- Lună;
- ISS;
- airglow;
- lumină zodiacală;
- nori noctilucenți;
- EONET;
- USGS;
- FIRMS;
- GDACS;
- auroră;
- export;
- camera editorială;
- captions;
- reel timeline.

Acest lucru permite evoluția incrementală fără rescriere completă.

## 4.6 Living Protein are o delimitare științifică sănătoasă

Modulul separă explicit:

- predicția AlphaFold;
- pLDDT ca încredere a modelului;
- adnotările UniProt;
- fallback-ul ilustrativ;
- linkurile către structuri experimentale PDB.

Această disciplină de proveniență trebuie transformată într-un standard al platformei.

---

# 5. Problemele arhitecturale reale

## 5.1 Există două runtime-uri paralele

Aceasta este problema principală.

### Runtime-ul platformei

Folosit de Gateway:

```text
dataBroker
requestRuntime
persistentCache
atlasStatus
observatoryRuntime
diagnosticSnapshot
diagnosticReplay
```

### Runtime-urile observatoarelor

Living Earth și Living Protein folosesc în mare parte:

- `fetch()` direct;
- propriile AbortController;
- propriile statusuri DOM;
- propriile fallback-uri;
- propriile timere;
- fără integrare completă în cache-ul platformei;
- fără includere completă în diagnostic replay.

Consecința este că platforma declară o infrastructură comună, dar observatoarele complete nu o folosesc încă.

### Decizia corectă

Prima etapă majoră nu trebuie să fie PBR, KTX2 sau un al treilea observator.

Trebuie să fie:

# **Unified Observatory Runtime**

---

## 5.2 Registry-ul descrie observatorul, dar nu definește modulul

În prezent registry-ul conține:

- metadate;
- route;
- family;
- scale;
- sources;
- gateway adapter;
- prefetch configuration.

Dar nu există un contract runtime comun pentru pagina completă a observatorului.

Lipsesc standarde precum:

```js
mount()
start()
pause()
resume()
getState()
getDiagnostics()
exportSnapshot()
destroy()
```

Fiecare observator pornește și se oprește diferit.

---

## 5.3 Gateway-ul este extensibil în registru, dar nu în shader

`GATEWAY_SLOT_COUNT = 2`.

Shaderul are:

```text
uPortalTex0
uPortalTex1
uPortalPrimary0
uPortalPrimary1
uPortalSignature0
uPortalSignature1
```

Materialele sunt codificate pentru:

- planetary sphere;
- molecular trace;
- procedural fallback.

Așadar, adăugarea unui al treilea observator în registry nu îl face automat disponibil în Gateway.

Gateway-ul actual este un **hero dual-portal**, nu încă un renderer arbitrar de N observatoare.

Acest lucru nu este o eroare, dar trebuie declarat ca limită de design.

---

## 5.4 Nu există un build reproducibil

Arhiva nu conține:

- `package.json`;
- lockfile;
- build config;
- test runner;
- server package;
- proxy server;
- CI.

Dependențele sunt încărcate de pe CDN:

- Three.js;
- addons Three.js;
- Earcut;
- Astronomy Engine;
- satellite.js;
- unele texturi lunare;
- texturi Earth din `threejs.org/examples`.

Aceasta afectează:

- reproducibilitatea;
- rularea offline;
- versionarea;
- securitatea supply-chain;
- stabilitatea demo-ului public;
- testele automate.

---

## 5.5 Proxy-ul este o dependență implicită, dar lipsește din pachet

Mai multe module se așteaptă la:

```text
nasa-proxy-server.js
```

și la endpointuri precum:

```text
/nasa-proxy
/convert-h264
```

Dar serverul nu se află în arhiva analizată.

Funcții afectate:

- GDACS;
- FIRMS;
- conversie H.264;
- posibil alte surse viitoare.

Roadmapul trebuie să introducă un serviciu server explicit și versionat.

---

## 5.6 Quality management este fragmentat

Gateway-ul are propriul quality manager.

Living Earth:

- fixează DPR până la 2;
- are SMAA, bloom și composer;
- nu folosește device tier comun.

Living Protein:

- fixează DPR până la 2;
- nu are profil adaptiv;
- nu se oprește când pagina nu este vizibilă.

Un telefon poate deschide module diferite cu reguli complet diferite.

Este necesar un **Platform Capability & Quality Service**.

---

## 5.7 Proveniența are două niveluri care nu trebuie confundate

Taxonomia existentă definește reprezentări:

- observed;
- reconstructed;
- physical-model;
- prediction;
- simulation;
- interpretive;
- fallback.

Roadmapul Earth definea transformări:

- measured;
- derived;
- interpolated;
- generated.

Acestea nu sunt concurente.

Trebuie folosite două axe.

### Axa A — natura reprezentării observatorului

```text
observed
reconstructed
physical-model
prediction
simulation
interpretive
fallback
```

### Axa B — linia de procesare a unui semnal sau activ

```text
measured
derived
physical-model
interpolated
interpretive
generated
fallback
```

Exemplu:

```text
VIIRS night lights
representation: observed
asset lineage: measured → log-normalized → colorized interpretive
```

---

## 5.8 Living Earth are un composition root prea mare

`src/earth/app-services.js` și `src/earth/app-runtime.js` coordonează foarte multe responsabilități.

Acest lucru este tolerabil într-un observator izolat, dar va deveni dificil pentru:

- testare;
- destroy complet;
- diagnostic snapshot;
- feature flags;
- Historical Playback;
- integrare în platformă.

Nu este recomandată o rescriere.

Este recomandată extragerea graduală a unor capability controllers.

---

## 5.9 Lifecycle-ul Earth nu este suficient pentru integrarea ca modul

Earth oprește:

- resize listeners;
- cloud timer;
- solar runtime;
- EONET auto refresh.

Dar nu există încă un `destroy()` unic care să garanteze oprirea:

- buclei `requestAnimationFrame`;
- Moon runtime;
- ISS runtime;
- live layers;
- scene interaction;
- renderer;
- composer;
- materiale;
- texturi;
- ResizeObserver;
- toate timerele.

În pagină separată browserul eliberează multe resurse la navigare.

Într-o platformă modulară sau SPA, aceasta ar produce scurgeri.

---

## 5.10 Editorial și export sunt aproape exclusiv Earth

Living Earth are:

- captions;
- reel timeline;
- vertical director;
- social presets;
- PNG;
- WebM;
- H.264 proxy.

Living Protein nu beneficiază de acest sistem.

Pe termen lung este necesar un **Editorial Runtime comun**, cu adaptoare specifice fiecărui observator.

---

## 5.11 Nu există teste automate

Nu există:

- unit tests;
- integration tests;
- visual regression;
- performance gates;
- schema validation în CI.

Complexitatea actuală justifică introducerea testelor înainte de schimbări PBR și migrare de runtime.

---

# 6. Decizia de produs: platformă, nu super-aplicație monolitică

Observatoarele trebuie să rămână izolate la nivel de renderer.

Nu este recomandat ca:

- Gateway;
- Earth;
- Protein;
- Phase Lab;

să ruleze toate simultan în aceeași scenă WebGL.

Modelul recomandat este:

```text
Atlas Shell
    ↓
Gateway Preview Adapter
    ↓
Observatory Route
    ↓
Observatory Module Runtime
```

Fiecare observator poate folosi:

- custom WebGL;
- Three.js;
- WebGL2;
- WebGPU experimental;
- canvas 2D;

fără a forța toate modulele într-un singur motor.

Platforma trebuie să unifice:

- contractul;
- datele;
- proveniența;
- diagnostica;
- calitatea;
- navigația;
- exportul;
- nu rendererul intern.

---

# 7. Arhitectura țintă

Nu se recomandă mutarea imediată a tuturor fișierelor.

Arhitectura țintă trebuie atinsă incremental.

```text
src/
├── config/
│   ├── platform-taxonomy.js
│   ├── observatory-registry.js
│   ├── source-registry.js
│   └── capability-registry.js
│
├── core/
│   ├── data/
│   │   ├── data-broker.js
│   │   ├── provider-runtime.js
│   │   └── snapshot-normalizer.js
│   ├── runtime/
│   ├── diagnostics/
│   ├── quality/
│   ├── provenance/
│   ├── editorial/
│   └── observatory/
│       ├── module-contract.js
│       ├── module-context.js
│       └── module-host.js
│
├── atlas/
├── gateway/
├── control-center/
│
├── earth/
│   ├── module.js
│   ├── manifest.js
│   └── ...codul actual
│
├── protein/
│   ├── module.js
│   ├── manifest.js
│   └── ...codul actual
│
├── phase/
│   ├── module.js
│   ├── manifest.js
│   └── renderer/
│
└── shared/
    ├── three/
    ├── assets/
    ├── math/
    ├── export/
    └── ui/
```

Server:

```text
server/
├── app
├── routes/
│   ├── nasa
│   ├── noaa
│   ├── firms
│   ├── gdacs
│   ├── conversion
│   └── health
├── cache/
├── config/
└── tests/
```

Pipeline offline:

```text
pipeline/
├── assets/
├── gis/
├── ktx2/
├── protein/
├── manifests/
└── qa/
```

---

# 8. Contractul Observatory Module

## 8.1 Manifest

```ts
interface ObservatoryManifest {
  id: string;
  title: string;
  family: string;
  scale: string;
  status: string;
  route: string;

  representations: string[];
  sourceIds: string[];
  capabilities: string[];

  gateway: {
    adapter: string;
    material: string;
    prefetch: object;
  };

  runtime: {
    version: string;
    renderer: "custom-webgl" | "three-webgl" | "three-webgpu";
    supportsHistoricalTime: boolean;
    supportsExport: boolean;
    supportsReplay: boolean;
  };
}
```

## 8.2 Runtime

```ts
interface ObservatoryModule {
  readonly manifest: ObservatoryManifest;

  mount(context: ObservatoryContext): Promise<void> | void;
  start(): Promise<void> | void;
  pause(reason?: string): void;
  resume(reason?: string): void;

  getState(): object;
  getDiagnostics(): object;
  exportSnapshot?(options?: object): Promise<object>;

  destroy(): Promise<void> | void;
}
```

## 8.3 Context furnizat de platformă

```ts
interface ObservatoryContext {
  root: HTMLElement;
  canvas?: HTMLCanvasElement;

  data: PlatformDataBroker;
  cache: PersistentCache;
  status: SourceStatusStore;
  runtime: ObservatoryRuntimeStore;
  quality: QualityService;
  provenance: ProvenanceService;
  diagnostics: DiagnosticsService;
  editorial?: EditorialService;

  signal: AbortSignal;
  initialState?: object;
}
```

---

# 9. Contractul Data Provider

Fiecare provider trebuie să evite `fetch()` direct în modul.

```ts
interface ObservatoryDataProvider<T> {
  id: string;
  sourceId: string;

  load(options?: {
    forceRefresh?: boolean;
    signal?: AbortSignal;
    time?: string;
  }): Promise<DataResult<T>>;

  normalize(raw: unknown): T;
  validate(value: T): ValidationResult;
}
```

Rezultat:

```ts
interface DataResult<T> {
  data: T;
  state: "live" | "stale" | "fallback" | "offline";
  provenance: ProvenanceRecord;
  runtime: RuntimeMeta;
}
```

---

# 10. Provenance Record unificat

```ts
interface ProvenanceRecord {
  sourceId: string;
  sourceName: string;

  representation:
    | "observed"
    | "reconstructed"
    | "physical-model"
    | "prediction"
    | "simulation"
    | "interpretive"
    | "fallback";

  lineage:
    | "measured"
    | "derived"
    | "physical-model"
    | "interpolated"
    | "interpretive"
    | "generated"
    | "fallback";

  timestamp: string | null;
  receivedAt: string;
  sourceVersion?: string;
  units?: string;
  projection?: string;
  processing?: string[];
  license?: string;

  stale: boolean;
  partial: boolean;
}
```

---

# 11. Strategia de migrare

## Regula principală

Nu se rescriu simultan:

- runtime-ul;
- rendererul;
- UI-ul;
- materialele;
- sursele de date.

Se migrează un singur strat la un moment dat.

## Ordine

```text
1. Freeze
2. Build reproducibil
3. Module contract
4. Runtime bridge
5. Migrare surse
6. Lifecycle
7. Quality/provenance
8. Abia apoi realism și module noi
```

---

# 12. ROADMAP MASTER AL PLATFORMEI

# MILESTONE P0 — Baseline Freeze și inventar

**Durată estimată:** 1 săptămână

## Obiective

- fixarea arhivei actuale ca baseline;
- definirea unui build id;
- inventarul surselor și activelor;
- capturi standard;
- măsurători de performanță;
- înregistrarea limitărilor cunoscute.

## Livrabile

```text
docs/current-architecture.md
docs/module-inventory.md
docs/source-inventory.md
docs/known-limitations.md
qa/baseline/
build-info.json
```

## Capturi obligatorii

### Atlas

- desktop;
- mobile;
- Gateway fallback;
- Gateway cu date;
- Runtime Control Center;
- diagnostic replay.

### Earth

- Scientific Earth;
- Cinematic Earth;
- Showcase Earth;
- zi;
- noapte;
- Lună;
- ISS;
- auroră;
- vertical reel.

### Protein

- p53;
- hemoglobină;
- feature focus;
- fallback offline.

## Criteriu de acceptare

Orice etapă ulterioară poate fi comparată cu baseline-ul fără memorie vizuală subiectivă.

---

# MILESTONE P1 — Build Foundation și dependency freeze

**Durată estimată:** 1–2 săptămâni

## Decizie recomandată

**Vite + ES Modules, fără Babel, fără JSX, fără React.**

Proiectul poate rămâne vanilla JavaScript.

## Livrabile

```text
package.json
package-lock.json
vite.config.js
scripts/
server/
```

Dependențe pin-uite:

- `three`;
- `earcut`;
- `astronomy-engine`;
- `satellite.js`;
- eventual `ktx-parse` sau addons Three;
- test runner.

## Reguli

- import map CDN eliminat din producție;
- CDN permis numai ca fallback explicit de development;
- texturile externe critice devin locale;
- toate versiunile se află în lockfile;
- `npm run dev`;
- `npm run build`;
- `npm run test`;
- `npm run preview`.

## Upgrade Three.js

Nu se combină upgrade-ul Three.js cu migrarea PBR.

Ordinea:

1. pin actual `0.160.0`;
2. visual parity;
3. upgrade separat;
4. visual regression;
5. abia apoi schimbări materiale.

## Criterii

- Atlas, Earth și Protein pornesc din același dev server;
- buildul de producție nu depinde de unpkg/jsDelivr pentru runtime critic;
- rutele și activele funcționează după build;
- buildul poate fi reprodus pe alt calculator.

---

# MILESTONE P2 — Observatory Module Contract

**Durată estimată:** 1–2 săptămâni

## Livrabile

```text
src/core/observatory/module-contract.js
src/core/observatory/module-context.js
src/core/observatory/module-host.js
src/config/capability-registry.js
```

## Implementare incrementală

### Living Protein — primul adaptor

Protein este mai mic și este candidatul ideal pentru prima implementare a contractului.

```js
createLivingProteinModule()
```

### Living Earth — bridge, nu rescriere

Earth primește un wrapper:

```js
createLivingEarthModule()
```

care apelează sistemele actuale.

## Capabilități standard

```text
data
provenance
historical-time
story
vertical-export
still-export
video-export
live-layers
diagnostic-replay
```

## Criterii

- fiecare observator poate fi pornit și oprit prin aceeași interfață;
- registry-ul validează capabilitățile;
- un observator necunoscut nu poate bloca Atlasul;
- `destroy()` este apelabil și idempotent.

---

# MILESTONE P3 — Unified Data Runtime

**Durată estimată:** 2–4 săptămâni

Acesta este milestone-ul cu cel mai mare impact arhitectural.

## 3.1 Migrare Living Protein

Înlocuire:

```js
fetch()
```

cu:

```js
dataBroker.fetchJsonResource()
dataBroker.fetchTextResource()
```

Resurse:

```text
alphafold:{accession}:metadata
alphafold:{accession}:pdb
uniprot:{accession}:profile
```

Politici:

- TTL 7 zile;
- stale TTL 30 zile;
- retry;
- request deduplication;
- abort;
- status platform;
- diagnostic replay.

## 3.2 Migrare Earth în loturi

### Lot 1 — simple CORS JSON

- EONET;
- USGS;
- NOAA OVATION.

### Lot 2 — text și modele orbitale

- CelesTrak TLE;
- Astronomy Engine import state;
- historical time state.

### Lot 3 — proxy sources

- GDACS;
- FIRMS;
- H.264 conversion.

### Lot 4 — image resources

- GIBS clouds;
- Blue Marble;
- VIIRS;
- atlas materials.

## 3.3 Status bridge

Fiecare provider publică:

- source status;
- observatory status;
- cache freshness;
- source timestamp;
- fallback reason;
- partial state.

## Criterii

- simularea offline afectează și Earth/Protein, nu doar Gateway-ul;
- sursele observatoarelor apar în Runtime Control Center;
- diagnostic snapshot include requesturile observatoarelor;
- replay poate reproduce un modul cu payloadurile cache.

---

# MILESTONE P4 — Server Gateway unificat

**Durată estimată:** 1–3 săptămâni

## Obiectiv

Înlocuirea dependențelor implicite de `nasa-proxy-server.js` cu un serviciu documentat.

## Endpointuri inițiale

```text
GET  /api/health
GET  /api/gdacs/events
GET  /api/firms/hotspots
GET  /api/noaa/swpc
GET  /api/assets/:id
POST /api/export/h264
```

## Cerințe

- allowlist de upstream;
- timeout;
- retry;
- cache;
- stale-if-error;
- rate limit;
- validare parametri;
- loguri;
- health check;
- variabile `.env`;
- fără chei în client.

## Alegerea tehnologiei

Ambele sunt valide:

### Node

Avantaj:

- compatibil cu actuala intenție `nasa-proxy-server.js`;
- același ecosistem JS;
- streaming și FFmpeg ușor.

### Python / FastAPI

Avantaj:

- foarte potrivit pentru pipeline GIS;
- rasterio și Earthdata;
- preprocesare științifică;
- familiaritate bună în proiect.

Recomandare:

- un singur serviciu FastAPI dacă pipeline-ul GIS va deveni parte din runtime;
- Node numai dacă proxy-ul actual există deja în afara arhivei și este stabil.

## Criterii

- toate funcțiile proxy sunt incluse în repository;
- modul public nu presupune un server invizibil;
- `/api/health` declară capabilitățile active;
- lipsa cheii FIRMS dezactivează doar FIRMS;
- lipsa FFmpeg dezactivează doar H.264.

---

# MILESTONE P5 — Lifecycle și resource ownership

**Durată estimată:** 1–2 săptămâni

## Living Earth

`destroy()` trebuie să oprească:

- RAF;
- composer;
- renderer;
- controls;
- ResizeObserver;
- solar interval;
- Moon interval;
- ISS interval;
- cloud refresh;
- EONET refresh;
- live data layers;
- pointer handlers;
- export recorder;
- materiale;
- geometrie;
- texturi temporare.

## Living Protein

`pause()`:

- oprește animația;
- păstrează scena.

`destroy()`:

- oprește RAF;
- abort remote load;
- disconnect ResizeObserver;
- dispose controls;
- dispose renderer;
- dispose geometry/materials.

## Visibility

Toate modulele:

- pauză la `document.hidden`;
- pauză când observatorul nu este activ;
- reluare controlată.

## Criterii

- 20 de cicluri mount/destroy fără creștere continuă de memorie;
- zero RAF după destroy;
- zero requests active după destroy;
- zero timere active după destroy.

---

# MILESTONE P6 — Platform Quality Service

**Durată estimată:** 1–2 săptămâni

## Device tier comun

```text
minimal
mobile
balanced
high
cinematic
```

## Capability snapshot

```js
{
  webglVersion,
  maxTextureSize,
  maxTextureUnits,
  deviceMemory,
  hardwareConcurrency,
  dpr,
  reducedMotion,
  batteryMode
}
```

## Modulul își declară costul

```js
quality.registerBudget("living-earth", {
  gpu: "high",
  textures: "high",
  post: "high"
});
```

## Profil Earth

| Profil | DPR | Bloom | SMAA | nori | auroră | Lună |
|---|---:|---|---|---|---|---|
| Minimal | 1.0 | off | off | fallback | low | low |
| Mobile | 1.15 | low | optional | 1024 | medium | 512 |
| Balanced | 1.5 | medium | on | 1024 | normal | 1K |
| High | 2.0 | full | on | 2K | full | 1K–2K |

## Profil Protein

- tubular segments adaptivi;
- radial segments 5/7/8;
- halo off pe minimal;
- resize DPR adaptiv;
- pauză invizibilă.

## Criterii

- același device tier este raportat în Atlas, Earth și Protein;
- utilizatorul poate forța profilul;
- profilul Auto explică motivul downgrade-ului;
- quality state intră în snapshot.

---

# MILESTONE P7 — Provenance Service

**Durată estimată:** 1–2 săptămâni

## Livrabile

```text
src/core/provenance/provenance-service.js
src/core/provenance/provenance-schema.js
src/core/provenance/asset-manifest.js
```

## Funcții

```js
registerSource()
registerAsset()
registerTransform()
getLineage()
exportManifest()
```

## UI

Source Inspector trebuie să poată afișa:

- sursa;
- timestampul;
- classification;
- lineage;
- processing;
- fallback;
- licența;
- versiunea;
- checksum-ul.

## Criterii

- orice efect important are o intrare;
- Earth și Protein folosesc aceeași schemă;
- fallback-ul nu este afișat ca live;
- prediction nu este afișat ca observed;
- derived nu este afișat ca measured.

---

# MILESTONE P8 — Testing, CI și visual regression

**Durată estimată:** 2–3 săptămâni

## Unit tests

### Core

- cache freshness;
- stale-if-error;
- retry;
- request deduplication;
- abort;
- diagnostic digest;
- registry validation.

### Earth

- event normalization;
- geo conversion;
- solar mapping;
- material atlas channel rules;
- historical time state.

### Protein

- PDB parser;
- contiguous segment split;
- pLDDT bands;
- confidence summary;
- UniProt feature coverage.

## Integration tests

- Atlas offline;
- Gateway source fallback;
- Earth provider failure;
- Protein AlphaFold failure;
- snapshot replay;
- server health;
- module lifecycle.

## Visual regression

- screenshots versionate;
- toleranță;
- browser desktop;
- mobile viewport;
- reduced motion.

## CI

```text
lint
syntax
unit
build
integration
visual-smoke
```

---

# 13. TRACK G — Atlas și Gateway

Roadmapul platformei nu trebuie să transforme Gateway-ul într-un grid WebGL de zece portaluri.

Trebuie păstrate două concepte:

## Gateway Hero

- maximum două portaluri simultan;
- impact vizual mare;
- observatoare featured;
- prefetch controlat.

## Observatory Atlas

- toate observatoarele;
- filtrare;
- cards;
- scale/family map;
- navigare.

---

# G0 — Declararea limitelor

Documentație:

```text
Gateway Hero = 1–2 featured observatories
Atlas Registry = N observatories
```

`GATEWAY_SLOT_COUNT = 2` devine configurație explicită, nu limită ascunsă.

---

# G1 — Featured selection

Registry-ul primește:

```js
gateway: {
  featuredPriority: 100,
  heroEligible: true
}
```

Gateway-ul alege primele două.

Restul apar în Atlas.

---

# G2 — Adapter contract v2

```ts
interface GatewayPreviewAdapter {
  preload(reason): Promise<void>;
  bind(slotIndex): void;
  getStatus(): RuntimeState;
  getPreviewMetadata(): object;
  cancel(reason): void;
  dispose(): void;
}
```

Preview-ul nu trebuie să dubleze tot observatorul.

El trebuie să genereze:

- o textură;
- o semnătură cromatică;
- o semnătură de mișcare;
- un status.

---

# G3 — Material extensibility

Material registry actual:

```text
planetary-sphere
molecular-trace
procedural-field
```

Trebuie extins fără a adăuga ramuri pentru fiecare observator în shader.

Opțiuni:

1. material families generice;
2. shader snippets la build;
3. preview texture dominant, material generic;
4. WebGL texture array — numai dacă devine necesar.

Recomandare:

**familii generice**, nu un shader unic per observator.

Exemple:

```text
planetary
molecular
field
network
topological
volumetric
```

---

# G4 — Gateway parity și fallback

Fiecare adaptor trebuie să aibă:

- fallback procedural;
- live preview;
- stale preview;
- source badge;
- cache policy.

---

# G5 — Gateway performance

- preview maximum 512–1024 px;
- prefetch concurrency 1 pe mobil;
- decodarea imaginilor în idle;
- pause în afara hero;
- adaptare DPR;
- cache budget.

---

# 14. TRACK E — Living Earth Observatory

Roadmapul anterior de realism rămâne valid, dar începe după milestone-urile P0–P5 sau poate avansa în branch separat fără a bloca platforma.

# E0 — Earth baseline și contract runtime

**Dependențe:** P0, P2, P3, P5

Livrabile:

- `createLivingEarthModule`;
- `destroy`;
- source bridge;
- state export;
- quality binding;
- provenance binding.

---

# E1 — Asset manifest și KTX2

**Durată:** 1–2 săptămâni

## Priorități

1. ETOPO normal;
2. ETOPO relief;
3. base albedo;
4. night lights;
5. cloud masks;
6. material atlas.

## Reguli

### UASTC

- normal maps;
- displacement;
- mask atlases cu tranziții sensibile.

### ETC1S

- albedo;
- cloud imagery;
- night lights;
- decorative backgrounds.

## SKU

```text
high/
balanced/
mobile/
minimal/
```

## Loader

- KTX2;
- PNG/JPG fallback;
- color space explicit;
- manifest;
- checksum;
- cache status.

---

# E2 — PBR scaffold înainte de atlas MODIS

**Durată:** 2–3 săptămâni

Ordinea corectată:

1. material PBR cu roughness constant;
2. PMREM minimal;
3. Soare analitic;
4. ocean Fresnel/glint;
5. Phong/PBR smooth comparison;
6. oracle Cycles;
7. abia apoi atlas material.

Recomandare:

```text
MeshStandardMaterial + onBeforeCompile
```

nu portare manuală integrală a chunkurilor GGX în prima etapă.

---

# E3 — Texturi calibrate

**Durată:** 3–5 săptămâni

## E3.1 Blue Marble sezonier

- 12 luni;
- două texturi active;
- blend calendaristic;
- prefetch luna următoare;
- seam QA;
- cache.

## E3.2 VIIRS night lights

Moduri:

```text
VIIRS radiance
VIIRS warm-white interpretive
Legacy artistic
```

Colorizarea nu este prezentată ca măsurătoare spectrală.

## E3.3 GIBS clouds

Stări:

```text
measured snapshot
interpolated transition
procedural residual
fallback artistic
```

Crossfade-ul este etichetat `interpolated`.

---

# E4 — Material Prior Atlas

**Durată:** 3–4 săptămâni

MCD12Q1 oferă land cover măsurat.

Roughness este:

```text
derived material prior
```

nu roughness măsurat direct.

Canale propuse:

| Canal | Conținut |
|---|---|
| R | water / land mask |
| G | roughness prior |
| B | snow/ice prior |
| A | urban/desert auxiliary |

Metalness natural rămâne zero, cu excepția unei decizii interpretative documentate pentru urban.

---

# E5 — Atmosphere și Aerosol State Field

**Durată:** 3–4 săptămâni

## Separare obligatorie

AOD și UV Aerosol Index nu sunt tratate ca aceeași mărime.

Providerul declară:

- produs;
- unitate;
- timp;
- acoperire;
- quality flags;
- missing data.

Mapări distincte:

```text
extinction
Mie scattering
anisotropy
night-light halo
cloud forward scattering
terminator bloom
```

Fiecare mapare are limite pentru a evita double counting.

---

# E6 — Historical Time Engine

**Durată:** 4–6 săptămâni

Time state comun:

```ts
{
  mode: "live" | "historical";
  selectedTime: string;
  playbackRate: number;
  paused: boolean;
}
```

Sursele declară disponibilitatea:

```text
exact
nearest
composite
unavailable
```

Astronomia este recalculată exact pentru timpul selectat.

---

# E7 — Curated Event Packages

**Durată:** 3–5 săptămâni

```text
events/
└── event-id/
    ├── event.json
    ├── timeline.json
    ├── provenance.json
    ├── captions.md
    └── assets/
```

Primii candidați:

- eclipsa aprilie 2024;
- furtuna Gannon;
- Hunga Tonga;
- episod auroral;
- cutremur major.

---

# E8 — Export determinist

- timestep fix;
- seed fix;
- render clock separat;
- resolution profile;
- deterministic captions;
- frame export;
- H.264 server;
- metadata sidecar.

---

# 15. TRACK PR — Living Protein Observatory

Living Protein este funcțional, dar se află într-un stadiu mai timpuriu decât Earth.

Nu trebuie forțat să copieze rendererul Earth.

# PR0 — Module contract și runtime integration

- wrapper ObservatoryModule;
- dataBroker;
- cache;
- status;
- diagnostics;
- destroy complet;
- quality service.

---

# PR1 — Provider și model catalog

În prezent modelele sunt hardcodate.

Se introduce:

```text
protein-model-registry.js
```

Câmpuri:

- accession;
- display name;
- organism;
- biological role;
- AlphaFold source;
- experimental PDB references;
- default feature focus;
- story metadata.

Cache keys:

```text
alphafold:{accession}:metadata
alphafold:{accession}:pdb
uniprot:{accession}
```

---

# PR2 — Reprezentări moleculare

Starea actuală:

- C-alpha trace;
- TubeGeometry;
- pLDDT color.

Extensii etapizate:

1. trace;
2. ribbon;
3. backbone;
4. optional atoms for selected region;
5. ligand/site markers.

Fiecare reprezentare trebuie să declare:

```text
prediction
derived geometry
interpretive styling
```

---

# PR3 — Prediction vs experiment

Aceasta ar fi funcția științifică distinctivă a modulului.

Moduri:

```text
AlphaFold prediction
Experimental PDB
Overlay / comparison
```

Atenție:

- chain mapping;
- residue numbering;
- missing residues;
- mutations;
- oligomeric state;
- ligands;
- confidence vs experimental uncertainty.

Nu se compară automat structuri fără un alignment validat.

---

# PR4 — Confidence and annotation analytics

- pLDDT histogram;
- per-feature mean;
- coverage;
- low-confidence warning;
- predicted aligned error, dacă este disponibil;
- disorder annotation;
- active/binding sites;
- provenance per feature.

---

# PR5 — Protein storytelling și export

Se extrage un subset din Editorial Runtime:

- title card;
- residue focus beat;
- feature caption;
- confidence legend;
- still capture;
- vertical camera;
- short reel timeline.

---

# PR6 — Performance

- geometry cache;
- adaptive tube segments;
- instanced markers;
- pause hidden;
- cleanup;
- worker pentru parsare PDB la modele mari;
- optional mmCIF parser ulterior.

---

# 16. TRACK PH — Perceptual Phase Lab ca al treilea observator

Perceptual Phase Lab este un candidat potrivit pentru:

```text
family: matter-fields sau mathematical
scale: atomic / mathematical, în funcție de poziționare
representations:
  physical-model
  simulation
  interpretive
  fallback
```

Nu trebuie introdus direct ca un HTML izolat.

# PH0 — Package intern

```text
src/phase/
├── manifest.js
├── module.js
├── physics/
├── geometry/
├── renderer/
├── data/
└── ui/
```

# PH1 — Contract

- mount;
- start;
- pause;
- resume;
- destroy;
- state;
- diagnostics;
- quality.

# PH2 — Data coupling

NOAA devine provider opțional.

Rendererul primește numai valori normalizate:

```text
flow
turbulence
emissivity
opticalDensity
colorShift
```

# PH3 — Gateway preview

Adapter:

```text
phase-field-texture
```

Material family:

```text
field / topological
```

# PH4 — Provenance

- Curie model: physical-model;
- thermal RMS scale: derived/physical reference;
- geometry morph: simulation/interpretive;
- NOAA: observed;
- atmosphere: interpretive or data-coupled;
- fallback: explicit.

---

# 17. TRACK S — Shared Editorial Runtime

Nu se extrage imediat tot sistemul Earth.

Se extrag numai contractele comune.

```ts
interface EditorialSequence {
  id: string;
  duration: number;
  beats: EditorialBeat[];
}

interface EditorialBeat {
  type: string;
  start: number;
  duration: number;
  payload: object;
}
```

Capability adapters:

```text
EarthEditorialAdapter
ProteinEditorialAdapter
PhaseEditorialAdapter
```

Funcții comune:

- timing;
- captions;
- title card;
- transition;
- vertical safe area;
- export clock;
- deterministic playback.

Funcții specifice rămân în observator:

- Earth focus on coordinate;
- Protein focus residue;
- Phase set temperature/morph.

---

# 18. TRACK A — Asset Pipeline comun

## Clasificarea activelor

```text
source
processed
runtime-high
runtime-balanced
runtime-mobile
fallback
```

## Manifest

```json
{
  "id": "asset-id",
  "module": "living-earth",
  "classification": "derived",
  "source": "...",
  "license": "...",
  "dimensions": [2048, 1024],
  "colorSpace": "linear",
  "encoding": "KTX2_UASTC",
  "sha256": "...",
  "generatedBy": "...",
  "fallback": "..."
}
```

## Protein

Activele sunt în mare parte dinamice:

- metadata JSON;
- PDB/mmCIF;
- generated geometry.

Tot trebuie manifestată versiunea providerului și transformarea.

## Phase

- shaders;
- seeds;
- presets;
- reference constants.

---

# 19. Bugete de performanță pe platformă

## Regula de memorie

Într-o pagină de observator rulează un singur renderer principal.

Gateway-ul se distruge sau rămâne pe pagina Atlasului, nu în fundalul observatorului.

## Atlas / Gateway

| Profil | DPR | preview texture | post |
|---|---:|---:|---|
| Mobile | 1.0–1.15 | 512 | low |
| Balanced | 1.35–1.65 | 512–1024 | medium |
| Cinematic | max 2.0 | 1024 | full |

## Earth

| Profil | FPS țintă | texturi GPU |
|---|---:|---:|
| Minimal | 30+ | sub 150 MB |
| Mobile | 30–60 | 150–300 MB |
| Balanced | 50–60 | 300–600 MB |
| High | 55–60 | măsurat, nu presupus |

## Protein

- 30 FPS minim;
- 60 FPS pe structuri mici;
- geometry generation sub 300 ms pentru model standard;
- worker dacă parsing + geometry depășește 100 ms repetat.

## Phase Lab

- profil mobil fără atmosferă avansată;
- bloom quarter resolution;
- particule adaptate;
- 30 FPS minim.

---

# 20. Matrice de dependențe

| Milestone | Depinde de |
|---|---|
| P0 Baseline | nimic |
| P1 Build | P0 |
| P2 Module Contract | P0 |
| P3 Unified Data | P1, P2 |
| P4 Server | P1 |
| P5 Lifecycle | P2 |
| P6 Quality | P2 |
| P7 Provenance | P2, P3 |
| P8 Tests | P1–P7 |
| E1 KTX2 | P1, P7 |
| E2 PBR | P0, E1 recomandat |
| E3 Calibrated textures | P3, P4, E1 |
| E4 MODIS | E1, E2 |
| E5 Aerosols | P3, P4, E2 |
| E6 Historical | P3, P4 |
| PR1 Providers | P3 |
| PR2 Rendering | P5, P6 |
| PH0 Integration | P2, P5, P6 |

---

# 21. Ordinea recomandată de execuție

## Etapa I — Platform stabilization

```text
P0 → P1 → P2 → P5
```

## Etapa II — Shared runtime

```text
P3 → P4 → P6 → P7
```

## Etapa III — Module tracks în paralel

```text
Earth:   E1 → E2 → E3 → E4 → E5
Protein: PR1 → PR2 → PR3
Phase:   PH0 → PH1 → PH2
Gateway: G1 → G2 → G3
```

## Etapa IV — Editorial și historical

```text
Shared Editorial → E6 → E7
Protein reels
Phase sequences
```

## Etapa V — Tests and release

```text
P8 → platform v1
```

---

# 22. Estimări realiste

Pentru un singur dezvoltator:

## Platform foundation

- 6–10 săptămâni.

## Earth realism MVP

- 10–16 săptămâni după fundație sau în branch paralel.

## Protein maturizare

- 5–9 săptămâni.

## Phase integration

- 3–6 săptămâni dacă rendererul modular este deja stabil.

## Historical + editorial

- 8–14 săptămâni.

## Platformă matură

Aproximativ:

```text
8–12 luni
```

pentru un sistem solid, testat și documentat, realizat în principal de o singură persoană.

Un MVP de platformă cu trei observatoare poate fi obținut în:

```text
3–5 luni
```

dacă realismul Earth avansat și Historical Playback sunt etapizate.

---

# 23. Primul sprint recomandat — 10 zile

# Ziua 1 — Freeze

- arhivă baseline;
- build id;
- screenshots;
- module metrics;
- known limitations.

# Ziua 2 — Package foundation

- package.json;
- Vite;
- pin Three 0.160;
- pin Earcut;
- pin Astronomy Engine;
- pin satellite.js.

# Ziua 3 — Routes și assets

- Atlas;
- Earth;
- Protein;
- local dependencies;
- verificare build.

# Ziua 4 — Module contract draft

- manifest schema;
- lifecycle interface;
- context interface;
- validation.

# Ziua 5 — Protein module wrapper

- mount;
- start;
- pause;
- destroy;
- status.

# Ziua 6 — Protein dataBroker migration

- AlphaFold metadata;
- PDB;
- UniProt;
- cache;
- stale-if-error.

# Ziua 7 — Earth runtime bridge

- module wrapper;
- state snapshot;
- runtime status;
- pause visibility.

# Ziua 8 — Lifecycle audit Earth

- listă completă de resurse;
- RAF ownership;
- intervals;
- event listeners;
- disposal plan.

# Ziua 9 — Server skeleton

- health endpoint;
- capability response;
- config;
- placeholder FIRMS/GDACS/export routes.

# Ziua 10 — Gate review

Se verifică:

- visual parity;
- network;
- offline;
- cache;
- destroy;
- build;
- diagnostics.

---

# 24. Primul build concret recomandat

## Nume

```text
luminomorphism-platform-foundation-v0.1
```

## Conținut

- proiect Vite;
- dependențe locale;
- toate cele trei pagini actuale funcționale;
- Observatory Module contract;
- Living Protein wrapper;
- build info;
- baseline QA;
- fără modificări de realism.

## Ce nu intră

- PBR nou;
- MODIS;
- VIIRS;
- aerosoli;
- redesign;
- shader rewrite;
- WebGPU;
- al treilea observator complet.

---

# 25. Definition of Done — platform foundation

Platform foundation este completă numai dacă:

- buildul este reproducibil;
- dependențele sunt pin-uite;
- fiecare observator are manifest;
- fiecare observator are lifecycle;
- modulele pot fi oprite;
- sursele folosesc runtime comun sau au un bridge documentat;
- statusurile apar în Control Center;
- offline simulation funcționează;
- diagnostic snapshot include observatoarele;
- nu există server implicit lipsă;
- baseline-ul vizual este păstrat;
- testele de bază rulează.

---

# 26. Decizii care trebuie fixate

1. Se păstrează Vite + vanilla ES modules?  
   **Recomandare: da.**

2. Se folosește Node sau FastAPI pentru server?  
   **Recomandare: un singur backend; FastAPI dacă GIS devine central.**

3. Gateway-ul rămâne dual portal?  
   **Recomandare: da, Atlasul gestionează N observatoare.**

4. Se păstrează pagini separate pentru observatoare?  
   **Recomandare: da în etapa curentă.**

5. Se mută imediat `src/earth` și `src/protein`?  
   **Recomandare: nu. Mai întâi wrappers și contracts.**

6. Se upgradează Three.js imediat?  
   **Recomandare: nu. Pin r160, apoi upgrade controlat.**

7. Se continuă Earth realism înaintea runtime-ului comun?  
   **Recomandare: numai într-un branch; nu ca roadmap principal.**

8. Perceptual Phase Lab devine al treilea observator?  
   **Recomandare: da după P2/P5, ca test al contractului.**

---

# 27. Concluzie

Proiectul are deja elementele unei platforme serioase:

- registry;
- taxonomie;
- Gateway;
- cache;
- diagnostic replay;
- două observatoare;
- proveniență;
- export;
- fallback-uri explicite.

Problema nu este lipsa de funcții.

Problema este că infrastructura comună și observatoarele încă nu sunt conectate printr-un contract unic.

Prin urmare, direcția corectă este:

```text
Platform Contract
    ↓
Unified Runtime
    ↓
Lifecycle + Quality + Provenance
    ↓
Earth / Protein / Phase tracks
    ↓
Historical + Editorial
```

Roadmapul Living Earth rămâne valoros, dar devine unul dintre mai multe track-uri ale platformei LUMINOMORPHISM.

Primul pas corect nu este un nou efect vizual.

Primul pas corect este:

# **luminomorphism-platform-foundation-v0.1**

Acest build va transforma arhitectura deja promițătoare într-o bază pe care pot fi adăugate observatoare noi fără duplicarea runtime-ului, a cache-ului, a diagnosticelor și a regulilor de proveniență.


---

# 28. Cross-page Observatory Session Bridge

Observatoarele sunt în prezent pagini separate.

Aceasta este o alegere bună pentru izolarea rendererelor, dar înseamnă că memoria JavaScript a Atlasului dispare la navigare.

`portal-continuity.js` păstrează momentan:

- observatorul din care s-a intrat;
- tranziția vizuală;
- fereastra scurtă de întoarcere.

Trebuie extins cu un canal de sesiune pentru diagnostice.

```ts
interface ObservatorySessionRecord {
  observatoryId: string;
  moduleVersion: string;
  enteredAt: string;
  exitedAt: string | null;

  state: "live" | "stale" | "fallback" | "offline";
  qualityProfile: string;

  sources: Record<string, {
    state: string;
    updated: string | null;
    reason?: string;
  }>;

  lastError?: string;
}
```

Stocare recomandată:

- `sessionStorage` pentru continuitate imediată;
- IndexedDB pentru ultimul diagnostic cunoscut;
- fără payloaduri mari în `sessionStorage`.

La revenirea în Atlas:

- Observatory card afișează ultimul runtime cunoscut;
- Control Center poate indica „last session”;
- replay-ul poate importa separat un snapshot complet.

---

# 29. Color management comun

Platforma folosește mai multe renderere, dar trebuie să păstreze aceeași disciplină de culoare.

## Gateway custom WebGL

Trebuie documentate:

- texturile sunt sRGB sau linear;
- decodarea în shader;
- tone mapping;
- bloom threshold;
- output gamma.

## Three.js observatories

Reguli:

- output: `SRGBColorSpace`;
- albedo și texturi color: sRGB;
- normal, roughness, metalness, displacement, masks: `NoColorSpace`;
- tone mapping central în modul;
- exposure versionat în preset;
- pLDDT colors în Protein rămân data encoding și pot fi `toneMapped: false`;
- UI legends trebuie să corespundă valorilor randate.

## Cross-module consistency

Nu este necesar ca Earth și Protein să aibă aceeași expunere.

Este necesar ca fiecare preset să declare:

```json
{
  "outputColorSpace": "sRGB",
  "toneMapping": "ACESFilmic",
  "exposure": 1.04,
  "dataColorsToneMapped": false
}
```

---

# 30. QA Oracle și visual parity

## 30.1 Browser baseline

Pentru fiecare modul se definește un scenariu determinist.

### Gateway

```text
time = 12.0 s
portal data = fixture
hover = none
viewport = 1440×900
```

### Earth

```text
UTC = fixed
camera = fixed
Earth look = scientific/cinematic/showcase
live providers = fixtures
```

### Protein

```text
accession = P04637
camera = fixed
selected feature = fixed
PDB = fixture
UniProt = fixture
```

### Phase

```text
material = iron
temperature = fixed
morph = fixed
NOAA = fixture
```

## 30.2 Cycles Oracle

Oracle Cycles este relevant în primul rând pentru Earth:

- material;
- lighting;
- atmosphere approximations;
- Moon;
- glint;
- ice.

Nu este o obligație pentru toate observatoarele.

Protein și Phase folosesc:

- visual fixtures;
- geometry assertions;
- shader snapshots;
- quantitative mappings.

## 30.3 Visual regression

Fiecare captură conține sidecar:

```json
{
  "build": "...",
  "module": "living-earth",
  "viewport": [1440, 900],
  "quality": "balanced",
  "fixture": "earth-scientific-day",
  "timestamp": "fixed",
  "browser": "chromium"
}
```

---

# 31. Matricea surselor pe module

## Platform / Gateway

| Sursă | Tip | Runtime actual | Țintă |
|---|---|---|---|
| EONET | JSON | dataBroker | păstrat |
| GIBS Blue Marble | image | dataBroker/blob | manifest + cache |
| AlphaFold preview | JSON + PDB | dataBroker | generic provider |
| procedural fallback | generated | adapter | provenance record |

## Living Earth

| Sursă | Tip | Runtime actual | Migrare |
|---|---|---|---|
| EONET | JSON | direct fetch | P3 lot 1 |
| USGS | GeoJSON | direct fetch | P3 lot 1 |
| NOAA OVATION | JSON | direct fetch | P3 lot 1 |
| CelesTrak | TLE text | direct fetch | P3 lot 2 |
| Astronomy Engine | library/model | dynamic import | local dependency |
| GIBS clouds | images | Image/decode | broker image provider |
| FIRMS | proxy JSON | direct proxy fetch | P4 |
| GDACS | proxy GeoJSON | direct proxy fetch | P4 |
| ETOPO | local textures | TextureLoader | asset manifest |
| Moon textures | CDN/local | TextureLoader | local asset pipeline |

## Living Protein

| Sursă | Tip | Runtime actual | Migrare |
|---|---|---|---|
| AlphaFold metadata | JSON | direct fetch | P3 |
| AlphaFold PDB | text | direct fetch | P3 |
| UniProt | JSON | direct fetch | P3 |
| RCSB PDB link | external reference | link only | registry/provenance |
| fallback trace | hardcoded | local | versioned fixture |

## Perceptual Phase

| Sursă | Tip | Runtime țintă |
|---|---|---|
| material constants | local config | physical-model |
| NOAA plasma | JSON/proxy | provider |
| NOAA Bz | JSON/proxy | provider |
| NOAA Kp | JSON/proxy | provider |
| procedural atmosphere | shader | interpretive |
| static fallback | local | fallback |

---

# 32. Registrul riscurilor

| Risc | Probabilitate | Impact | Mitigare |
|---|---:|---:|---|
| Rescriere mare a Earth în timpul migrării | medie | foarte mare | wrappers, bridge, visual parity |
| Upgrade Three + PBR simultan | mare | mare | milestone separat |
| Gateway devine aglomerat cu N portaluri | mare | mediu | dual hero + Atlas N |
| DataBroker devine dependent de DOM | medie | mediu | adapters și event bus limitat |
| Cache stochează payloaduri prea mari | medie | mare | size budget, LRU, blobs separate |
| Replay include date sensibile sau chei | mică | mare | sanitizare și allowlist |
| Server proxy devine open proxy | medie | foarte mare | routes fixe, allowlist |
| Earth KTX2 schimbă look-ul | medie | mare | fallback, A/B, oracle |
| Provider APIs schimbă schema | mare | mediu | normalizers + fixtures |
| Protein comparison induce concluzii false | medie | foarte mare | alignment validat, warnings |
| UI comun devine prea generic | medie | mediu | capability adapters |
| Scope creep WebGPU | mare | mare | branch R&D |
| Modulele păstrează RAF după navigare | medie | mare | lifecycle tests |
| External CDN indisponibil | mare | mare | dependency freeze/local assets |
| Historical data incompletă | mare | mediu | availability matrix |
| Mobile VRAM depășit | medie | mare | quality service + KTX2 |
| Provenance devine doar text decorativ | medie | mare | schema obligatorie + validation |
| Două taxonomii sunt confundate | medie | mediu | representation vs lineage |

---

# 33. Versionarea recomandată

## Platform

```text
platform-v0.1  build foundation
platform-v0.2  module contract
platform-v0.3  unified data runtime
platform-v0.4  lifecycle + quality
platform-v0.5  provenance + diagnostics
platform-v0.6  server gateway
platform-v0.7  third observatory integration
platform-v0.8  editorial runtime
platform-v0.9  tests / release candidate
platform-v1.0  stable multi-observatory platform
```

## Earth

```text
earth-v1.x    current visual/product line
earth-v2.x    astronomical completeness
earth-v3.x    material/light realism
earth-v4.x    historical/editorial reconstruction
```

## Protein

```text
protein-v0.1  current AlphaFold trace
protein-v0.2  unified runtime
protein-v0.3  model catalog
protein-v0.4  representation modes
protein-v0.5  prediction/experiment comparison
protein-v1.0  stable molecular observatory
```

## Phase

```text
phase-v0.1    modular engine
phase-v0.2    platform module
phase-v0.3    data provider coupling
phase-v0.4    gateway preview
phase-v1.0    stable observatory
```

---

# 34. Non-goals în fundația platformei

Nu se încearcă în P0–P7:

- un renderer universal;
- un UI identic pentru toate observatoarele;
- migrarea la TypeScript;
- migrarea la React;
- migrarea la WebGPU;
- un singur mega-shader;
- încărcarea tuturor observatoarelor în aceeași pagină;
- schimbarea designului vizual;
- înlocuirea completă a Earth;
- rescrierea tuturor providerelor simultan.

---

# 35. Gate-uri de aprobare

## Gate A — Reproducibility

- build local;
- lockfile;
- dependențe locale;
- routes funcționale;
- baseline identic.

## Gate B — Module Contract

- Protein mount/destroy;
- Earth wrapper;
- registry validation;
- no leaks evidente.

## Gate C — Unified Runtime

- offline pentru Earth și Protein;
- stale cache;
- Control Center;
- snapshot.

## Gate D — Third Observatory

Perceptual Phase Lab intră fără modificări majore în:

- Atlas;
- Gateway adapter registry;
- Control Center;
- provenance;
- quality;
- lifecycle.

Dacă integrarea necesită schimbări speciale în toate componentele, contractul nu este suficient de bun.

## Gate E — Earth Realism

PBR, KTX2 și texturile calibrate intră numai după:

- visual baseline;
- manifest;
- quality budget;
- source runtime;
- fallback.

---

# 36. Rezumat executiv final

## Ce este proiectul acum

O platformă promițătoare cu:

- un Atlas real;
- un Gateway extensibil parțial;
- un runtime comun avansat;
- un observator Earth matur;
- un observator Protein în dezvoltare;
- infrastructură bună de diagnostic.

## Ce îl împiedică să devină platformă completă

- observatoarele nu folosesc runtime-ul comun;
- nu există contract de modul;
- nu există build reproducibil;
- proxy-ul lipsește;
- lifecycle-ul nu este uniform;
- quality și provenance nu sunt servicii comune;
- Gateway-ul este hardcodat pentru două preview-uri.

## Ce trebuie făcut mai întâi

```text
Build Foundation
→ Observatory Contract
→ Unified Data Runtime
→ Lifecycle / Quality / Provenance
→ Third Observatory Validation
```

## Unde intră roadmapul de realism Earth

După fundație, ca track specializat:

```text
KTX2
→ PBR scaffold
→ calibrated textures
→ MODIS material prior
→ aerosols
→ historical playback
```

Aceasta este adaptarea corectă a roadmapului la proiectul real.


---

# PARTEA II — EXTINDEREA V4: PORTOFOLIUL DE NOI OBSERVATOARE

# 37. Obiectivul extinderii V4

Fundația din V3 rezolvă problema platformei: build reproductibil, contract de modul, runtime comun, lifecycle, quality, provenance, testare și integrarea Phase Lab.

V4 răspunde la întrebarea următoare:

> După stabilizarea platformei, ce observatoare merită construite pentru ca LUMINOMORPHISM să devină o hartă coerentă a realității de la scară cuantică la scară cosmică, fără să devină o colecție arbitrară de demo-uri?

Noile module nu sunt alese numai pentru spectacol vizual. Ele trebuie să îndeplinească simultan mai multe condiții:

- să ocupe un loc clar în taxonomia platformei;
- să aibă o teză științifică precisă;
- să poată separa măsurarea de model și interpretare;
- să reutilizeze infrastructura deja construită;
- să ofere un Gateway preview recognoscibil;
- să aibă valoare editorială și educațională;
- să poată funcționa în mod degradat sau offline;
- să nu necesite hardware inaccesibil pentru utilizatorul țintă;
- să aibă un MVP finit, nu o promisiune nelimitată.

---

# 38. Criterii de selecție pentru module noi

Fiecare candidat este evaluat pe o scară de la 1 la 5.

| Criteriu | Întrebare |
|---|---|
| Impact vizual | Produce o identitate vizuală imediat recognoscibilă? |
| Valoare științifică | Poate transmite relații reale, nu doar imagini decorative? |
| Sinergie | Refolosește cod, date sau concepte din observatoarele existente? |
| Maturitatea datelor | Există surse publice și documentate? |
| Cost MVP | Poate fi livrat un prim produs coerent într-un interval limitat? |
| Potențial editorial | Poate susține episoade, preseturi și exporturi? |
| Scalabilitate | Permite evoluții ulterioare fără rescriere totală? |
| Risc de interpretare | Poate fi explicată clar diferența dintre observat și interpretativ? |

## Matricea recomandată

| Modul | Impact | Știință | Sinergie | Date | Cost MVP | Editorial | Prioritate |
|---|---:|---:|---:|---:|---:|---:|---|
| Living Sun | 5 | 5 | 5 | 5 | 4 | 5 | P1 |
| Living Cell | 5 | 5 | 5 | 4 | 3 | 5 | P1 |
| Quantum Materials | 5 | 5 | 5 | 5 | 4 | 4 | P1 |
| Living Ocean | 5 | 5 | 5 | 5 | 3 | 5 | P1 |
| Living Brain | 5 | 5 | 4 | 4 | 2 | 5 | P2 |
| Living Cosmos | 5 | 5 | 4 | 5 | 2 | 5 | P2 |
| Dynamical Systems | 5 | 4 | 4 | 5 | 5 | 5 | P2 |
| Network Pulse | 4 | 5 | 3 | 4 | 3 | 4 | P3 |

`Cost MVP = 5` înseamnă relativ simplu; `Cost MVP = 1` înseamnă foarte dificil.

---

# 39. Extinderea taxonomiei fără ruperea compatibilității

Taxonomia actuală are șase familii corecte:

```text
planetary
life
cosmic
matter-fields
mathematical
computational
```

Scările actuale sunt însă exclusiv fizice:

```text
quantum → atomic → molecular → cellular → organism → ecological
→ planetary → stellar → galactic → cosmological
```

Această axă funcționează pentru Earth, Protein, Cell, Sun și Cosmos, dar nu descrie corect:

- un atractor Lorenz;
- un spațiu de fază;
- o rețea Internet;
- un algoritm emergent;
- o topologie abstractă.

## 39.1 Migrare compatibilă

Nu se elimină proprietatea actuală `scale`.

Se adaugă:

```ts
interface ObservatoryManifestV4 extends ObservatoryManifest {
  scaleAxis?: "physical" | "conceptual" | "network";
  conceptualScale?: string;
  spatialDimensionality?: "0D" | "1D" | "2D" | "3D" | "nD";
  temporalMode?: "static" | "live" | "historical" | "simulated" | "mixed";
}
```

Valori implicite pentru observatoarele existente:

```js
scaleAxis: "physical"
```

## 39.2 Exemple

```js
// Living Sun
{
  family: "cosmic",
  scale: "stellar",
  scaleAxis: "physical"
}

// Dynamical Systems
{
  family: "mathematical",
  scale: "abstract",
  scaleAxis: "conceptual",
  conceptualScale: "state-space"
}

// Network Pulse
{
  family: "computational",
  scale: "global-network",
  scaleAxis: "network",
  conceptualScale: "autonomous-systems"
}
```

## 39.3 Atlas UI

Atlasul trebuie să permită trei moduri de explorare:

1. **Family** — planetary, life, cosmic etc.;
2. **Physical scale** — quantum → cosmological;
3. **System view** — conceptual și network.

Astfel, noile module nu sunt forțate artificial într-o scară fizică nepotrivită.

---

# 40. Arhitectura comună a unui observator V4

Fiecare modul nou trebuie să conțină aceleași straturi, chiar dacă rendererul diferă.

```text
observatory/
├── manifest.js
├── module.js
├── state/
│   ├── state-schema.js
│   ├── defaults.js
│   └── migrations.js
├── data/
│   ├── providers/
│   ├── normalizers/
│   └── schemas/
├── model/
│   ├── physical-model.js
│   └── visual-mapping.js
├── renderer/
├── gateway/
│   └── preview-adapter.js
├── editorial/
│   ├── presets.js
│   └── stories.js
├── provenance/
├── diagnostics/
├── tests/
└── README.md
```

## 40.1 Separare obligatorie

```text
Raw source
    ↓
Validated data
    ↓
Normalized scientific state
    ↓
Physical / mathematical model
    ↓
Visual mapping
    ↓
Renderer
```

Niciun renderer nu trebuie să interpreteze direct structura JSON a unei surse externe.

---

# 41. MODULUL 1 — Living Sun Observatory

## 41.1 Poziționare

```text
id: living-sun
family: cosmic
scale: stellar
status inițial: development
```

Living Sun devine legătura naturală dintre:

- Living Cosmos;
- Living Earth;
- atmosfera și aurora Pământului;
- Perceptual Phase Lab;
- viitoarele module de plasmă și câmpuri magnetice.

Este recomandarea cu cel mai mare raport impact/sinergie.

## 41.2 Teza produsului

> Soarele nu este o sferă galbenă decorativă, ci o stea observată simultan în mai multe lungimi de undă, cu câmp magnetic, regiuni active, erupții și influență măsurabilă asupra mediului terestru.

## 41.3 Limita științifică

Observatorul trebuie să distingă:

### Observat

- imagini ale discului solar în benzi instrumentale;
- magnetograme;
- regiuni active și evenimente catalogate;
- indici de vreme spațială;
- parametri ai vântului solar.

### Derivat

- normalizarea intensității;
- detectarea contururilor regiunilor active;
- sincronizarea cadrelor între instrumente;
- estimarea orientării discului.

### Physical model

- rotația diferențială simplificată;
- poziția Soare–Pământ;
- propagarea conceptuală a unei perturbații;
- câmpuri magnetice extrapolate numai dacă metoda este documentată.

### Interpretiv

- volum aparent al coroanei;
- linii de câmp animate;
- particule de plasmă;
- culori cinematice între benzi.

O imagine AIA nu trebuie prezentată drept „textură de suprafață reală 3D”. Este o proiecție radiometrică a emisiei într-o bandă spectrală.

## 41.4 Surse candidate

- NASA Solar Dynamics Observatory: AIA și HMI;
- Helioviewer pentru imagini și compoziții multi-instrument;
- NOAA SWPC pentru Kp, Bz, vânt solar și produse operaționale;
- NASA DONKI pentru evenimente de vreme spațială;
- JSOC numai pentru fluxuri care necesită acces științific mai detaliat.

## 41.5 MVP

### SU0 — Preview static calibrat

- disc solar AIA 193 sau 171;
- dată și timestamp vizibile;
- fallback local;
- Gateway texture adapter;
- proveniență completă.

### SU1 — Multiwavelength

Preseturi:

```text
Photosphere
Magnetic Sun
Coronal Loops
Transition Region
Composite Observatory
```

Interfața nu folosește etichete de culoare generică; afișează banda și instrumentul.

### SU2 — Magnetogramă

- strat HMI separat;
- polaritate pozitivă/negativă;
- opacitate și blend;
- legendă în unitățile sursei;
- fără linii de câmp „realiste” nejustificate.

### SU3 — Event layer

- flare;
- CME catalog;
- active regions;
- timeline;
- legătura evenimentului cu Earth space-weather state.

### SU4 — Historical playback

- selector temporal;
- sincronizare între imagini și evenimente;
- episoade editoriale;
- cache de secvențe.

## 41.6 Renderer

Recomandare:

- Three.js pentru scena observatorului;
- disc/sferă cu proiecție corectă;
- shell de coroană separat;
- bloom limitat înainte de tone mapping;
- optional WebGL custom pentru fluxuri de particule;
- efectele interpretative într-un pass separat.

## 41.7 Gateway preview

Gateway-ul nu trebuie să ruleze simularea completă.

```text
preview = ultimul cadru valid AIA
motion = rotație foarte lentă + puls de coroană
fallback = textură solară locală verificată
```

## 41.8 Manifest propus

```js
{
  id: "living-sun",
  title: "Living Sun",
  subtitle: "Observatory",
  family: "cosmic",
  scale: "stellar",
  status: "development",
  route: "./living-sun.html",
  featured: true,
  representations: [
    "observed",
    "reconstructed",
    "physical-model",
    "interpretive",
    "fallback"
  ],
  sources: ["sdo-aia", "sdo-hmi", "swpc", "donki"],
  gateway: {
    enabled: true,
    adapter: "solar-disk-texture",
    material: "stellar-corona"
  }
}
```

## 41.9 Sinergii

- Earth primește stare solară coerentă;
- Phase Lab poate folosi același `SpaceWeatherSnapshot`;
- Cosmos oferă contextul orbital;
- Editorial Runtime poate construi episoade Sun → Earth.

## 41.10 Criterii de acceptare MVP

- timestampul imaginii este afișat;
- banda instrumentală este declarată;
- fallback-ul nu este etichetat live;
- offline simulation funcționează;
- source status apare în Control Center;
- observatorul poate fi mount/destroy de 20 de ori;
- Gateway-ul funcționează fără a descărca secvența completă;
- un eveniment solar poate fi deschis ca story preset.

## 41.11 Riscuri

- volum mare de imagini;
- sincronizare între surse;
- rate limits și acces JSOC;
- fals realism al coroanei;
- bloom excesiv;
- dificultatea reprezentării magnetismului.

Mitigare:

- subset de benzi;
- proxy și cache;
- asset manifests;
- etichete clare pentru interpretive layers;
- quality profiles.

---

# 42. MODULUL 2 — Living Ocean Observatory

## 42.1 Poziționare

```text
id: living-ocean
family: planetary
scale: planetary
status inițial: research
```

Living Ocean nu este doar un layer suplimentar în Living Earth.

Earth este observatorul integrat al planetei. Ocean este un observator specializat în:

- dinamică;
- temperatură;
- biogeochimie;
- circulație;
- schimb de energie;
- profil vertical.

## 42.2 Teza produsului

> Oceanul trebuie reprezentat ca un sistem dinamic măsurat, nu ca o suprafață albastră cu reflexii.

## 42.3 Variabile principale

### Faza MVP

- sea surface temperature;
- currents U/V;
- sea surface height anomaly;
- chlorophyll / ocean color;
- wave height;
- bathymetry.

### Faza avansată

- salinity;
- mixed layer depth;
- oxygen;
- Argo vertical profiles;
- marine heatwaves;
- El Niño indicators;
- sea ice interaction.

## 42.4 Surse candidate

- Copernicus Marine Data Store pentru produse oceanografice;
- NASA PACE / Ocean Color pentru biogeochimie și culoarea oceanului;
- NOAA OISST pentru SST;
- Argo pentru profile verticale;
- ETOPO/GEBCO pentru batimetrie;
- produse de valuri din surse operaționale documentate.

## 42.5 Arhitectura datelor

Câmpurile raster și vectoriale trebuie normalizate în același model:

```ts
interface OceanFieldSnapshot {
  timestamp: string;
  grid: {
    width: number;
    height: number;
    projection: string;
  };
  variables: {
    sst?: ScalarField;
    currentU?: ScalarField;
    currentV?: ScalarField;
    chlorophyll?: ScalarField;
    seaLevelAnomaly?: ScalarField;
    waveHeight?: ScalarField;
  };
  provenance: ProvenanceRecord[];
}
```

## 42.6 Renderer

Două moduri complementare:

### Globe mode

- glob reutilizat din Earth;
- raster scalar pentru SST/chlorophyll;
- particule advectate de câmpul U/V;
- coastline mask;
- bathymetry în relief discret;
- legendă în unități reale.

### Section mode

- secțiune verticală oceanică;
- profile Argo;
- temperatură/salinitate pe adâncime;
- stratificare;
- thermocline.

## 42.7 Regula pentru particule

Particulele nu sunt „molecule de apă”. Ele sunt traceri vizuali advectați de un câmp măsurat sau derivat.

Proveniență:

```text
current field: observed / assimilated product
particle trajectory: simulated visual integration
particle color: interpretive
```

## 42.8 Milestones

### OC0 — Ocean static atlas

- batimetrie;
- SST snapshot;
- legendă;
- timestamp;
- fallback.

### OC1 — Current field

- U/V loader;
- advecție GPU;
- quality scaling;
- pause/resume;
- deterministic replay.

### OC2 — Ocean color

- PACE/chlorophyll;
- log scaling documentat;
- cloud/no-data mask;
- provenance.

### OC3 — Vertical profiles

- selectare punct;
- cel mai apropiat profil Argo;
- grafic adâncime;
- sincronizare cu globul.

### OC4 — Historical stories

- El Niño;
- marine heatwave;
- bloom de fitoplancton;
- cicluri sezoniere;
- Gulf Stream.

## 42.9 Gateway preview

- SST sau chlorophyll global;
- flow field low-resolution;
- maximum câteva mii de traceri;
- fără profile verticale în Gateway.

## 42.10 Criterii de acceptare

- unitățile fiecărei variabile sunt vizibile;
- timestampurile nu sunt amestecate fără avertizare;
- no-data este mascat, nu interpretat ca zero;
- particulele urmează câmpul și sunt deterministe în replay;
- profilul mobile reduce numărul tracerilor;
- modulul poate funcționa numai cu SST dacă celelalte surse lipsesc;
- Earth poate deschide Ocean păstrând aceeași dată și poziție a camerei.

## 42.11 Riscuri

- fișiere raster mari;
- proiecții diferite;
- timestampuri diferite între produse;
- date asimilate confundate cu observații directe;
- advecție costisitoare pe mobil.

Mitigare:

- COG/Zarr offline pipeline;
- downsample și KTX2;
- `DataAlignmentReport`;
- profil Mobile cu field mai mic;
- etichete `observed`, `reanalysis`, `forecast` distincte.

---

# 43. MODULUL 3 — Living Cell Observatory

## 43.1 Poziționare

```text
id: living-cell
family: life
scale: cellular
status inițial: research
```

Living Cell este continuarea naturală a Living Protein.

```text
Protein structure
    ↓
Protein localization
    ↓
Organelle context
    ↓
Cell state
```

## 43.2 Teza produsului

> Celula nu trebuie prezentată ca o ilustrație universală „realistă”, ci ca o integrare explicită între imagini măsurate, localizări proteice, geometrii reconstruite și modele interpretative.

## 43.3 Problema de reprezentare

Nu există o singură fotografie care să arate simultan:

- membrana;
- nucleul;
- mitocondriile;
- reticulul endoplasmatic;
- aparatul Golgi;
- citoscheletul;
- mii de proteine;
- procese dinamice;

la aceeași scară, rezoluție și moment.

Prin urmare, observatorul trebuie să fie un **composite provenance system**, nu o afirmație că întreaga scenă este măsurată direct.

## 43.4 Straturi

### Measured

- imagini de microscopie;
- localizare subcelulară;
- expresie pe tip de celulă;
- date single-cell;
- segmentări publicate.

### Reconstructed

- contur celular;
- nucleu;
- organelle meshes din segmentări;
- volume OME-Zarr.

### Physical model

- difuzie simplificată;
- transport pe citoschelet;
- membrane dynamics simplificate;
- reacții demonstrative.

### Interpretive

- transparență cinematică;
- glow;
- particule de transport;
- culori unificate între surse.

## 43.5 Surse candidate

- Human Protein Atlas pentru localizare și expresie;
- Human Cell Atlas / CZ CELLxGENE pentru tipuri și expresie single-cell;
- BioImage Archive și Image Data Resource pentru imagini;
- Cellosaurus pentru identitatea liniilor celulare;
- UniProt pentru legătura cu Living Protein;
- OME-Zarr ca format preferat pentru volume și pyramids.

## 43.6 MVP recomandat

Nu se începe cu „toată celula umană”.

Se începe cu un caz controlat:

```text
celulă umană generică documentată
+ nucleu
+ mitocondrii
+ microtubuli
+ 3–5 proteine selectate
```

## 43.7 Milestones

### CE0 — Cell frame

- cameră și volum celular;
- membrane shell;
- nucleu;
- scale bar;
- dimensiuni declarate;
- fallback procedural marcat.

### CE1 — Organelle atlas

- mitocondrii;
- Golgi;
- ER;
- lysosomes;
- cytoskeleton;
- fiecare cu proveniență și vizibilitate separată.

### CE2 — Protein bridge

- acces din Living Protein prin accession;
- localizare HPA;
- highlight al compartimentului;
- diferență între structură moleculară și locație celulară.

### CE3 — Measured microscopy mode

- viewer 2D/3D pentru un dataset public;
- pyramid loading;
- channels;
- LUT-uri;
- segmentation overlay;
- link către scena reconstruită.

### CE4 — Cell state stories

- mitoză;
- transport intracelular;
- stres celular;
- diferențiere;
- fără afirmații medicale nevalidate.

## 43.8 Renderer

- Three.js pentru organelle scene;
- volum rendering separat pentru microscopy;
- instancing pentru organite repetate;
- LOD;
- clipping planes;
- local coordinate system;
- scale bar constantă în UI.

## 43.9 Gateway preview

- membrane silhouette;
- nucleu;
- microtubule motion discret;
- o singură proteină highlight;
- preview procedural sau baked, nu volum complet live.

## 43.10 Manifest propus

```js
{
  id: "living-cell",
  title: "Living Cell",
  subtitle: "Observatory",
  family: "life",
  scale: "cellular",
  status: "research",
  route: "./living-cell.html",
  featured: false,
  representations: [
    "observed",
    "reconstructed",
    "physical-model",
    "interpretive",
    "fallback"
  ],
  sources: ["hpa", "hca", "bioimage", "cellosaurus", "uniprot"]
}
```

## 43.11 Criterii de acceptare

- există scale bar;
- fiecare organit declară originea geometriei;
- microscopy și reconstruction pot fi comparate;
- o proteină poate fi urmărită Protein → Cell;
- modulele nu implică faptul că toate datele provin din aceeași celulă;
- canalele de imagine au LUT-uri și metadate;
- datele umane sunt publice și fără identificatori personali;
- scena rulează pe Mobile cu LOD redus.

## 43.12 Riscuri

- fals realism;
- amestecarea celulelor și liniilor celulare;
- volume foarte mari;
- complexitate de segmentare;
- interpretarea medicală nejustificată.

Mitigare:

- `Composite Provenance Panel`;
- cazuri curate, versionate;
- OME-Zarr și streaming pe niveluri;
- non-goals medicale explicite;
- separare strictă measured/reconstructed.

---

# 44. MODULUL 4 — Living Brain Observatory

## 44.1 Poziționare

```text
id: living-brain
family: life
scale: organism
status inițial: research
```

Living Brain trebuie conceput ca două observatoare coordonate într-un singur produs:

1. **Macro Connectome** — regiuni, tracturi și rețele;
2. **Micro Neuron** — morfologie neuronală și arborizație.

Nu se amestecă cele două scări într-o singură scenă fără tranziție explicită.

## 44.2 Teza produsului

> Creierul este o structură multi-scală. Niciun graf de noduri și muchii nu este „creierul real”; fiecare strat are o metodă, o rezoluție și un grad de inferență.

## 44.3 Surse candidate

- Allen Brain Atlas pentru anatomie, expresie și atlase publice;
- Human Connectome Project / OpenNeuro pentru date publice, de-identificate și cu termeni clari;
- NeuroMorpho.Org pentru morfologii neuronale;
- atlase standardizate pentru regiuni;
- eventual date funcționale numai în pachete curate, nu live generic.

## 44.4 Separarea reprezentărilor

### Anatomie

- reconstructed mesh;
- atlas parcellation;
- coordinate reference.

### Structural connectivity

- derived from tractography or tracer data;
- probabilistic / inferred;
- nu reprezintă axoni individuali.

### Functional connectivity

- statistical correlation;
- dependentă de task și preprocessing;
- nu este flux electric direct.

### Neuron morphology

- traced/reconstructed from microscopy;
- specie, regiune și tip celular declarate.

### Activity simulation

- simulation;
- parametri și model explicit;
- niciodată etichetată ca activitate măsurată dacă nu este.

## 44.5 MVP recomandat

### BR0 — Brain atlas

- mesh cortical;
- regiuni;
- selectare;
- nomenclatură;
- coordonate;
- provenance.

### BR1 — Structural network

- noduri = regiuni;
- muchii = conectivitate agregată;
- threshold control;
- edge bundling;
- uncertainty;
- matrix view sincronizată cu 3D.

### BR2 — Neuron observatory

- încărcare SWC sau format echivalent;
- soma, axon, dendrites;
- metrici morfologice;
- LOD;
- scale bar.

### BR3 — Multi-scale transition

- regiune selectată → tip neuronal relevant;
- tranziție editorială, nu zoom geometric fals infinit;
- breadcrumb de scară.

### BR4 — Temporal data package

- un dataset public, curat;
- time-series;
- signal preprocessing vizibil;
- connectivity derivation documentată;
- replay determinist.

## 44.6 Renderer

- Three.js pentru macro și micro;
- instanced line/tube rendering;
- graph layout offline;
- Web Worker pentru parsing;
- matrix canvas/WebGL separat;
- GPU picking pentru regiuni și tracturi.

## 44.7 Gateway preview

- cortical silhouette;
- câteva fascicule principale;
- pulse foarte discret;
- fără a sugera „gânduri live”.

## 44.8 Criterii de acceptare

- specie și atlas declarate;
- structural și functional connectivity nu sunt confundate;
- conectivitatea afișează metoda și thresholdul;
- neuronul are unități și scale bar;
- datele sunt publice și de-identificate;
- nu există inferențe despre sănătatea sau starea unui individ;
- un snapshot diagnostic poate reproduce exact filtrarea rețelei.

## 44.9 Riscuri

- date umane și termeni de utilizare;
- grafuri foarte dense;
- confuzie între corelație și cauzalitate;
- amestecarea scărilor;
- medicalizare accidentală.

Mitigare:

- MVP bazat pe atlas și morfologii publice;
- privacy review;
- provenance per edge set;
- threshold presets;
- disclaimere științifice concise;
- fără upload de date clinice în prima versiune.

---

# 45. MODULUL 5 — Quantum Materials Observatory

## 45.1 Poziționare

```text
id: quantum-materials
family: matter-fields
scale: atomic
status inițial: development
```

Acest modul transformă Perceptual Phase Lab dintr-un experiment perceptual într-o poartă către materiale reale.

```text
Phase Lab
    ↓
abstract order parameter
    ↓
real crystal structures
    ↓
computed properties
    ↓
material-specific stories
```

## 45.2 Teza produsului

> Proprietățile materialelor trebuie legate de structuri cristaline și calcule publicate, iar efectele vizuale trebuie să separe atomii, câmpurile derivate și reprezentările conceptuale.

## 45.3 Surse candidate

- Materials Project API;
- NOMAD;
- Crystallography Open Database;
- JARVIS-DFT;
- AFLOW;
- surse experimentale selectate pentru proprietăți validate.

Materials Project necesită cheie de cont pentru API; cheia trebuie păstrată server-side sau în `.env`, nu în bundle-ul public.

## 45.4 Tipuri de date

- crystal structure;
- lattice vectors;
- symmetry;
- composition;
- formation energy;
- band structure;
- density of states;
- phonons;
- magnetic state;
- dielectric properties;
- provenance of calculations.

## 45.5 Reprezentări

### Atomic structure

- atom positions: computed or experimental structure;
- bonds: derived neighbor model;
- radii: interpretive convention;
- colors: element convention.

### Unit cell

- physical-model / reconstructed;
- lattice vectors;
- symmetry operations.

### Electronic structure

- band structure and DOS: computed prediction;
- not direct visual observation;
- Fermi level and path labels.

### Charge/spin density

- derived field;
- isosurface threshold explicit;
- colormap documented.

### Phonons

- eigenvectors from calculation;
- animated displacement scaled interpretively;
- real frequency displayed.

## 45.6 MVP

### QM0 — Crystal viewer

- material search;
- unit cell;
- atoms;
- symmetry metadata;
- source/provenance;
- local curated fallback catalog.

### QM1 — Supercell and planes

- supercell controls;
- Miller planes;
- coordination environment;
- distance measurements;
- clipping.

### QM2 — Electronic structure

- band plot;
- DOS;
- insulator/metal classification from source;
- synchronized selection.

### QM3 — Phonon mode

- selected materials;
- animated normal modes;
- frequency;
- amplitude scale note;
- deterministic export.

### QM4 — Phase bridge

- material with phase transition;
- actual Tc or transition data where available;
- Phase Lab visualization driven by material record;
- generic model shown separately from material-specific evidence.

## 45.7 Renderer

- instanced spheres;
- instanced bonds;
- unit cell lines;
- reciprocal-space charts;
- isosurfaces generated offline or worker-side;
- quality tiers by atom count;
- no need for full path tracing in MVP.

## 45.8 Gateway preview

- rotating crystal cell;
- one signature material;
- symmetry pulse;
- no live API fetch required; use curated local asset.

## 45.9 Manifest propus

```js
{
  id: "quantum-materials",
  title: "Quantum Materials",
  subtitle: "Observatory",
  family: "matter-fields",
  scale: "atomic",
  status: "development",
  route: "./quantum-materials.html",
  representations: [
    "reconstructed",
    "prediction",
    "physical-model",
    "simulation",
    "interpretive",
    "fallback"
  ],
  sources: ["materials-project", "nomad", "cod"]
}
```

## 45.10 Criterii de acceptare

- fiecare proprietate declară dacă este calculată sau experimentală;
- structura poate fi exportată/importată într-un format standard;
- unit cell și supercell sunt corecte geometric;
- band path și unitățile sunt afișate;
- animația de phonon declară factorul vizual de amplificare;
- API keys nu apar în client;
- fallback catalog funcționează offline;
- Phase Lab primește un contract de material, nu accesează direct API-ul.

## 45.11 Riscuri

- interpretarea DFT ca adevăr experimental;
- variații între calcule;
- structuri foarte mari;
- isosurfaces costisitoare;
- API key și termeni de utilizare.

Mitigare:

- `calculation provenance` complet;
- curated catalog pentru MVP;
- server adapter;
- LOD și atom caps;
- separarea `prediction` / `experiment`.

---

# 46. MODULUL 6 — Living Cosmos Observatory

## 46.1 Poziționare

```text
id: living-cosmos
family: cosmic
scale: galactic
status inițial: research
```

Living Cosmos nu trebuie să înceapă ca un simulator al întregului Univers.

MVP-ul trebuie să fie:

> o hartă 3D a vecinătății stelare bazată pe catalog, cu mișcare proprie, culoare fotometrică și sisteme exoplanetare selectate.

## 46.2 Surse candidate

- ESA Gaia Archive pentru astrometrie și fotometrie;
- NASA Exoplanet Archive prin TAP;
- SIMBAD/VizieR pentru identificare și crossmatch;
- JPL Horizons pentru corpuri ale Sistemului Solar;
- imagini survey numai ca fundal, cu proveniență separată.

## 46.3 Probleme fundamentale

- distanțele sunt extreme;
- datele au incertitudini;
- o galaxie completă nu poate fi randată la scară liniară într-o scenă simplă;
- culorile stelelor nu sunt texturi fotografice;
- planetele exoplanetare nu sunt în general imagini observate direct.

## 46.4 Model de scară

Se recomandă:

- origin rebasing;
- unități astronomice explicite;
- moduri de scară distincte;
- log scale doar când este declarat;
- tranziții între `solar`, `local-neighborhood`, `galactic`;
- scale ruler și breadcrumb.

## 46.5 MVP

### CO0 — Local stellar neighborhood

- subset Gaia preprocesat offline;
- poziții 3D;
- magnitudine;
- culoare fotometrică aproximată;
- proper motion;
- uncertainty panel.

### CO1 — Time projection

- poziția la epoch catalog;
- projection ± interval controlat;
- proper motion trails;
- avertisment că traiectoria liniară este o aproximare pe interval lung.

### CO2 — Exoplanet systems

- crossmatch host stars;
- parametri orbitali;
- transit mode;
- planet visuals interpretive;
- unknown parameters explicit.

### CO3 — Galactic context

- densitate stelară agregată;
- spiral structure interpretive/reconstructed;
- Sun position;
- local bubble layer;
- fără randarea fiecărei stele din catalog.

### CO4 — Editorial stories

- nearest stars;
- high proper-motion stars;
- exoplanet families;
- stellar lifecycle examples;
- journey Earth → Sun → nearby stars.

## 46.6 Gateway preview

- local star cloud;
- 1.000–5.000 puncte preprocesate;
- parallax motion discret;
- selected exoplanet orbit;
- fără query Gaia la fiecare load.

## 46.7 Criterii de acceptare

- epoch și coordinate frame sunt declarate;
- incertitudinile sunt disponibile;
- log scale este vizibilă în UI;
- exoplanet visuals sunt marcate interpretive;
- catalogul Gateway este local și mic;
- full observatory folosește tile/chunk loading;
- time projection este deterministă;
- userul poate reveni la Earth păstrând contextul temporal.

## 46.8 Riscuri

- catalog gigantic;
- precision loss GPU;
- scale deception;
- culori și dimensiuni exagerate;
- crossmatch complex.

Mitigare:

- preprocesare offline;
- spatial tiles;
- floating origin;
- unit tests astrometrice;
- scale modes separate;
- curated MVP.

---

# 47. MODULUL 7 — Dynamical Systems Observatory

## 47.1 Poziționare

```text
id: dynamical-systems
family: mathematical
scaleAxis: conceptual
conceptualScale: state-space
status inițial: development
```

Acest observator are cost de date redus și potențial vizual foarte mare.

El oferă platformei o familie matematică reală, nu doar o etichetă pregătită pentru viitor.

## 47.2 Teza produsului

> Un sistem matematic trebuie prezentat prin ecuații, stare, parametri și metode numerice reproductibile, nu ca o animație decorativă fără model.

## 47.3 Sisteme MVP

- Lorenz;
- Rössler;
- double pendulum;
- logistic map;
- bifurcation diagram;
- reaction–diffusion;
- cellular automata;
- N-body simplificat;
- vector fields;
- phase portraits.

## 47.4 Contract de model

```ts
interface DynamicalModel {
  id: string;
  dimensions: number;
  parameters: Record<string, number>;
  initialState: number[];
  derivative?(state: number[], time: number): number[];
  iterate?(state: number[], step: number): number[];
  invariants?: string[];
  references: string[];
}
```

## 47.5 Metode numerice

- Euler numai pentru demonstrație;
- RK4 implicit pentru ODE MVP;
- fixed timestep pentru export;
- adaptive integrator ulterior;
- precision și step size afișate;
- seed fix pentru sisteme stocastice.

## 47.6 Milestones

### DS0 — Model registry

- modele pure JS;
- schema parametri;
- unit tests;
- deterministic state.

### DS1 — Phase space renderer

- trajectories;
- vector field;
- camera;
- trails;
- color by time/speed/divergence.

### DS2 — Parameter laboratory

- slider;
- presets;
- bifurcation;
- comparison mode;
- state reset.

### DS3 — Numerical truth panel

- integrator;
- timestep;
- error estimate;
- divergence comparison;
- reproducibility export.

### DS4 — Editorial narratives

- sensitivity to initial conditions;
- order to chaos;
- emergence;
- reaction diffusion patterns;
- topology of attractors.

## 47.7 Gateway preview

- un atractor Lorenz sau reaction-diffusion;
- complet local;
- fără fetch;
- cost mic;
- seed determinist.

## 47.8 Criterii de acceptare

- ecuațiile sunt afișate;
- integratorul și timestep-ul sunt vizibile;
- resetul reproduce aceeași traiectorie;
- schimbarea FPS nu schimbă rezultatul exportat;
- metodele aproximative sunt etichetate;
- state snapshot permite replay exact;
- profile Mobile reduc trail resolution, nu model accuracy.

## 47.9 Riscuri

- confuzie între simulare și fenomen real;
- instabilitate numerică;
- animație dependentă de frame rate;
- parametri fără unități.

Mitigare:

- fixed-step simulation;
- model metadata;
- tests against known states;
- `simulation` provenance;
- separare între solver și renderer.

---

# 48. MODULUL 8 — Network Pulse Observatory

## 48.1 Poziționare

```text
id: network-pulse
family: computational
scaleAxis: network
conceptualScale: autonomous-systems
status inițial: planned
```

## 48.2 Teza produsului

> Internetul poate fi observat prin măsurători publice de latență, rutare și disponibilitate, fără a colecta conținutul comunicațiilor utilizatorilor.

## 48.3 Limite etice și de securitate

Nu se colectează:

- payloaduri;
- mesaje;
- istoric de navigare;
- IP-ul utilizatorului pentru profilare;
- trafic privat;
- identificatori personali.

Se folosesc numai:

- măsurători publice;
- date agregate;
- topologie AS;
- probe și anchors publice;
- BGP route snapshots;
- evenimente de outage documentate.

## 48.4 Surse candidate

- RIPE Atlas pentru ping/traceroute/DNS measurements;
- RouteViews pentru BGP snapshots;
- CAIDA pentru relații AS, conform licenței;
- IANA/RIR delegated statistics;
- OONI numai pentru cazuri curate și interpretare atentă.

## 48.5 MVP

### NW0 — Static topology

- subset AS graph;
- region aggregation;
- graph layout offline;
- source and timestamp;
- no live measurements.

### NW1 — Latency field

- set de measurements publice;
- probe/anchor map;
- latency color scale;
- missing data;
- uncertainty.

### NW2 — Route paths

- selected source-target;
- AS path;
- geographic approximation separated from logical path;
- time playback.

### NW3 — Outage story

- curated historical event;
- baseline vs disruption;
- BGP changes;
- latency;
- provenance.

### NW4 — Live pulse

- rate-limited snapshots;
- cache;
- stale state;
- no user-specific tests by default.

## 48.6 Renderer

- WebGL graph rendering;
- GPU instancing;
- edge bundling offline;
- globe projection optional;
- matrix view;
- timeline;
- worker parsing.

## 48.7 Gateway preview

- abstract global network;
- fixed local dataset;
- subtle pulses;
- no live traceroute at Gateway load.

## 48.8 Criterii de acceptare

- logical topology is not presented as exact physical cable map;
- timestamps and measurement IDs are available;
- no personal traffic is captured;
- stale data is explicit;
- a measurement can be replayed from diagnostic snapshot;
- rate limits are respected;
- privacy and acceptable-use review completed.

## 48.9 Riscuri

- geolocation inaccuracies;
- API rate limits;
- graph density;
- sensitive interpretation of outages;
- terms of use.

Mitigare:

- aggregation;
- curated datasets;
- server cache;
- no active measurement creation in MVP;
- legal/license review;
- neutral language.

---

# 49. Portofoliul recomandat și continuitatea scărilor

Noile module completează o călătorie coerentă prin scară:

```text
Quantum Materials
    atomic / quantum
        ↓
Living Protein
    molecular
        ↓
Living Cell
    cellular
        ↓
Living Brain
    organism / neural systems
        ↓
Living Ocean + Living Earth
    planetary
        ↓
Living Sun
    stellar
        ↓
Living Cosmos
    galactic
```

Iar cele două familii transversale oferă limbajul sistemelor:

```text
Dynamical Systems
    mathematical structure

Network Pulse
    computational emergence
```

Perceptual Phase Lab rămâne puntea dintre:

- percepție;
- ordine/dezordine;
- phase transitions;
- câmpuri;
- materiale.

---

# 50. Cross-observatory journeys

Platforma nu trebuie să ofere numai pagini independente. V4 introduce **journeys**.

## 50.1 Sun → Earth → Ocean

```text
solar event
→ SWPC state
→ auroral / atmospheric response
→ Earth story
→ ocean/atmosphere context
```

Nu se afirmă o cauzalitate oceanică imediată pentru fiecare eveniment solar. Journey-ul păstrează nivelurile de relație clar separate.

## 50.2 Protein → Cell → Brain

```text
protein structure
→ subcellular localization
→ cell type
→ tissue / brain region
→ network context
```

Fiecare trecere este o schimbare de scară și sursă, nu un zoom continuu fals.

## 50.3 Phase → Material

```text
abstract critical model
→ selected material
→ crystal structure
→ magnetic/phonon/electronic properties
```

## 50.4 Earth → Sun → Cosmos

```text
Earth camera state
→ current Sun position
→ Solar System context
→ local stellar neighborhood
```

## 50.5 Math → Physical module

Un model din Dynamical Systems poate fi deschis ca explicație pentru:

- advecția oceanului;
- oscilații;
- bifurcații;
- turbulence proxies;
- network dynamics;
- neural simulations.

Acesta este un link conceptual, nu o afirmație că același model descrie complet fenomenul.

---

# 51. Cross-page Observatory Session V4

Session Bridge din V3 trebuie extins:

```ts
interface ObservatorySessionV4 {
  time: {
    mode: "live" | "historical" | "simulation";
    utc?: string;
    playbackRate?: number;
  };

  spatialContext?: {
    frame: string;
    longitude?: number;
    latitude?: number;
    altitude?: number;
    objectId?: string;
  };

  selectedEntity?: {
    type: string;
    id: string;
    sourceId?: string;
  };

  qualityProfile: string;
  editorialPreset?: string;
  provenanceFocus?: string[];

  transition?: {
    fromObservatory: string;
    journeyId?: string;
  };
}
```

Exemple:

- Earth transmite data curentă către Sun;
- Protein transmite accession către Cell;
- Cell transmite cell type către Brain;
- Phase transmite materialId către Quantum Materials;
- Cosmos transmite host star către exoplanet system.

---

# 52. Extinderea Source Registry

Noile surse nu trebuie adăugate ca simple stringuri. Fiecare primește:

```ts
interface SourceDefinitionV4 {
  id: string;
  title: string;
  authority: string;
  endpoint: string;
  access: "public" | "account" | "api-key" | "offline-asset";
  dataType: string;
  units?: string[];
  license?: string;
  ratePolicy?: string;
  temporalCoverage?: string;
  spatialCoverage?: string;
  observatories: string[];
  defaultTtl: number;
  staleTtl: number;
  proxyRequired: boolean;
  privacyClass: "public" | "deidentified" | "restricted";
}
```

## 52.1 IDs candidate

### Sun

```text
sdo-aia
sdo-hmi
swpc-solar-wind
donki
helioviewer
```

### Ocean

```text
copernicus-marine
pace-ocean-color
noaa-oisst
argo
gebco
```

### Cell

```text
human-protein-atlas
human-cell-atlas
cellxgene
bioimage-archive
idr
cellosaurus
```

### Brain

```text
allen-brain
hcp
openneuro
neuromorpho
```

### Materials

```text
materials-project
nomad
cod
jarvis
```

### Cosmos

```text
gaia
nasa-exoplanet-archive
simbad
vizier
jpl-horizons
```

### Network

```text
ripe-atlas
routeviews
caida-as-rel
rir-stats
```

---

# 53. Server Gateway V4

Serverul unificat din P4 trebuie să devină plugin-based.

```text
server/
├── core/
│   ├── cache
│   ├── rate-limit
│   ├── auth
│   ├── provenance
│   └── health
├── routes/
│   ├── earth
│   ├── sun
│   ├── ocean
│   ├── cell
│   ├── brain
│   ├── materials
│   ├── cosmos
│   └── network
└── jobs/
    ├── scheduled-downloads
    ├── gis-processing
    ├── catalog-tiling
    └── asset-manifests
```

## 53.1 Reguli

- browserul nu primește chei private;
- upstream allowlist;
- request validation;
- rate limit per provider;
- cache keys versionate;
- payload size limits;
- health pe capabilități;
- fiecare route poate fi dezactivat separat;
- datele restricționate nu sunt redistribuite automat.

## 53.2 Health response

```json
{
  "status": "ok",
  "capabilities": {
    "earth": true,
    "sun": true,
    "ocean": false,
    "materials": true,
    "h264": true
  },
  "sources": {
    "swpc": "ok",
    "materials-project": "missing-api-key",
    "copernicus-marine": "not-configured"
  }
}
```

---

# 54. Gateway evolution pentru mai mult de două observatoare

V3 stabilește corect că Gateway-ul actual este un hero dual-portal.

V4 nu recomandă transformarea lui într-o scenă cu opt portaluri simultane.

## 54.1 Model recomandat

```text
Hero Gateway
    maximum 2 featured observatories

Observatory Constellation
    4–8 lightweight previews

Atlas Grid
    toate modulele
```

## 54.2 Featured rotation

Registry-ul poate declara:

```js
featuredPriority: 100
featuredSeason: "solar-storm"
```

Exemple:

- Sun + Earth în timpul unui story solar;
- Protein + Cell pentru un episod biologic;
- Phase + Materials pentru o tranziție de fază;
- Earth + Ocean pentru un episod climatic.

## 54.3 Preview contract

```ts
interface GatewayPreviewAdapter {
  id: string;
  load(context): Promise<void>;
  setQuality(profile): void;
  setFocus(active: boolean): void;
  render(time: number): void;
  getTexture?(): WebGLTexture;
  destroy(): void;
}
```

Preview-ul trebuie să aibă buget maxim explicit și să nu pornească runtime-ul complet al observatorului.

---

# 55. Shared renderer capabilities

Nu se unifică toate rendererele, dar se pot reutiliza pachete comune.

```text
src/shared/rendering/
├── color-management
├── camera-state
├── picking
├── instancing
├── line-rendering
├── volume-textures
├── colormaps
├── legends
├── scale-bars
├── time-axis
├── capture
└── gpu-diagnostics
```

## 55.1 Componente cu impact mare

### Scientific colormap registry

- viridis/cividis-like perceptual maps;
- diverging maps pentru magnetism;
- categorical maps;
- colorblind checks;
- unit metadata.

### Scale bar service

Obligatoriu pentru:

- Protein;
- Cell;
- Brain neuron;
- Materials;
- Ocean profile.

### Field renderer

Reutilizat de:

- Ocean currents;
- solar magnetogram;
- Phase Lab;
- mathematical vector fields;
- network density.

### Timeline service

Reutilizat de:

- Earth;
- Sun;
- Ocean;
- Brain temporal packages;
- Cosmos epochs;
- Network outages.

---

# 56. Data volume și storage strategy

## 56.1 Patru niveluri de active

```text
L0 — bundled fallback
L1 — gateway preview
L2 — observatory runtime
L3 — research / historical package
```

### L0

- foarte mic;
- inclus în build;
- offline;
- fără pretenție live.

### L1

- sub câțiva MB per modul;
- cache lung;
- imagine sau geometrie compactă.

### L2

- descărcare la intrarea în observator;
- chunking;
- persistent cache;
- quality selection.

### L3

- pachete istorice;
- descărcare explicită;
- poate necesita server;
- nu este prefetch-uit.

## 56.2 Formate recomandate

| Date | Format |
|---|---|
| texturi GPU | KTX2 |
| raster geospatial | COG / Zarr în pipeline, KTX2 la runtime |
| volume microscopy | OME-Zarr |
| catalog stele | binary tiles / Arrow / custom packed buffers |
| structuri materiale | JSON/CIF compact + typed arrays |
| neuron morphology | SWC normalizat |
| graph data | binary adjacency / CSR |
| time-series | Arrow/Parquet offline, packed arrays runtime |
| manifests | JSON versionat |

---

# 57. Bugete de performanță pentru modulele V4

Valorile sunt ținte inițiale, nu promisiuni absolute.

| Modul | Mobile GPU | Balanced GPU | High GPU | Preview |
|---|---:|---:|---:|---:|
| Sun | 1–2 texturi + shell | multi-band 2–3 | multi-band + events | 1 texture |
| Ocean | 256×128 field | 512×256 field | 1024×512 field | 128×64 |
| Cell | LOD organelles | standard scene | volume + scene | baked preview |
| Brain | 10k edges cap | 50k edges | 150k+ selective | baked/low graph |
| Materials | 5k atoms cap | 25k instanced | 100k selected | one cell |
| Cosmos | 50k stars | 250k stars | 1M tiled | 5k stars |
| Dynamics | 50k trail pts | 250k | 1M | 20k |
| Network | 5k nodes/edges | 30k | 100k aggregated | 2k |

## 57.1 Regula fundamentală

Quality profile poate reduce:

- rezoluția;
- numărul de elemente;
- post-processing;
- dimensiunea texturilor;
- frecvența actualizărilor.

Nu poate schimba:

- modelul științific;
- timestampul;
- unitățile;
- proveniența;
- starea live/stale;
- semnificația datelor.

---

# 58. Proveniență multi-modul

V4 adaugă o problemă nouă: un story poate folosi mai multe observatoare.

## 58.1 Story provenance graph

```ts
interface StoryProvenanceGraph {
  storyId: string;
  nodes: ProvenanceRecord[];
  edges: Array<{
    from: string;
    to: string;
    relation:
      | "derived-from"
      | "aligned-with"
      | "context-for"
      | "visualized-by"
      | "simulated-from";
  }>;
}
```

Exemplu Sun → Earth:

```text
AIA image
    aligned-with
SWPC solar-wind snapshot
    context-for
Earth aurora layer
    visualized-by
cinematic emission pass
```

## 58.2 Provenance UI

Utilizatorul trebuie să poată vedea:

- ce este live;
- ce este measured;
- ce este computed;
- ce este interpolated;
- ce este interpretive;
- ce este fallback;
- dacă două straturi au timestampuri diferite.

---

# 59. Security, privacy și licensing

## 59.1 Brain și Cell

- numai date publice și de-identificate în MVP;
- fără upload clinic;
- fără inferențe medicale;
- fără diagnostic;
- respectarea termenilor datasetului;
- provenance la nivel de dataset.

## 59.2 Network

- fără captură de trafic;
- fără traceroute automat de la utilizator în MVP;
- fără maparea IP-ului utilizatorului;
- rate limits;
- neutral outage language;
- ToS review.

## 59.3 Materials

- API key server-side;
- termenii bazelor de date documentați;
- citation metadata păstrată;
- diferență între date publice și redistribuire permisă.

## 59.4 Cosmos și Sun

- respectarea creditelor misiunilor;
- timestamps și instrumente;
- cache și redistribuire conform politicilor;
- nu se elimină watermark/credit obligatoriu dacă sursa îl cere.

---

# 60. Strategia de implementare pe valuri

Fundația V3 rămâne obligatorie.

## Valul 0 — Platform Foundation

```text
P0 → P8 din V3
```

Nu se începe un portofoliu de opt observatoare înainte de:

- build reproducibil;
- module contract;
- runtime comun;
- lifecycle;
- quality;
- provenance;
- tests.

## Valul 1 — Validarea extensibilității

1. Perceptual Phase Lab — deja început;
2. Living Sun MVP;
3. Quantum Materials crystal viewer;
4. Living Cell frame + protein bridge.

Motiv:

- fiecare testează o familie diferită;
- reutilizează infrastructura existentă;
- Gateway previews sunt distincte;
- nu necesită încă date istorice masive.

## Valul 2 — Planetary și mathematical expansion

5. Living Ocean static + current field;
6. Dynamical Systems model registry + phase renderer.

## Valul 3 — High-complexity observatories

7. Living Brain atlas + neuron MVP;
8. Living Cosmos local neighborhood.

## Valul 4 — Computational systems

9. Network Pulse static topology + curated measurement story.

---

# 61. Ordinea recomandată a celor minimum cinci module

Dacă se implementează numai cinci, ordinea este:

```text
1. Living Sun
2. Quantum Materials
3. Living Cell
4. Living Ocean
5. Living Brain
```

## De ce Living Sun primul

- reutilizează NOAA și logica Earth;
- oferă Gateway impact imediat;
- deschide cross-observatory stories;
- datele pot fi reprezentate întâi ca imagini, fără simulare complexă.

## De ce Quantum Materials al doilea

- reutilizează Phase Lab;
- dataseturile sunt structurate;
- MVP-ul crystal viewer este finit;
- aduce familia Matter & Fields în producție.

## De ce Living Cell al treilea

- extinde Living Protein;
- validează journey și provenance multi-scale;
- aduce volum și microscopy pipeline.

## De ce Living Ocean al patrulea

- reutilizează Earth și GIS pipeline;
- are impact editorial mare;
- necesită însă field advection și date raster mai grele.

## De ce Living Brain al cincilea

- impact foarte mare;
- dar necesită cea mai atentă disciplină de scară, date și interpretare.

---

# 62. Estimări realiste pentru MVP-uri

Estimări pentru un singur dezvoltator, după fundația V3.

| Modul | MVP selectiv | Versiune solidă |
|---|---:|---:|
| Living Sun | 3–5 săpt | 8–12 săpt |
| Quantum Materials | 4–6 săpt | 10–16 săpt |
| Living Cell | 6–10 săpt | 16–24 săpt |
| Living Ocean | 6–10 săpt | 16–24 săpt |
| Living Brain | 8–14 săpt | 20–32 săpt |
| Living Cosmos | 8–14 săpt | 20–30 săpt |
| Dynamical Systems | 3–6 săpt | 10–16 săpt |
| Network Pulse | 6–10 săpt | 16–24 săpt |

Aceste intervale presupun reutilizarea platformei. Fără P0–P8, fiecare modul va recrea:

- fetch;
- cache;
- status;
- export;
- quality;
- lifecycle;
- provenance;

și costul total va crește semnificativ.

---

# 63. Gate-uri de aprobare pentru noile module

## Gate F — Portfolio readiness

- taxonomia V4 acceptă module conceptuale și network;
- Atlasul poate afișa minimum cinci module planned;
- Registry schema validează manifestele;
- Gateway preview contract este stabil.

## Gate G — Living Sun

- sursă și bandă declarate;
- fallback local;
- timestamp;
- runtime comun;
- Earth link;
- mount/destroy.

## Gate H — Protein → Cell

- accession transfer;
- localizare proteică;
- scale transition;
- composite provenance;
- no medical inference.

## Gate I — Phase → Materials

- material contract;
- crystal structure;
- computed/experimental separation;
- API key safe;
- offline catalog.

## Gate J — Ocean

- field units;
- no-data;
- timestamp alignment;
- deterministic advection;
- mobile budget.

## Gate K — Brain

- atlas/species declared;
- connectivity method;
- privacy review;
- scale separation;
- graph performance.

## Gate L — Five-module platform

Platforma poate găzdui simultan în registry:

```text
Earth
Protein
Phase
Sun
Materials
Cell
Ocean
Brain
```

fără cod special în:

- Atlas;
- Control Center;
- Provenance Inspector;
- Quality Service;
- Session Bridge;
- module host.

Gateway poate selecta două featured fără recompilarea shaderului pentru fiecare pereche.

---

# 64. Primul sprint V4 — 20 de zile după fundația V3

Acest sprint nu construiește toate modulele. El demonstrează că portofoliul este posibil.

## Zilele 1–2 — Taxonomy V4

- `scaleAxis`;
- conceptual/network scale;
- schema migration;
- Atlas filters;
- tests.

## Zilele 3–4 — New module manifests

Adăugare `planned` pentru:

- Sun;
- Ocean;
- Cell;
- Brain;
- Materials;
- Cosmos;
- Dynamics;
- Network.

Nu se activează route până când MVP-ul nu există.

## Zilele 5–7 — Preview contract

- generic preview host;
- static texture preview;
- procedural preview;
- focus/pause/destroy;
- budget metrics.

## Zilele 8–11 — Living Sun spike

- un cadru solar;
- manifest;
- provider;
- fallback;
- Gateway adapter;
- timestamp/provenance.

## Zilele 12–15 — Quantum Materials spike

- local CIF/JSON;
- instanced crystal;
- unit cell;
- material manifest;
- Gateway preview.

## Zilele 16–18 — Protein → Cell contract spike

- mock cell scene;
- protein accession bridge;
- provenance graph;
- route transition.

## Ziua 19 — Diagnostics

- snapshot cu cele trei module;
- offline mode;
- source states;
- lifecycle test.

## Ziua 20 — Gate review

Se aprobă numai dacă:

- nu s-a duplicat runtime-ul;
- modulele folosesc același contract;
- Gateway previews au buget;
- V3 Earth/Protein nu au regresii;
- planned modules nu încetinesc bootstrap-ul.

---

# 65. Primul build V4 recomandat

## Nume

```text
luminomorphism-observatory-portfolio-v0.1
```

## Conținut

- tot buildul stabil al fundației V3;
- taxonomie V4 compatibilă;
- manifests pentru cele opt module;
- Atlas cards planned;
- preview contract generic;
- Living Sun spike;
- Quantum Materials spike;
- Protein → Cell journey mock;
- source registry extins;
- diagnostic snapshot extins;
- documentație.

## Ce nu intră

- full Ocean;
- full Brain;
- full Cosmos;
- live Network;
- volume microscopy mare;
- WebGPU migration;
- redesign total Gateway;
- PBR Earth și module noi în același pass.

---

# 66. Definition of Done pentru un observator nou

Un observator nu este considerat integrat doar pentru că se vede pe ecran.

Trebuie să îndeplinească toate condițiile:

## Contract

- manifest valid;
- module lifecycle complet;
- idempotent destroy;
- state schema versionată.

## Data

- provider runtime;
- validation;
- cache;
- stale/fallback;
- offline simulation;
- timestamp și unități.

## Provenance

- representation;
- lineage;
- processing steps;
- source/license;
- partial/stale state.

## Quality

- minimal/mobile/balanced/high;
- preview budget;
- visibility pause;
- performance diagnostics.

## Editorial

- minimum două preseturi;
- un story sau guided explanation;
- still export;
- deterministic state.

## QA

- unit tests;
- integration test;
- visual baseline;
- mount/destroy loop;
- offline test;
- error state test.

## Platform

- Atlas card;
- Gateway adapter sau fallback preview;
- Control Center;
- Source Inspector;
- Session Bridge;
- diagnostic snapshot/replay.

---

# 67. Non-goals V4

- construirea simultană a tuturor observatoarelor;
- un singur renderer universal;
- un super-scene WebGL cu toate modulele active;
- folosirea AI generativ pentru a completa date lipsă fără etichetare;
- afirmația că fiecare efect vizual este măsurat;
- upload clinic;
- diagnoză medicală;
- colectarea traficului utilizatorilor;
- copierea bazelor de date complete în client;
- WebGPU obligatoriu în producție;
- realism artistic înaintea provenienței.

---

# 68. Surse candidate și pagini oficiale de documentație

Lista este orientativă și trebuie reverificată la implementare pentru versiuni, termeni și rate limits.

## Sun

- NASA SDO: `https://sdo.gsfc.nasa.gov/`
- Helioviewer: `https://helioviewer.org/`
- NOAA SWPC services: `https://services.swpc.noaa.gov/`
- NASA DONKI: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/`

## Ocean

- Copernicus Marine: `https://data.marine.copernicus.eu/`
- NASA Ocean Color / PACE: `https://oceancolor.gsfc.nasa.gov/`
- Argo: `https://argo.ucsd.edu/`
- NOAA OISST: `https://www.ncei.noaa.gov/products/optimum-interpolation-sst`

## Cell

- Human Protein Atlas: `https://www.proteinatlas.org/`
- Human Cell Atlas: `https://www.humancellatlas.org/`
- CZ CELLxGENE: `https://cellxgene.cziscience.com/`
- BioImage Archive: `https://www.ebi.ac.uk/bioimage-archive/`
- Image Data Resource: `https://idr.openmicroscopy.org/`
- Cellosaurus: `https://www.cellosaurus.org/`

## Brain

- Allen Brain Map: `https://portal.brain-map.org/`
- Human Connectome Project: `https://www.humanconnectome.org/`
- OpenNeuro: `https://openneuro.org/`
- NeuroMorpho.Org: `https://neuromorpho.org/`

## Materials

- Materials Project: `https://materialsproject.org/`
- Materials Project API docs: `https://docs.materialsproject.org/downloading-data/using-the-api/getting-started`
- NOMAD: `https://nomad-lab.eu/`
- Crystallography Open Database: `https://www.crystallography.net/cod/`
- JARVIS: `https://jarvis.nist.gov/`

## Cosmos

- ESA Gaia Archive: `https://gea.esac.esa.int/archive/`
- NASA Exoplanet Archive: `https://exoplanetarchive.ipac.caltech.edu/`
- SIMBAD: `https://simbad.cds.unistra.fr/`
- VizieR: `https://vizier.cds.unistra.fr/`
- JPL Horizons: `https://ssd.jpl.nasa.gov/horizons/`

## Network

- RIPE Atlas: `https://atlas.ripe.net/`
- RouteViews: `https://www.routeviews.org/`
- CAIDA: `https://www.caida.org/`
- IANA: `https://www.iana.org/`

---

# 69. Rezumat executiv V4

## Ce se păstrează

Tot ce există în V3:

- Platform Foundation;
- Unified Runtime;
- module contract;
- Gateway strategy;
- Living Earth track;
- Living Protein track;
- Phase Lab integration;
- Editorial Runtime;
- Asset Pipeline;
- QA;
- provenance;
- estimări;
- gate-uri.

## Ce adaugă V4

Un portofoliu coerent de observatoare:

```text
Living Sun
Living Ocean
Living Cell
Living Brain
Quantum Materials
Living Cosmos
Dynamical Systems
Network Pulse
```

## Decizia critică

Noile module nu trebuie începute ca proiecte independente.

Ordinea corectă rămâne:

```text
Platform Foundation V3
→ Phase Lab validation
→ Sun / Materials / Cell spikes
→ Ocean / Dynamics
→ Brain / Cosmos
→ Network
```

## Imaginea finală a platformei

```text
LUMINOMORPHISM
│
├── Planetary Systems
│   ├── Living Earth
│   └── Living Ocean
│
├── Life Systems
│   ├── Living Protein
│   ├── Living Cell
│   └── Living Brain
│
├── Cosmic Systems
│   ├── Living Sun
│   └── Living Cosmos
│
├── Matter & Fields
│   ├── Perceptual Phase Lab
│   └── Quantum Materials
│
├── Mathematical Reality
│   └── Dynamical Systems
│
└── Computational Systems
    └── Network Pulse
```

Această structură transformă proiectul într-o platformă cu identitate clară: nu un catalog de efecte, ci o serie de observatoare care declară ce măsoară, ce modelează și ce interpretează.
