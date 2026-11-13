# Living Earth Observatory — Masterplan Executabil
**Versiune:** 1.0 · **Data:** 25 iulie 2026 · **Owner:** Tutu (solo)
**Hardware țintă:** Windows 11, GTX 1650 4GB VRAM
**Filozofie:** Luminomorphism — lumina ca material, nu decorațiune. Fiecare element vizual justificat de date reale sau fizică reală.

---

## 0. CONTRACTUL ACESTUI DOCUMENT

Acest roadmap este construit ca **sistem de gate-uri**, nu ca listă de dorințe.

**Regula de aur:**
> Nu ai voie să scrii o linie de cod dintr-o fază până când gate-ul fazei anterioare nu este **verde și public**.

**De ce:** Ai un tipar documentat — construiești infrastructură profundă înainte să publici. Klein Vitae: 17 faze, ~170 fișiere, plan care supra-specifica probleme deja rezolvate. AutoDev Brain: M1–M21 înainte de lansare. Living Earth are deja runtime host, observatory contract, replay diagnostic — dar suprafața planetei rulează pe două PNG-uri de 2160×1080.

**Antidotul din acest document:**
1. Fiecare fază are o **durată maximă**. Depășirea = tăiere de scope, nu extindere de deadline.
2. Fiecare gate cere un **artefact public** (deploy live), nu un document intern.
3. Există un **Backlog Înghețat** (§7). Orice idee nouă care apare merge acolo, nu în faza curentă.
4. Există **Reguli de Tăiere** (§8) — criterii pre-scrise pentru ce sacrifici când rămâi fără timp.

**Test de sănătate săptămânal (o singură întrebare):**
> Ce am publicat săptămâna asta pe care un străin îl poate deschide într-un browser?

Dacă răspunsul e „nimic, dar am refactorizat X" — două săptămâni la rând — oprește tot și fă deploy cu ce ai.

---

## 1. METRICI DE SUCCES (măsurabile, nu impresii)

Toate se măsoară pe GTX 1650, 1080p, Chrome, fereastră maximizată.

| Metrică | Baseline (de măsurat) | Țintă Faza 0 | Țintă Faza 1 | Instrument |
|---|---|---|---|---|
| VRAM total | ? | ≤ 2.8 GB | ≤ 3.2 GB | `chrome://gpu` + Task Manager |
| VRAM doar texturi | ? | ≤ 900 MB | ≤ 1.2 GB | Spector.js texture inspector |
| FPS median (glob rotativ, toate straturile) | 59.9 | ≥ 50 | ≥ 45 | sampler rAF, 10 s |
| FPS p1 (worst 1%) | 49.0 | ≥ 30 | ≥ 30 | idem |
| Time to first frame | ? | ≤ 3.5 s | ≤ 2.5 s | Lighthouse / Performance |
| Time to interactive (glob rotibil) | ? | ≤ 6 s | ≤ 4 s | manual + Performance |
| Draw calls / frame | ? | ≤ 120 | ≤ 80 | Spector.js |
| Payload inițial (network) | ? | ≤ 8 MB | ≤ 5 MB | DevTools Network |
| Rezoluție efectivă suprafață la zoom max | ~2160px echiv. | ≥ 8192px echiv. — atins în aug. prin WMS 8192×4096; **din 12 nov. 2026 textura globală e 4096×2048** (WMTS z3, 5120×2560 redus), regresie acceptată pentru fiabilitate (WMS 45–160 s / 504). z4 (10240×5120, 200 de dale, ~9 s) ar readuce ≥ 8192, cu ~210 MB VRAM RGBA8 | ≥ 16384px echiv. — **amânat**: cere LOD dinamic pe dale (tăiat în Sprint 0.3), nu o singură textură globală | vizual + tile level |

> **IMPORTANT:** Coloana „Baseline" se completează în Sprint 0.1. Fără baseline, nu ai cum să știi dacă o optimizare a ajutat. Nu sări peste asta.

---

## 2. FAZA 0 — SHIP (27 iulie – 9 august 2026, 2 săptămâni)

**Obiectiv unic:** Suprafața planetei să arate la nivelul chassis-ului pe care deja l-ai construit. Apoi publici.

**Ce NU se face în Faza 0:** niciun observator nou, niciun refactor de arhitectură, niciun WebGPU, niciun layer nou de date.

### Sprint 0.1 — Baseline & profilare (27–28 iulie, 2 zile)

**Livrabil:** un fișier `docs/perf-baseline-2026-07.md` cu numere reale.

**Task-uri:**

- [ ] Instalează Spector.js (extensie Chrome). Capturează un frame complet.
- [ ] Completează toate rândurile „Baseline" din tabelul §1.
- [ ] Inventar texturi: listează fiecare textură încărcată, dimensiune pixeli, format, VRAM ocupat.
  ```
  VRAM per textură = width × height × bytes_per_pixel × (1.333 dacă are mipmaps)
  RGBA8 = 4 bytes/px  →  2160×1080 RGBA8 + mips ≈ 12.4 MB
  ```
- [ ] Identifică top 5 consumatori de VRAM.
- [ ] Măsoară costul bloom-ului: rulează o dată cu `UnrealBloomPass` dezactivat, notează delta FPS.
- [ ] Screenshot „înainte" la 3 niveluri de zoom (glob întreg / continent / regiune) pentru comparație vizuală ulterioară.

**Definition of Done:** Ai numere, nu impresii. Știi exact unde se duc cei 4GB.

**Criteriu de decizie:** Dacă bloom-ul costă >8 FPS → prioritate ridicată pentru Sprint 0.4. Dacă texturile ocupă <400MB → KTX2 rămâne util pentru load time, dar scade în prioritate față de tile streaming.

---

### Sprint 0.2 — Pipeline KTX2 / Basis Universal (29–31 iulie, 3 zile)

**Livrabil:** toate texturile statice servite ca `.ktx2`, cu fallback la PNG/JPG.

**De ce:** KTX2+Basis rămâne comprimat în VRAM (transcodează la BC7/BC5 pe desktop). Reducere tipică 4–8×. O textură 2048×2048 RGBA ocupă 16MB în memorie indiferent cât de mic era PNG-ul — compresia GPU e singurul lucru care schimbă asta.

**Task-uri:**
- [ ] Instalează KTX-Software (`toktx` CLI). Verifică: `toktx --version`
- [x] Creează script `tools/encode-textures.mjs` care rulează batch:
  ```bash
  # Albedo / color (ETC1S + Zstd — raport bun compresie/calitate)
  toktx --t2 --encode etc1s --clevel 4 --qlevel 192 \
        --genmipmap --zcmp 18 \
        out/etopo2022-relief.ktx2 src/etopo2022-bedrock-relief-2160x1080.png

  # Normal maps (UASTC — păstrează precizia direcțională)
  toktx --t2 --encode uastc --uastc_quality 3 \
        --normal_mode --genmipmap --zcmp 18 \
        out/etopo2022-normal.ktx2 src/etopo2022-normal.png
  ```
  > **Atenție la normal maps:** ETC1S distruge normalele (artefacte de bandă vizibile pe relief). Folosește UASTC + `--normal_mode`. Costă mai mult VRAM decât ETC1S dar tot mult mai puțin decât necomprimat.
- [x] Integrează `KTX2Loader` în Three.js:
  ```js
  import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

  const ktx2Loader = new KTX2Loader()
    .setTranscoderPath('/vendor/basis/')   // basis_transcoder.js + .wasm
    .detectSupport(renderer);              // OBLIGATORIU, după crearea renderer-ului
  ```
- [x] Copiază `basis_transcoder.js` + `basis_transcoder.wasm` din `three/examples/jsm/libs/basis/` în `vendor/basis/`.
- [x] Implementează fallback: dacă `.ktx2` eșuează la fetch sau transcode, încarcă PNG-ul original. Loghează un avertisment clar în consolă; integrarea în observatory contract rămâne de făcut.
- [x] Re-măsoară VRAM. Compară cu baseline. Rezultat 2026-07-26, captură comparabilă: textura totală `755 MiB → 168.1 MiB` (`-77.7%`); pragul DoD de `>=60%` este depășit.

**Definition of Done:**
- VRAM texturi scăzut cu ≥60% față de baseline.
- Zero regresie vizuală perceptibilă la screenshot-urile din 0.1 (compară side-by-side).
- Fallback testat (redenumește un `.ktx2` și verifică că se încarcă PNG-ul).

**Capcane cunoscute:**
- `detectSupport()` trebuie apelat DUPĂ ce ai renderer-ul, altfel transcodează la format greșit.
- Serverul trebuie să servească `.wasm` cu `Content-Type: application/wasm`. GitHub Pages o face corect; un dev server local poate să nu.
- `.ktx2` trebuie servit cu CORS corect dacă e pe alt domeniu.

---

### Sprint 0.3 — Streaming de tile-uri GIBS (1–4 august, 4 zile) ⭐ CEL MAI MARE IMPACT

**Livrabil:** suprafața globului alimentată din NASA GIBS WMTS, cu LOD pe zoom.

**De ce:** Ăsta e saltul de la 2160×1080 static la rezoluție de nivel satelit, time-enabled, fără cheie API, CORS-friendly. Nu construiești virtual texturing — folosești un serviciu care servește deja tile-uri pre-rendered.

**Task-uri:**
- [x] **Hardcodează** identificatorii de layer (NU fetch-ui GetCapabilities la runtime — e ~5.6MB). `src/earth/gibs-tiles.js` include catalogul; fluxul existent **Daily clouds** rămâne pe compozitul WMS global `VIIRS_SNPP_CorrectedReflectance_TrueColor`.
  ```js
  const GIBS_LAYERS = {
    trueColor: {
      id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      matrixSet: '250m', ext: 'jpg', maxZoom: 8, temporal: true,
    },
    blueMarble: {
      id: 'BlueMarble_ShadedRelief_Bathymetry',
      matrixSet: '500m', ext: 'jpeg', maxZoom: 8, temporal: false,
    },
    nightLights: {
      id: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance',
      matrixSet: '500m', ext: 'png', maxZoom: 8, temporal: true,
    },
  };
  ```
- [x] Implementează URL builder RESTful: hostul public canonic este `gibs.earthdata.nasa.gov`; există fallback WMS per tile pentru rețele/browser-e care refuză WMTS.
  ```js
  // Rotire pe gibs-a/b/c pentru a ocoli limita de 6 conexiuni/domeniu a browserului
  const HOSTS = ['gibs-a', 'gibs-b', 'gibs-c'];

  function tileURL(layer, date, z, y, x) {
    const host = HOSTS[(x + y) % HOSTS.length];
    const time = layer.temporal ? date : 'default';
    return `https://${host}.earthdata.nasa.gov/wmts/epsg4326/best/` +
           `${layer.id}/default/${time}/${layer.matrixSet}/${z}/${y}/${x}.${layer.ext}`;
  }
  ```
  > **Atenție la ordinea parametrilor:** GIBS folosește `{z}/{y}/{x}` (rând înainte de coloană), nu `{z}/{x}/{y}`. Inversarea e cauza clasică de „tile-uri în locul greșit". Ai avut deja un bug `[lat,lon]` vs `[lon,lat]` în v2.4.2 — aceeași clasă de eroare.
- [x] Matematica grilei pe lat/lon EPSG:4326 (2:1) este izolată și verificată în `gibs-tiles.js`:
  ```
  numCols(z) = 2 × 2^z
  numRows(z) = 1 × 2^z
  tileLonSpan(z) = 360 / numCols(z)
  tileLatSpan(z) = 180 / numRows(z)
  ```
- [ ] Selecție LOD după distanța camerei + unghiul de vedere. Regulă simplă de start: alege z astfel încât un tile să acopere ~256 pixeli pe ecran. *(tăiat conform regulii de mai jos — trece în Faza 1.)*
- [ ] Frustum culling pe tile-uri: nu cere tile-uri de pe partea opusă a globului. (Test rapid: `dot(tileNormal, cameraDir) > -0.1`) *(tăiat — trece în Faza 1.)*
- [ ] Coadă de încărcare cu prioritate (tile-uri centrale înainte de cele periferice) + limită de cereri simultane. Primitiva e implementată și verificată în `gibs-tiles.js` (`GibsTileQueue`, `LruTileCache`), dar rămâne neconectată la randare — nu era necesară pentru varianta cu nivel fix de mai jos.
- [x] **Experiment respins:** mozaicul WMTS VIIRS la `z=1` a produs discontinuități/swatch-uri vizibile în masca de nori. `Daily clouds` a revenit la WMS global, coerent vizual; concluzia a ghidat direct decizia de mai jos — nu relua stitching client-side de tile-uri pe un produs cu swath-uri (imagerie zilnică).
- [ ] Cross-fade între nivelurile LOD (evită pop-ul brusc). *(irelevant fără LOD dinamic — trece în Faza 1 odată cu el.)*
- [ ] Cache LRU în memorie, plafonat (ex. 400 tile-uri) pentru a nu exploda VRAM. *(neutilizat încă — vezi nota de mai sus.)*
- [x] **Regulă de tăiere aplicată (6 august):** în loc de quadtree/LOD dinamic, suprafața de zi (`earthMat.map`, fostă textură CDN low-res threejs.org 2048×1024) e alimentată acum dintr-un **singur raster WMS NASA GIBS Blue Marble Shaded Relief and Bathymetry**, la cea mai mare rezoluție care răspunde dintr-o scară de fallback (`8192×4096 → 4096×2048 → 2048×1024`). Confirmat live: **8192×4096** răspunde direct, fără a fi nevoie de treptele mai mici. Blue Marble e non-temporal (compozit unic, nu swath-uri zilnice), deci nu are problema de seams întâlnită mai sus la VIIRS — un singur `WMS GetMap` mare e suficient, fără `composeGibsEquirectangularMosaic`. Implementare: `src/earth/gibs-surface.js` (nou) + swap async în `src/earth/earth-layers.js` pe `earthMat.map`/`earthMatPBR.map`, cu watchdog de 16s și fallback onest pe textura veche dacă rețeaua/CORS eșuează, plus rând nou de status `#surfaceStatus` în panou (același tipar ca Black Marble). **Actualizare 12–13 nov. 2026 (LOT 4 / 4b-A, `5cd2873`, `48a2651`, `9b02f3e`):** stratul e acum `BlueMarble_NextGeneration` (fără relief umbrit), încărcat din **dale WMTS**, progresiv: z2 (2560×1280) apoi z3 (5120×2560 redus la 4096×2048), cu timeout de 15 s per dală (doar timp vizibil) și o reîncercare. Motiv: WMS-ul GIBS răspundea în 45–160 s sau cu 504 (măsurat 12 nov. 2026), iar WMTS în ~0,3–0,7 s per dală. Fallback local: `assets/blue-marble-ng-4096x2048.jpg`.

**Definition of Done:**
- [x] Zoom la nivel de regiune arată detaliu satelit real, nu texeli întinși — satisfăcut prin nivelul fix Blue Marble 8192×4096, nu prin LOD dinamic.
- [x] Nu depășești bugetul VRAM (§1) — +~168 MB net față de textura CDN veche (~179 MB decodat vs. ~11 MB), total texturi ≈ 335–350 MB, sub plafonul de 2.8 GB. De remăsurat cu Spector la următorul checkpoint pentru un număr exact, nu doar estimare.
- [ ] Nicio cerere de tile pentru fața invizibilă a globului — N/A pe calea aleasă (un singur raster global, nu tile-uri individuale).
- [x] Atribuire NASA/GIBS vizibilă în UI — rândul `Surface: NASA GIBS / Blue Marble Shaded Relief and Bathymetry active (...)`.

**Regulă de tăiere:** ~~Dacă la ziua 3 quadtree-ul nu e funcțional, taie LOD-ul dinamic și livrează **un singur nivel fix** de tile-uri (z=4 sau z=5) în loc de PNG-ul static.~~ **Aplicată pe 6 august**, dar cu un raster WMS unic în loc de tile-uri fixe asamblate — echivalent ca rezultat (salt masiv față de 2160×1080), mai simplu de implementat și fără risc de seams. LOD-ul dinamic real rămâne tăiat spre Faza 1, dacă se dovedește necesar după Gate 0. **Actualizare 12 nov. 2026:** s-a ajuns totuși la nivelul fix de tile-uri — dale WMTS compuse într-o singură textură (z3 pentru suprafață, z2 pentru Black Marble), pentru că WMS-ul a devenit nefiabil (45–160 s / 504); grila EPSG:4326 corectă (2×1 dale de 288° la z0, 10×5 de 36° la z3) e declarată explicit în `src/earth/gibs-tiles.js`.

---

### Sprint 0.4 — Lumină: night lights, tone mapping, bloom (5–6 august, 2 zile)

**Livrabil:** partea de noapte a globului devine cinematică; pipeline HDR corect.

**Task-uri:**
- [x] **Night lights VIIRS Black Marble** prin GIBS: compozitul anual observat 2016 este încărcat asincron prin WMS (2048×1024) peste fallbackul local. *Actualizare 12 nov. 2026 (`48a2651`):* acum din dale WMTS z2 (5×3 dale, 2560×1280), din același motiv ca suprafața (WMS 45–160 s / 504). Dacă rețeaua/CORS eșuează, fallbackul rămâne activ; atribuirea NASA GIBS / VIIRS Black Marble este vizibilă în UI. Răspuns NASA verificat: `200 image/png`.
- [x] Blend cu terminatorul solar pe care deja îl calculezi: Black Marble folosește `sunDotRefracted = dot(N, L) + 0.0099` și o mască emisivă de noapte; tranziția a fost verificată vizual la 2026-07-26 cu ghidul de terminator. UI-ul confirmă explicit `Black Marble: NASA GIBS / VIIRS 2016 active — fades at solar terminator`; dacă încărcarea eșuează sau întârzie, declară fallbackul local după watchdog, fără stare ambiguă.
  ```glsl
  // Ai deja refracția: sunDot' = dot(N, L) + 0.0099  (≈ +0.567° la orizont)
  float night = smoothstep(0.10, -0.15, sunDotRefracted);
  vec3 lights  = texture(uNightLights, vUv).rgb;
  // Emisiv, nu difuz — luminile nu sunt iluminate de soare
  color += lights * night * uNightIntensity;
  ```
  > Justificare Luminomorphism: luminile de noapte sunt **radianță măsurată**, nu decorațiune. Etichetează stratul ca `observed` în observatory contract.
- [x] **ACES Filmic tone mapping:** configurat în `scene-runtime.js`, cu `OutputPass` în composer (fără dublare în shadere).
  ```js
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  ```
  Verifică că `OutputPass` din composer respectă tone mapping-ul (în Three.js modern, `OutputPass` îl aplică — nu îl dubla în shadere custom).
- [x] **Bloom la jumătate de rezoluție:** `UnrealBloomPass` rulează la 50% din viewport și rămâne la 50% după resize.
  ```js
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w * 0.5, h * 0.5),  // ← half-res
    strength, radius, threshold
  );
  ```
  Câștig tipic de FPS semnificativ pe 1650, diferență vizuală neglijabilă (bloom-ul e blur oricum).
- [x] Re-măsoară FPS la viewport near-1080p maximizat. `LIVING_EARTH_PERF.snapshot()` cu DevTools nedockat, canvas `1909×1076`, fereastră `10.0115 s` / `595` frame-uri: `59.4` FPS mediu, `59.9` FPS median, `49.0` FPS p1 / 1% low, `16.83 ms` frame mediu și `20.4 ms` p99. Sunt depășite țintele §1. Trace-ul steady-state anterior (`9.853 s`) rămâne util pentru profilul CPU: scripting `5.630 s`, paint `81 ms`, render `32 ms`, fără long-frame-uri evidente.

**Definition of Done:** Tranziția zi/noapte arată cinematic. FPS ≥ ținta §1.

---

### Sprint 0.5 — Rezistență & PUBLICARE (7–9 august, 3 zile)

**Livrabil:** deploy public + Service Worker.

**Task-uri:**
- [x] **Service Worker** pentru cache (`sw.js`), ulterior **dezactivat (7 august)** — vezi nota de mai jos:
  - `cache-first` pentru GIBS, cu revalidare LRU la citire.
  - `stale-while-revalidate` pentru NASA EONET și USGS.
  - `network-first` cu fallback pentru shell-ul aplicației.
  - Plafon de `200 MB` pentru GIBS, cu evicție LRU.
  - Cache-uri versionate: `lea-shell-v1`, `lea-live-v1`, `lea-tiles-v1`.
- [x] **Service Worker dezactivat pe producție (7 august).** Pe `luminomorphism.ro` (nu localhost, unde nu apărea), `cacheFirstGibs` rejuca cererea imaginii cu `fetch(request)`, păstrând headerul `Cache-Control: max-age=0` pe care Chrome îl atașează la reload. Asta promova GET-ul CORS simplu al imaginii într-o cerere cu preflight, respinsă de NASA GIBS WMS (`cache-control` nu e în `Access-Control-Allow-Headers`) → suprafața Blue Marble rămânea „loading" și, pe unele browsere, o stare stale a servit un build parțial rupt (glob negru, layout HUD stricat). Prima încercare de fix (fetch curat fără header + bump `lea-tiles-v2`) n-a fost suficient de sigură, așa că SW-ul a fost **scos complet**: `earth-eonet-relief.html` acum **dezregistrează** orice worker existent și șterge cache-urile `lea-*` la load, apoi reîncarcă o dată curat (self-heal pentru orice client cu worker vechi „lipit"). Reintroducerea unui SW rămâne posibilă în Faza 1, dar cu request curat pentru cross-origin de la început. Aplicația funcționează identic fără SW (offline-ul pică, dar suprafața are fallback bundled).
- [x] Test offline real: reîncărcare în Chrome DevTools `Offline` confirmată la 2026-07-26. Globul, KTX2 și NASA GIBS Black Marble au răspuns `200` prin Service Worker; `favicon.ico` necache-uit a răspuns `503`, fără impact asupra aplicației. UI confirmat explicit: `Data source: NASA EONET default - 123 NASA events — cached / stale`. **⚠️ Caduc din 7 august:** odată cu dezactivarea Service Worker-ului (vezi mai jos), offline-ul nu mai funcționează pe producție. De reactivat împreună cu un SW corectat în Faza 1.
- [x] Verifică atribuirile: NASA/GIBS (Daily Clouds și VIIRS Black Marble), NASA EONET, USGS, NOAA SWPC și NOAA/ETOPO sunt vizibile în panoul `Data Sources` și consecvente cu README.
- [ ] Actualizează README cu screenshot-urile noi. Documentația tehnică este actualizată (KTX2, Black Marble, Service Worker, offline/cache și Spector); capturile publicabile rămân de selectat și adăugat în repository. **Amânat deliberat (12 august)** — nu blochează continuarea.
- [ ] **Deploy pe GitHub Pages.** **Decizie (12 august): nu se face deocamdată.** `luminomorphism.ro` rămâne singurul deploy public; oglinda pe Pages e opțională și trece în backlog.
- [x] Scrie postarea de LinkedIn (stilul tău obișnuit: ce e real fizic, ce e măsurat, ce e interpretativ). — **Publicată.**

---

### 🚪 GATE 0 — condiție obligatorie de trecere

**NU treci la Faza 1 până toate acestea nu sunt adevărate:**

- [x] Site-ul e **live public** și un străin îl poate deschide — luminomorphism.ro (cPanel), nu GitHub Pages cum prevedea inițial acest document; de decis dacă rămâne așa sau se adaugă și o oglindă pe Pages.
- [x] VRAM ≤ 2.8 GB pe GTX 1650 — 168 MB texturi relief/normal (KTX2) + ~179 MB suprafață Blue Marble 8192×4096 nou adăugată; total estimat ≈ 335–350 MB, cu marjă mare. De confirmat cu Spector la următoarea sesiune de măsurare.
- [x] FPS median ≥ 50 la 1080p cu toate straturile active — 59.9 median / 49.0 p1 (Sprint 0.4, 2026-07-26); de remăsurat după adăugarea suprafeței Blue Marble, deși e doar o textură în plus, nu geometrie nouă.
- [x] Suprafața la zoom regional arată detaliu satelit, nu blur — rezolvat 6 august prin suprafață NASA GIBS Blue Marble 8192×4096 (vezi Sprint 0.3 mai sus), nu prin LOD dinamic.
- [x] Postarea publică e făcută (LinkedIn sau echivalent).
- [x] `docs/perf-baseline-2026-07.md` conține numere înainte/după.

**Gate 0 — decizie (12 august):** singurele două puncte rămase roșii (README screenshots, oglindă GitHub Pages) sunt amânate deliberat, nu uitate. Cu asta, Gate 0 e considerat **suficient de verde pentru a trece la Faza 1** — toate criteriile de fond (performanță, VRAM, calitate vizuală, deploy public, postare, baseline) sunt bifate.

**Dacă gate-ul e roșu:** nu adaugi funcționalități. Repari ce e roșu. Punct.

---

## 3. FAZA 1 — CONSOLIDARE (10 august – 6 septembrie, 4 săptămâni)

**Obiectiv:** transformă proiectul din „demo impresionant" în „platformă pe care poți construi fără durere".

**Precondiție:** Gate 0 verde.

### Sprint 1.1 — Registry de layer plugins (5 zile)

**Problema:** fiecare sursă e cablată manual în `live-data-layers.js`. Adăugarea uneia noi atinge mai multe fișiere.

**Soluția — interfață unică:**
```ts
interface LayerPlugin {
  id: string;
  label: string;
  provenance: 'observed' | 'physical' | 'interpretive' | 'fallback';
  source: { url: string; cors: boolean; requiresProxy: boolean; apiKey?: string };
  cadence: number;              // ms între refresh-uri
  fetch(signal: AbortSignal): Promise<RawPayload>;
  normalize(raw: RawPayload): NormalizedEvents | TextureSource;
  render: 'markers' | 'points' | 'texture' | 'vector';
  attribution: string;          // obligatoriu, non-null
  license: string;
}
```
- [x] Definește interfața + registry (`register(plugin)`).
- [x] Leagă `provenance`, attribution și license de observatory contract-ul existent, fără duplicare.
- [x] **Test:** Smithsonian GVP este adăugat printr-un singur fișier nou + o linie de înregistrare.
- [x] **Decizie:** USGS, EONET, FIRMS, GDACS, NOAA SWPC și CelesTrak nu sunt migrate în registry; sunt provideri de evenimente și rămân în contractul unificat `feed-adapter` / `data-broker`.

### Sprint 1.1 — ÎNCHIS: registry pentru layere, nu pentru provideri de evenimente (10 august)

**Decizie de arhitectură:** registry-ul `LayerPlugin` este pentru layere vizuale independente, cu ciclu propriu de randare și atribuire (de exemplu GVP și Aurora). Providerii de evenimente — EONET, USGS, FIRMS, GDACS și CelesTrak — rămân intenționat în abstracția unificată `feed-adapter` / `data-broker`. Mutarea lor în registry ar dubla contractele de fetch, cache, status și normalizare și ar fi un regres.

- [x] Interfață + registry implementate în `src/earth/layer-plugin-registry.js` (`register(plugin)`).
- [x] `provenance`, attribution și license sunt declarate de plugin și afișate în UI.
- [x] Contractul „un fișier + o înregistrare” este validat cu `src/earth/layers/gvp-volcanoes.js`; Aurora este al doilea exemplu de layer self-managed.
- [x] Providerii de evenimente sunt excluși explicit din registry și rămân în `src/core/feed-adapter.js` / `src/core/data-broker.js`.

### Sprint 1.2 — Teste automate (3 zile) — ÎNCHIS (12 august)

**Prioritate #1: transformările de coordonate.** Bug-ul `[lat,lon]` vs `[lon,lat]` din v2.4.2 e o clasă de eroare care revine garantat.

- [x] Vitest + fixtures GeoJSON reale (`tests/fixtures/{eonet-sample.json,usgs-sample.geojson,gvp-volcanoes.geojson}`). `tools/verify-earth-contracts.mjs` a fost retras — logica lui a fost migrată integral în suita Vitest, ca să nu existe două seturi de assert-uri paralele.
- [x] Teste unitare: `lonLatToVec3` / `vec3ToLonLat` (`tests/geo.test.js`), round-trip la poli și antimeridian (±180°), plus respingerea vectorului zero.
- [x] Teste tile math: `tileGridDimensions` / `tileLatLonBounds` la z=0 și z=2 (`tests/gibs-tiles.test.js`), plus contractul URL WMTS/WMS și `LruTileCache`/`GibsTileQueue`.
- [x] Smoke test per adapter: fixture → `normalize()` → shape validat, pentru EONET (`tests/event-utils.test.js` — acoperă explicit swap-ul `[lat,lon]`→`[lon,lat]` pe inelele Polygon), USGS (`tests/usgs-earthquakes.test.js`, cu `featureToEvent` extras ca funcție pură testabilă din `src/earth/usgs-earthquakes.js`) și GVP (`tests/gvp-volcanoes.test.js`).
- [x] CI pe GitHub Actions — `.github/workflows/ci.yml`, rulează `npm ci && npm test` la push/PR pe `main`.

**Bonus găsit în timpul scrierii testelor:** `featureToEvent` (USGS) trata o magnitudine lipsă (`props.mag == null`) ca `Number(null) → 0`, adică un cutremur M0 valid în loc de a fi respins. Nu se manifesta în producție (default `minMagnitude = 2.5` îl filtra oricum), dar era o gaură reală de validare — reparată direct.

**Notă de fundație (P1 din roadmap-ul de platformă v4):** acesta e primul `package.json` din repo. S-a adăugat doar `vitest` ca dev-dependency, fără build tool (Vite) — acela rămâne un pas separat, neasumat aici.

### Sprint 1.3 — Performanță markere (4 zile) — parțial închis (12 august)

- [x] `InstancedMesh` pentru markerele EONET, cu atribute per-instanță (culoare, scală). Calea exista deja în `src/earth/marker-system.js` din spatele unui flag `useInstancedMarkers = false`, nefolosită. Activată acum, cu un bug reparat: `InstancedMesh` era alocat cu `state.clusters.length` sloturi, dar `isBackgroundUsgsCluster()` sare unele clustere (`continue`), deci mai puține instanțe primeau `setMatrixAt()` decât sloturi alocate — sloturile nescrise păstrau matricea identitate implicită și randau un marker fantomă la centrul globului. Fix: `.count` setat explicit la numărul real de instanțe scrise. Verificat live: 127 evenimente EONET randate fără erori de consolă, confirmat vizual de Tutu (fără marker fantomă, picking funcțional).
- [x] Clustering la depărtare — deja implementat (`buildClusters`), nu era specific la Sprint 1.3 dar era condiționat de calea instanced fiind pornită.
- [~] GPU picking — **decizie:** nu s-a implementat varianta cu render pass separat + `readRenderTargetPixels`. Picking-ul existent prin raycasting CPU pe `InstancedMesh` (`hit.instanceId` → `userData.instances[hit.instanceId]`, deja în `scene-interaction.js`) acoperă contractul funcțional (selecție corectă pe instanțe) fără complexitatea suplimentară a unui render pass de culori. De revizitat doar dacă raycasting-ul devine măsurabil de lent cu mii de puncte.
- [ ] Re-măsoară draw calls. Țintă ≤ 80. Nefăcut — necesită Spector.js/DevTools pe o sesiune de browser reală, nu disponibil din acest mediu de lucru.

### Sprint 1.4 — Timeline scrubbing global (5 zile) ⭐ diferențiator — tăiat la scop (12 august)

**De ce e valoros:** GIBS e time-enabled. Ai deja infrastructura de reel timeline. Combinația = poți trage de un slider și vezi norii, aerosolii, incendiile din orice zi din ultimii ~25 de ani.

**Regulă de tăiere aplicată:** la verificare, straturile GIBS temporale nu sunt de fapt disponibile de scrubat acum — `DAILY_CLOUDS_ENABLED = false` în `cloud-system.js` (norii zilnici sunt opriți din Sprint 0.3, în așteptarea validării), iar Black Marble e fixat la anii 2012/2016 (compozit anual, nu zilnic). Construirea propagării complete către GIBS ar fi scrubat o funcționalitate care nu există încă live. În schimb, s-a livrat sincer doar partea care e reală acum:

- [x] Slider global de timp (UTC), cu preset-uri (Live / -7z / -30z / -1an). `src/earth/time-scrub-panel.js`, panou nou `#timeScrubPanel` în `earth-eonet-relief.html`.
- [x] Debounce pe scrub (180ms) — eticheta se actualizează imediat la tragere, dar `timeState.setHistoricalTime()` (care recalculează astronomia) e debounced.
- [x] Legat de infrastructura deja existentă `createEarthTimeState()` (`src/earth/earth-time-state.js`), care conducea deja poziția Soarelui/Lunii reactiv, dar nu avea UI. Verificat live: preset `-30d` a mutat latitudinea subsolară de la 15.0°N la 21.8°N, coerent cu poziția reală a Soarelui cu o lună mai devreme; `Live` a restaurat corect.
- [ ] Propagare a datei către plugin-urile GIBS temporale — **netăcut, tăiat conform regulii de mai sus**: nu există încă un strat GIBS temporal activ de propagat către el. Revizitat quando `DAILY_CLOUDS_ENABLED` devine `true`.
- [ ] Prefetch al zilelor adiacente — irelevant fără straturi temporale active.
- [ ] Indicator onest de disponibilitate per sursă — parțial acoperit: panoul declară explicit în UI că „Astronomy only for now — GIBS imagery layers do not respond to this yet", deci nu există interpolare tăcută sau pretenție falsă.

### Sprint 1.5 — Suprafață sezonieră & ocean (5 zile) — ÎNCHIS (12 august)

- [ ] Blue Marble seasonal albedo (12 luni) cu interpolare între luni după data reală din timeline. **Tăiat — cercetat direct în GetCapabilities-ul WMS GIBS: niciunul din cele 3 layere Blue Marble (`BlueMarble_NextGeneration`, `BlueMarble_ShadedRelief`, `BlueMarble_ShadedRelief_Bathymetry`) nu are `Dimension name="time"`, și nu există variante lunare separate.** Compozitele lunare NASA Blue Marble Next Generation există doar ca imagini statice pe Visible Earth, nu ca strat WMS/WMTS servit prin GIBS cu parametru `TIME`. Ar necesita un pipeline separat de descărcare/asset, în afara scopului acestui sprint.
- [x] Mască de zăpadă/gheață: GIBS `MODIS_Terra_NDSI_Snow_Cover` (confirmat temporal, zilnic, 2000-02-24 → azi). Implementat ca layer `custom` în registry (`src/earth/gibs-snow-ice.js` + `src/earth/layers/snow-ice.js`), înregistrat cu contractul „1 fișier + 1 linie" deja validat la Sprint 1.1. Verificat direct cu `curl`: URL WMS răspunde `200`, PNG valid 2048×1024 RGBA, CORS OK; timeout-ul din browser-ul de test a fost flakiness de rețea a mediului sandbox (același gen de eșec ca la Black Marble/Blue Marble în acea sesiune), nu o eroare de cod.
- [x] Batimetrie: rampă hipsometrică pe adâncime, direct din textura ETOPO deja încărcată (`earthRelief`, folosită și ca displacement/bump) — fără sursă nouă de date. Sub nivelul mării, culoarea oceanului trece de la turcoaz la țărm spre bleumarin aproape negru la adâncime. Aplicat pe ambele materiale (Phong + PBR), verificat live fără erori de shader pe niciuna din cele două căi.
- [x] Sun glint pe ocean — **deja exista** (Fresnel Schlick F₀≈0.02 + boost la terminator, `earth-material.js`, calea Phong); verificat, nu a fost nevoie de cod nou. Shading pe pantă din normal map — deja acoperit structural: `earthReliefNormal` e deja `normalMap` activ pe ambele materiale, iluminarea răspunde deja la pantă.

### 🚪 GATE 1 — stare la 12 august (Faza 1 completă ca sprint-uri, gate-ul nu e încă verde)

**Decizie (12 august):** Gate 1 rămâne acceptat parțial (deschis) — se trece la Faza 2 fără cele 4 puncte de mai jos bifate. Revizitat la o sesiune ulterioară, nu abandonat. Motivul: sprint-urile de conținut (1.1–1.5) sunt toate închise; ce rămâne (CI real pe push, măsurători de performanță, deploy) sunt verificări de infrastructură care nu blochează dezvoltarea următoarelor funcționalități din Faza 2.

- [x] Adăugarea unei surse noi = 1 fișier + 1 linie, verificat cu un exemplu real — validat de două ori: GVP (Sprint 1.1) și Snow & ice (Sprint 1.5).
- [~] Suita de teste verde în CI — **stare 13 nov. 2026:** `npm run verify:f0` (sintaxă + importuri + 201 teste + registry) iese cu 0 local; `ci.yml` rula doar pe `main` și la PR, deci `dev/post-hackathon` nu avea nicio rulare pe GitHub Actions (verificat prin API). Commit `2cdd203` adaugă `dev/**` la triggere (Node 22, ca pe server); devine `[x]` după prima rulare verde pe branch.
- [ ] Timeline scrubbing funcțional pe ≥3 straturi temporale — **netrecut, onest** (stare 13 nov. 2026: slider-ul mută doar Soarele, Luna și ISS — `src/earth/app-visual-foundation.js:56-59`; niciun strat de date nu e legat de dată). Sprint 1.4 a livrat scrubbing doar pentru astronomie (Soare/Lună), tăiat deliberat față de straturile de date GIBS (nori opriți, night lights fix pe ani). Ar necesita reactivarea norilor zilnici + propagarea datei către minim 2 straturi temporale reale (acum există doar Snow & ice ca strat temporal nou, neconectat încă la slider).
- [~] Draw calls ≤ 80, FPS ≥ 45 — **măsurat 13 nov. 2026, dar nu în condițiile complete ale metricii:** pe producție, 59,9 FPS median (vsync) într-un panou mic, nu în fereastră maximizată; local, Chrome headless 1920×1080 pe GTX 1650, straturi implicite: 41 draw calls/cadru, 59,9 FPS median (p1 59,2), GPU 4,3 ms/cadru. Rămâne de confirmat într-o fereastră maximizată cu toate straturile pornite.
- [x] **Deploy public actualizat** — 13 nov. 2026: `luminomorphism.ro` servește LOT 4b (`src/earth/relief-linear.js` cu `RELIEF_SHADING_GAIN = 30`, `assets/etopo2022-surface-m-2160x1080.ktx2` → 200, dale WMTS cu timeout pe timp vizibil); asset-urile vechi de relief → 404.

---

## 4. FAZA 2 — LIVING (7 septembrie – 1 noiembrie, 8 săptămâni)

**Obiectiv:** planeta devine dinamică — mișcare derivată din date, nu din animație decorativă.

**Precondiție:** Gate 1 verde. Dacă Faza 1 a depășit termenul, Faza 2 se taie la jumătate.

**Aici — și abia aici — WebGPU are justificare reală.** Nu ca scop în sine, ci pentru că simulările de câmp vectorial (vânt, curenți) sunt exact ce fac compute shaders bine.

### Sprint 2.1 — Ramura WebGPU/TSL (7 zile) — tăiat la scop, evaluare de cost înainte de cod (12 august)

**Precondiție rezolvată întâi (12 august):** upgrade Three.js `r0.160.0 → r0.185.1`, ca pas izolat, separat de orice migrare de renderer — conform regulii proprii a roadmap-ului v4 („nu se combină upgrade-ul Three.js cu migrarea PBR/renderer"). r160 precede maturizarea reală TSL/WebGPURenderer; r185 e linia stabilă curentă. Risc verificat explicit înainte de upgrade (aplicația se bazează masiv pe injecție de shader via `onBeforeCompile`, care eșuează silențios dacă un anchor `#include <chunk>` își schimbă numele — fără eroare, doar efectul lipsește): toate cele 5 anchor-uri folosite în `src/` (`common`, `map_fragment`, `worldpos_vertex`, `normal_fragment_maps`, `specularmap_fragment`) confirmate neschimbate între r160 și r185; toate cele 7 căi de addon-uri confirmate valide; niciun API cunoscut ca eliminat (`sRGBEncoding`, `THREE.Math.*` etc.) nu era folosit. Verificat live pe `earth-eonet-relief.html` și `living-protein.html`: zero erori noi de consolă, doar un warning de deprecare (`THREE.Clock` → `THREE.Timer`, neblocant). Comutare PBR/Phong, time-scrub și layer registry retestate funcționale.

- [x] Branch separat `webgpu-tsl` — creat din `dev/post-hackathon`, gol (fără commit-uri), rezervat pentru când se reia acest fir.
- [ ] Migrare de bază: `WebGLRenderer` → `WebGPURenderer` din `three/webgpu`. **Regulă de tăiere aplicată (12 august), înainte de a scrie cod, pe baza cercetării directe în sursa Three.js r185.1** — nu s-a construit efectiv migrarea. Constatări concrete:
  - `WebGPURenderer` are fallback automat la WebGL2 (`forceWebGL`/auto-detect) — cerința de mai jos ar fi fost satisfăcută gratuit.
  - Inițializarea devine **asincronă** (`await renderer.init()`), ceea ce ar cere refactorizarea fluxului de boot (`app-startup.js`/`app-lifecycle.js`) din sincron în asincron.
  - **`EffectComposer`/`UnrealBloomPass`/`SMAAPass`/`OutputPass`** (pipeline-ul de post-procesare curent, `scene-runtime.js`) sunt specifice `WebGLRenderer`; `WebGPURenderer` folosește `THREE.PostProcessing` + noduri TSL, un sistem diferit.
  - **`onBeforeCompile`** — mecanismul pe care se bazează *tot* look-ul custom (tenta zi/noapte, batimetria din Sprint 1.5, glint-ul oceanic, atmosfera, norii, night lights, portal shaders din `src/gateway/`) — **nu e suportat** de sistemul de materiale pe noduri al `WebGPURenderer`. Fiecare shader ar trebui rescris ca graf TSL.
  - Concluzie: costul e mare (boot asincron + pipeline de post-procesare rescris + fiecare shader custom portat) și beneficiul nu e demonstrat încă. Sprint-urile 2.2/2.3 (particule) nu au nevoie de renderer-ul complet WebGPU — WebGL2 (FBO ping-pong/transform feedback) oferă același rezultat funcțional, exact varianta pe care regula de tăiere de mai jos o prevedea deja ca alternativă.
- [ ] **Fallback automat obligatoriu la WebGL2** — irelevant, migrarea nu s-a făcut.
- [ ] Portează shaderele custom (atmosferă, ocean, terminator) la TSL, pe rând. Nu toate deodată. — netăiat definitiv, doar amânat: reluat dacă/când apare un motiv concret (nu doar „WebGPU e nou").
- [x] Benchmark comparativ WebGL2 vs WebGPU — **înlocuit cu o evaluare de cost înainte de implementare**, cu aceeași concluzie pe care benchmark-ul ar fi trebuit s-o testeze: se oprește migrarea aici, WebGPU rămâne doar o opțiune pentru compute, dacă va fi nevoie explicit în 2.2/2.3.

### Sprint 2.2 — Particule de vânt (10 zile) ⭐ cel mai spectaculos — închis (12 august)

Tehnica canonică (Cameron Beccario / earth.nullschool.net, baza pentru Windy, Ventusky, Wind-JS):

- [x] Sursă de date: Open-Meteo (CORS nativ, fără cheie). **Verificat înainte de a scrie cod:** API-ul e per-locație, dar suportă batch prin liste separate prin virgulă de lat/lon în același request — testat direct cu `curl`, grilă globală de 612 puncte (10°), răspuns `200` sub o secundă. Se folosesc `wind_speed_10m`/`wind_direction_10m` (convenție meteorologică „dinspre"), convertite în componente u/v.
- [x] Encodează câmpul vectorial într-o textură (u în R, v în G, normalizate la un plafon fix de 40 m/s). `src/earth/wind-field-provider.js`.
- [x] Ping-pong pe texturi de poziții (lon/lat/age) — `GPUComputationRenderer` (`three/addons/misc`), 16384 particule (128×128, redus de la 256×256 după ce testarea vizuală a arătat că e suficient cu trail-uri). Respawn stocastic cu distribuție uniformă **pe sferă** (`asin`), nu uniformă în latitudine (care ar aglomera la poli).
- [x] Render cu **trail persistent** (streamlines) — **făcut, nu tăiat.** Bufferul de trail e o textură **echirectangulară (lon/lat)** mapată pe sferă, nu spațiu-ecran: pe un glob rotativ, un buffer spațiu-ecran ar lăsa smear la rotație; cel echirectangular se lipește de geografie și se rotește cu globul. Fiecare cadru: fade(bufferul precedent) + capetele proaspete ale particulelor (aditiv), ping-pong. Afișat pe o sferă la radius 2.05 cu NormalBlending (aditiv peste ziua luminoasă + bloom spăla dârele spre alb).
- [x] Pe WebGL2: FBO ping-pong (conform tăierii Sprint 2.1 — fără WebGPU compute).
- [x] Proiecție corectă pe sferă, cu atenție explicită la poli: divizarea longitudinii prin `cos(lat)` e limitată (`max(...,4000.0)`) ca să nu explodeze aproape de ±90°; latitudinea e clampată la ±89°.
- [x] Buget: 16384 particule (128×128). Cu trail-uri, mai puține particule dau un rezultat vizual mai curat decât 65k puncte fără trail.
- [x] **Rezistență la rate-limit:** Open-Meteo limitează cererile pe minut (HTTP 429). Câmpul de vânt e cache-uit în `sessionStorage` (TTL 15 min, ~2.4KB); reload-urile refolosesc cache-ul, iar la 429 se cade pe cache chiar expirat. `src/earth/wind-field-provider.js`.

**Verificat vizual live (confirmat de Tutu):** dârele curg corect, urmăresc curenții de aer (vârtejuri, linii de flux peste oceane și continente) — efectul streamline de tip nullschool. Parametrii de reglaj fin (`TRAIL_FADE`, `uSpeedScale`, `uPointSize`, opacitatea afișajului) sunt constante sus în `wind-particles.js`.

**Lecție de proces (documentată):** verificările „fără erori de consolă" pe cod servit din cache au dat mai multe false-pozitive în această fază (Sprint 1.3/1.5/2.2). Cauza: serverul de dev de pe portul 8765 servea JS cu cache HTTP, iar sistemul de cache-busting `?v=` cere urcarea tag-ului prin **tot lanțul de import** până la HTML la fiecare editare. Rezolvat prin rularea serverului cu `-c-1` (no-cache). Pentru orice schimbare vizuală: bump `?v=` complet + confirmare vizuală de la Tutu, nu doar absența erorilor.

### Sprint 2.3 — Curenți oceanici (7 zile) — închis (13 august)

- [x] Același pipeline de advecție — **refactorizat într-un motor generic** `src/earth/field-particles.js` (advecție GPU + trail-uri echirectangulare, parametrizat cu provider de date, paletă, speedScale, `landAware`). `wind-particles.js` și noul `ocean-currents.js` sunt acum wrappere subțiri peste el.
- [x] **Sursă: Open-Meteo Marine, NU Copernicus.** Roadmap-ul prevedea Copernicus Marine (cont + cheie secretă + proxy) — blocaj real, nu pot crea cont. Open-Meteo Marine (`ocean_current_velocity`/`ocean_current_direction`) oferă același semnal keyless, CORS-friendly, batch-abil (verificat cu `curl`: `200`, iar peste uscat întoarce `null` — mască de uscat gratuită). **Copernicus + proxy-ul tăiate.** `src/earth/ocean-current-provider.js`, cu conversie km/h→m/s, cache sessionStorage + fallback 429.
- [x] Mască de uscat — encodată în canalul B (curent `null` = uscat = 0); calea `landAware` din compute forțează respawn peste uscat, deci curenții nu traversează continentele. **Notă:** grila e 10° (612 puncte, ca la vânt), deci masca e blocată la coaste — de rafinat la 5° dacă e nevoie.
- [x] Paletă distinctă — teal-verde (vs. albastru-rece la vânt), radius de afișare ușor mai mic ca ambele straturi să poată fi active simultan. (SST/temperatura curentului nefolosite — Open-Meteo Marine nu le dă în acest endpoint.)

**Verificat live (port 8770, `-c-1`):** ambele straturi activate simultan, oceanul aduce date reale Marine (612 puncte, cache-uit), vântul funcționează după refactor, `gl.getError()==0`, zero erori de consolă. **De confirmat vizual de Tutu:** densitatea dârelor și claritatea măștii de uscat la grila grosieră de 10°.

### Sprint 2.4 — Detaliu de suprafață la zoom mare (6 zile)

- [ ] Parallax occlusion mapping pe relief, activat doar sub un prag de distanță.
- [ ] Detail noise blending modulat de land cover (ESA WorldCover, 10m, 11 clase, CC BY 4.0) — sparge aspectul de texel întins când GIBS rămâne fără rezoluție.
- [ ] **Etichetează noise-ul ca `interpretive` în observatory contract.** E singurul mod în care e compatibil cu filozofia ta — nu pretinzi că e observat.

### 🚪 GATE 2

*Stare 13 nov. 2026 (măsurători în `tmp/registry-himalaya/gate-measure.json`, Chrome headless 1920×1080, GTX 1650, vsync):*

- [x] Particulele de vânt rulează la ≥45 FPS pe GTX 1650 — 16 384 particule (Open-Meteo, 612 puncte): 59,9 FPS median, p1 59,2, cadru p95 16,8 ms; 42 draw calls/cadru.
- [x] **Aplicația rulează exclusiv pe WebGL2; migrarea WebGPU a fost tăiată în Sprint 2.1** (vezi mai sus) — criteriul inițial („fallback WebGL2 cu WebGPU dezactivat”) nu mai are obiect.
- [ ] Zero regresie de VRAM (≤ 3.2 GB) — nemăsurat: cere `chrome://gpu` / Task Manager într-o fereastră reală (`renderer.info`: 30 texturi, 18 geometrii, 25 programe; texturile mari: suprafață 4096×2048, Black Marble 2560×1280, relief R16F 2160×1080, mască R8).
- [~] **Deploy public actualizat + reel video** — deploy făcut (vezi Gate 1); reel-ul video nu e produs/publicat.

---

## 5. FAZA 3 — CINEMATIC (opțional, doar dacă Gate 2 e verde și mai vrei)

Aici e teritoriu de R&D pur. **Nimic din faza asta nu e necesar pentru un proiect excelent.** Tratează-o ca pe recompensă, nu ca pe obligație.

| Item | Efort | Note |
|---|---|---|
| Cer Hosek-Wilkie | mediu | Superior lui Preetham pentru turbiditate variabilă. Există implementări GLSL de referință. |
| Aerosoli Sentinel-5P modulând Mie | mediu | AER_AI via GIBS WMTS (fără cheie). Densitatea Mie devine dependentă de date reale — foarte aliniat cu filozofia. |
| Nori volumetrici | mare | Raymarching scump pe 4GB. **Alternativă ieftină:** 2 straturi 2D la altitudini diferite cu parallax + self-shadowing fake. Fă alternativa întâi. |
| Export determinist / perfect loop | mediu | Seed fix pentru orice noise + cameră pe buclă închisă + timestep fix (nu delta real). Ai deja muxer MP4 propriu de la Möbius — refolosește-l. |
| Split-screen compare | mediu | Night lights 2012 vs 2024, forest loss. Împrumută UX de la Global Forest Watch / zoom.earth. |
| BRDF vegetație cu hotspot | mediu | Backscatter modulat de WorldCover. |

---

## 6. SURSE DE DATE — ORDINE DE INTEGRARE

Ordonate după raportul valoare/fricțiune. **Integrează de sus în jos.** Tot ce e „direct" nu-ți atinge proxy-ul deloc.

| # | Sursă | Acces | Cheie | Fază |
|---|---|---|---|---|
| 1 | NASA GIBS (imagery, night, snow, aerosoli) | direct ✅ | nu | 0 |
| 2 | USGS Earthquakes | direct ✅ | nu | ✔ ai |
| 3 | NASA EONET | direct ✅ | nu | ✔ ai |
| 4 | NOAA SWPC (aurora, space weather) | direct ✅ | nu | ✔ ai |
| 5 | CelesTrak (TLE) | direct ✅ | nu | ✔ ai |
| 6 | Smithsonian GVP (vulcani) | direct ✅ | nu | 1 |
| 7 | Open-Meteo (vânt, forecast) | direct ✅ | nu | 2 |
| 8 | GBIF (biodiversitate, tile-uri) | direct ✅ | nu | 1 |
| 9 | IRIS/EarthScope (seismic) | direct ✅ | nu | 1 |
| 10 | GEBCO batimetrie (WMS) | direct ✅ | nu | 1 |
| 11 | ESA WorldCover (WMS Terrascope) | direct ✅ | nu | 2 |
| 12 | Global Forest Watch (tiles) | direct ✅ | nu | 3 |
| 13 | Natural Earth (vectori) | static ✅ | nu | oricând |
| 14 | FIRMS (incendii) | proxy ⚠️ | da | ✔ ai |
| 15 | GDACS | proxy ⚠️ | nu | ✔ ai |
| 16 | OpenAQ (calitate aer) | proxy ⚠️ | da | 1 |
| 17 | Copernicus Marine (curenți) | proxy ⚠️ | da | 2 |
| 18 | AISStream.io (naval) | proxy ⚠️ | da | 3 |
| 19 | OpenSky (aerian) | proxy ⚠️ | OAuth | 3 |
| 20 | Copernicus CDS ERA5 | server-only ⚠️ | da | 3 |
| 21 | AWS Terrain Tiles (Terrarium, DEM ~30 m) | direct ✅ | nu | Himalaya ❄️ |
| 22 | Sentinel-2 L2A prin Earth Search STAC (COG) | direct, CORS de verificat | nu | Himalaya ❄️ |
| 23 | Open-Meteo pe niveluri de presiune (500/400/300 hPa) | direct ✅ | nu | Himalaya ❄️ |
| 24 | Garmin MapShare (feed KML, doar listă albă) | proxy ⚠️ | nu | Himalaya ❄️ |

**Notă proxy — GDACS & FIRMS pe producție (reparat 7 august):** ambele surse cu `proxy ⚠️` treceau prin proxy-ul Node (`nasa-proxy-server.js`), dar în producție erau rupte din două cauze suprapuse. (1) Un deploy anterior de HTML scosese accidental `window.NASA_PROXY_BASE`, deci runtime-ul public (`isStaticPublicRuntime`) marca sursele „proxy-disabled" și golea lista — fără să încerce măcar proxy-ul. (2) Subdomeniul `proxy.luminomorphism.ro` întorcea 404 de la host: DocumentRoot-ul lui e `/home/luminomorphism/nasa-proxy` cu un `.htaccess` **gol**, iar configul Passenger real (cu `PassengerBaseURI "/nasaproxy"`) stă orfan în `public_html/nasaproxy/.htaccess`. Adică aplicația Node rulează și răspunde de fapt la **`https://luminomorphism.ro/nasaproxy/nasa-proxy?source=...`**, nu pe subdomeniu. Fix aplicat: `NASA_PROXY_BASE = 'https://luminomorphism.ro/nasaproxy'` (same-origin cu site-ul → zero CORS). Verificat live: GDACS `proxyStatus:"live"` ~99 alerte, FIRMS `proxyStatus:"live"` ~1112 focare (cheia `FIRMS_MAP_KEY` e setată corect server-side). Subdomeniul `proxy.luminomorphism.ro` rămâne rupt dar nefolosit; reparat opțional în Faza 1 mutând configul Passenger în docroot-ul lui.

**Reguli de licențiere (non-negociabile, și oricum aliniate cu etica ta):**
- NASA/GIBS: atribuire obligatorie.
- Copernicus DEM: notice specific la distribuire (© DLR e.V. 2010–2014 și © Airbus Defence and Space GmbH 2014–2018).
- Hansen/GFW: citare Hansen et al. 2013, *Science* 342:850–853.
- ESA WorldCover: CC BY 4.0.
- Open-Meteo: CC BY 4.0.
- OpenStreetMap: ODbL + tile usage policy strict (nu abuza de tile.openstreetmap.org).

---

## 7. BACKLOG ÎNGHEȚAT ❄️

**Orice idee nouă merge aici, nu în faza curentă.** Revizuiești lista doar la gate-uri.

- Virtual texturing / sparse virtual textures propriu → **NU.** Complexitate notorie; determinarea tile-urilor vizibile pe sferă 3D e problema grea nerezolvată în multe încercări. Tile streaming XYZ îți dă ~90% din beneficiu.
- Clipmaps sferice (Clasen & Hege) → doar dacă vrei teren displaced la scară de metri. Probabil out of scope.
- Un al treilea observator / integrare cross-observatory → după Gate 2. **Candidatul concret este Living Himalaya (detaliat mai jos).**
- **Living Himalaya Observatory V0** (adăugat 11 noiembrie 2026) → **înghețat până după Gate 2**, conform regulii de mai sus.
  - Ce este: observator regional separat (nu strat pe glob), teren 3D Khumbu la ~30 m, expediții din feed-uri Garmin MapShare publicate de echipe. Click pe marker → zbor la ~1,2 km deasupra punctului → cea mai recentă imagine Sentinel-2 clară, cu data ei; vânt de model la altitudinea GPS.
  - Specificație completă: [Living Himalaya Observatory — Specificație V0](https://claude.ai/artifact/YYrJd5hwNx5Ge25hi6xSyu) (surse, arhitectură, interacțiune, etică, 4 sprint-uri ~19 zile, Gate H0).
  - Precondiții de dezghețare (stare 13 nov. 2026): Gate 2 verde — **nu încă**; LOT 2 (proxy unificat) — **închis** (`7bb6c15`, `1f23100`, `ec879f8`, `1123791`); LOT 3 (proveniență în vocabularul canonic din AGENTS.md: `prediction` afișat ca „Model prediction”, raportarea GDACS ca notă de proveniență) — **închis** (`a6d7cd1`); cele 5 verificări din spec (CORS Earth Search/COG, termeni Garmin, licențe, calitate SRTM vs Copernicus GLO-30, un feed MapShare real cu acord) — **neîncepute**.
  - În registru: înregistrare `planned`, fără rută, scara `regional` (`c879480`) — nu e prezentată ca observator lansat.
  - Pe glob, Living Earth primește doar un marker „expediție activă” care deschide observatorul; terenul detaliat nu intră în Living Earth.
  - Regulă de etică non-negociabilă: doar expediții din listă albă, fără nume de persoane, fără extrapolarea poziției, banner „nu este serviciu de salvare”.
- Migrare completă la WebGPU pe `main` → doar dacă benchmark-ul din 2.1 arată >10% câștig.
- Refactor al entry point-ului HTML monolit → Faza 1 dacă devine dureros, altfel îngheață.
- Terrain displacement real (vertex) → Faza 3+.
- Editor de tur / storytelling avansat → după Gate 2.
- Suport multi-limbă UI → după ce ai utilizatori.

---

## 8. REGULI DE TĂIERE (pre-scrise, ca să nu negociezi cu tine sub presiune)

Când o fază depășește durata alocată, tai în ordinea asta:

1. **Taie polish-ul vizual** înainte de funcționalitate (cross-fade LOD, easing camera).
2. **Taie generalitatea** înainte de a tăia livrarea (hardcodează în loc să abstractizezi).
3. **Taie LOD dinamic** → un nivel fix de tile-uri e tot un salt uriaș.
4. **Taie sursele de date opționale** (GVP, GBIF, OpenAQ) — nu sunt critice.
5. **NU tăia niciodată:** atribuirile, fallback-ul onest, etichetele de provenance. Alea sunt identitatea proiectului.

---

## 9. REGISTRU DE RISCURI

| Risc | Probabilitate | Impact | Mitigare |
|---|---|---|---|
| Scope creep (tiparul documentat) | **mare** | **mare** | Gate-uri + Backlog Înghețat + testul săptămânal |
| Bug de ordine coordonate (z/y/x, lat/lon) | mare | mediu | Teste unitare Sprint 1.2 — dar scrie-le devreme dacă apare în 0.3 |
| VRAM depășit pe 1650 | mediu | mare | Monitorizare la fiecare sprint; plafon LRU pe cache tile-uri |
| GIBS schimbă identificatori de layer | mic | mediu | Fallback la textura statică; verifică GetCapabilities trimestrial |
| Rate limit / CORS se schimbă la o sursă | mediu | mic | Ai deja fallback resilience; extinde-l per plugin |
| WebGPU nu aduce câștig real | mediu | mic | Benchmark-gate în 2.1 — oprești migrarea, nu continui din inerție |
| Normal maps degradate de ETC1S | mare | mediu | UASTC + `--normal_mode` (specificat în 0.2) |
| Burnout pe proiect solo | mediu | mare | Faza 3 e explicit opțională; publicarea la fiecare gate dă feedback |
| Living Himalaya pornit înainte de Gate 2 (scope creep) | mare | mare | Stă în Backlog Înghețat cu spec scrisă; primul pas la dezghețare sunt cele 5 verificări, nu codul |

---

## 10. RITUAL SĂPTĂMÂNAL (15 minute, vineri)

1. Ce am publicat săptămâna asta pe care un străin îl poate deschide?
2. Metricile din §1 — mai bune sau mai rele decât săptămâna trecută?
3. Ce idee nouă am avut? → **scrie-o în Backlog Înghețat și continuă.**
4. Sunt în grafic pentru gate-ul curent? Dacă nu → aplică Regulile de Tăiere (§8), nu extinde deadline-ul.

---

## 11. CALENDAR SINTETIC

```
IUL 27 ─── AUG 9    FAZA 0: SHIP                    ⭐ 2 săpt → GATE 0 (deploy public)
AUG 10 ─── SEP 6    FAZA 1: CONSOLIDARE                4 săpt → GATE 1 (deploy public)
SEP 7  ─── NOV 1    FAZA 2: LIVING                     8 săpt → GATE 2 (deploy + reel)
NOV 2  ─── ?        FAZA 3: CINEMATIC             opțional, fără deadline
```

**Actualizare 13 noiembrie 2026:** Gate 1 și Gate 2 sunt încă deschise (stare pe criterii în §3 și §4). Loturile de consolidare, în afara planului inițial: LOT 1 (o singură instanță per modul + `verify:f0` verde) — închis, `ca764ac`; LOT 2 (proxy unificat, TTL, H.264 sigur în producție) — închis, `7bb6c15`, `1f23100`, `ec879f8`, `1123791`; LOT 3 (proveniență canonică, timp de date vs. timp de preluare) — închis, `a6d7cd1`; LOT 4 (relief luminat doar de Soare, mare plată, perspectivă aeriană Chapman) — livrat, `5cd2873`, `3c2e2dd`, `ceb5ccc`; LOT 4b — livrat: etichetă onestă `0c4cb54`, GIBS pe WMTS `48a2651` + `9b02f3e`, relief liniar ETOPO 2022 ice surface + mască MOD44W `76361df` + `d4b0552`, consolă `f594e43`, câștig de umbrire ×30 `2240754`. Living Himalaya V0 (~19 zile) vine după Gate 2 (vezi §7).

**Actualizare 12 noiembrie 2026 — LOT 4 / LOT 4b.** LOT 4 (relief luminat doar de Soarele real, mare plată, perspectivă aeriană Chapman, ocean doar din albedo Blue Marble NG) — închis. *Corecție (12 noiembrie, LOT 4b ETAPA 0):* eticheta „×10 la Everest” din LOT 4 era greșită — texelul de la Everest e un eșantion punctual de ~5.029 m, iar codarea e neliniară; exagerarea reală este ≈×15 la cel mai înalt eșantion (6.734 m) și mult mai mare la altitudini mici. **LOT 4b (de făcut): regenerarea reliefului și a normal map-ului din ETOPO 2022 în metri.** Codare liniară în metri (nu sqrt-like), normale pe uscat calculate din `max(elev, 0)`, rezoluție ~4320×2160, KTX2 produs cu `toktx` (pipeline-ul existent). Motiv, din capturile LOT 4 (`tmp/lot4/ab-coast/`): coaste întunecate — codarea sqrt-like pune primul texel de uscat la gri ~0.48 față de 0.42 la nivelul mării, deci normale foarte înclinate pe coastă (1−n.z mediană 0.71 față de 0.18 în interior); tăierea la nivelul mării singură nu ajută (0.69); relief grosier la zoom; exagerare neliniară (≈×15 la cel mai înalt eșantion, mult mai mare la altitudini mici). Notă pentru un lot ulterior, separat de 4b: `FogExp2` negru din scenă întunecă Luna cu 7–16%, iar `gibs-tiles.js` și Atlas (`gateway-config.js`) folosesc încă stratul umbrit `BlueMarble_ShadedRelief`.

**Efort total până la un produs excelent și complet: ~14 săptămâni.**
**Efort până la ceva public și semnificativ mai bun decât acum: 2 săptămâni.**

---

## 12. CE SĂ FACI ÎN URMĂTOARELE 48 DE ORE

Nu tot documentul. Doar atât:

1. Instalează Spector.js.
2. Completează coloana „Baseline" din tabelul §1.
3. Fă screenshot-urile „înainte" la 3 niveluri de zoom.
4. Instalează KTX-Software și verifică `toktx --version`.

Atât. Restul urmează.

---

*Document viu. Actualizează-l la fiecare gate cu ce ai învățat — dar nu îl extinde cu faze noi. Dacă acest document crește peste 17 secțiuni, ai reintrat în tiparul pe care încearcă să-l prevină.*
