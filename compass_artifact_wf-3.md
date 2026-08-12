# Analiză tehnică & foaie de parcurs: Living Earth Observatory (Luminomorphism)

## TL;DR
- **Proiectul este solid conceptual și onest științific** (fiecare strat e clasificat observed/physical/interpretive/fallback), dar suferă exact de problema pe care ți-o cunoști: infrastructură prea adâncă (runtime host, contract de observator, replay diagnostic) construită înainte ca globul în sine să aibă texturare modernă. Suprafața rulează încă pe ETOPO2022 static, 2160×1080 PNG — ăsta e bottleneck-ul #1 de calitate vizuală și de VRAM.
- **Cea mai mare pârghie de impact rapid pe GTX 1650 4GB**: conversia texturilor la KTX2/Basis (economie tipică 4-8× VRAM), streaming de tile-uri GIBS WMTS ca XYZ (zero preprocesare, peste 1.000 de produse gratuite fără cheie), și night lights VIIRS Black Marble. Toate trei livrabile în zile, nu luni.
- **Migrarea WebGPU/TSL are sens ca ramură R&D, dar NU e prioritate** — pe 1650, WebGL2 + KTX2 + LOD corect îți dau ~80% din câștig. Compute shaders pentru curenți/vânt sunt singurul motiv real să treci la WebGPU, și doar după ce globul de bază arată bine.

## Key Findings

1. **Arhitectura e matură, dar dezechilibrată.** Ai ~40 de module în `src/earth`, un contract de observator partajat, caching persistent, retries, coalescing, replay diagnostic — infrastructură de nivel producție. Dar suprafața planetei rulează pe două PNG-uri statice (`etopo2022-bedrock-relief-2160x1080.png` + normal map). Raportul efort/rezultat vizual e inversat.
2. **Pipeline de render corect dar conservator.** `EffectComposer` cu `UnrealBloomPass → SMAAPass → OutputPass`. Bloom-ul e scump pe 4GB VRAM la rezoluție mare. Lipsește tone mapping HDR explicit și TAA.
3. **Datele live sunt bine gândite** (EONET, USGS, GDACS, FIRMS, NOAA SWPC, CelesTrak/SGP4, Astronomy Engine) cu fallback onest. Proxy Node.js doar pentru sursele non-CORS (GDACS, FIRMS). Corect.
4. **Texturarea e la nivelul 2015.** Fără virtual texturing, fără clipmaps, fără tile streaming, fără compresie GPU. La zoom mare vezi texeli întinși.
5. **Sursele gratuite de date sunt vaste și mult sub-exploatate** — NASA GIBS singur oferă, conform paginii NASA Earthdata GIBS API, „quick access to over 1,000 satellite imagery products, covering every part of the world... Most imagery is updated daily... and some products span almost 30 years", accesibile prin WMTS fără cheie și CORS-friendly.

## Details

### 1. Analiză tehnică directă (fără diplomație)

**Ce e bine făcut:**
- **Onestitatea epistemică** e reală și rară. Clasificarea observed/physical/interpretive/fallback, refuzul de a prezenta fallback procedural drept date live, etichetarea pLDDT ca „model confidence" — asta e integritate de care majoritatea proiectelor „data viz" n-au habar. E un diferențiator de brand puternic.
- **Modularizarea** e disciplinată: `scene-runtime`, `earth-app-bootstrap`, `app-services`, `app-runtime`, `app-state` separate. Bun pentru mentenanță.
- **Fizica reală**: poziție solară din efemeride, refracție la orizont (`sunDot' = dot(...) + 0.0099`, ≈+0.567° la orizont), fază/librație lunară, Earthshine, SGP4 pentru ISS. Fresnel Schlick pe ocean (F₀≈0.02). Astea sunt corecte fizic.
- **Fallback resilience**: cache persistent, stale fallback controlat, request coalescing. Nivel producție.

**Ce lipsește / unde sunt problemele:**
- **Bottleneck #1 — texturi statice.** `etopo2022-bedrock-relief-2160x1080.png` este întreaga suprafață. 2160×1080 e sub rezoluția unui singur nivel de zoom GIBS decent. La orice zoom real vezi mush. Ăsta e cel mai mare decalaj între ambiția „Cinematic Earth" și realitate.
- **Bottleneck #2 — fără compresie GPU.** Un PNG 2160×1080 RGBA ajunge ~9.3MB necomprimat în VRAM per textură; cu relief + normal + night + clouds aduni rapid spre 40-60MB doar pe suprafață, plus render targets de bloom. Pe 4GB e gestionabil acum, dar nu scalezi la 8K fără KTX2.
- **Bottleneck #3 — bloom + SMAA la rezoluție full.** `UnrealBloomPass` face mai multe pase de downsample/blur. Pe 1650 la 1080p e ok; la export 1080×1920 și la ferestre mari începe să coste. Nu ai TAA (mai ieftin decât combo-ul SMAA+bloom pentru calitatea dată).
- **Problemă de arhitectură — entry point HTML monolit** (`earth-eonet-relief.html`), cu module ES importate. README-ul însuși avertizează „avoid large changes directly in the HTML file" — semn că HTML-ul a acumulat prea mult.
- **Fără sistem de plugin pentru straturi.** Fiecare sursă (USGS, FIRMS, aurora) e cablată manual în `live-data-layers.js`. Adăugarea unei surse noi necesită editare în mai multe locuri. Un registry de layere ar rezolva.
- **Fără teste automate** vizibile în repo. Pentru un proiect cu atâtea transformări de coordonate (bug-ul `[lat,lon]` vs `[lon,lat]` din v2.4.2 e exact genul care revine), lipsa testelor e risc.
- **GPU picking absent** — selecția markerelor pare bazată pe meshe individuale; la USGS dens folosești deja un `Points` shader layer, dar selecția pe puncte dense fără GPU picking e fragilă.

**Verdict onest:** Ai construit un chassis de Formula 1 și ai pus pe el cauciucuri de bicicletă (textura). Prioritatea nu e mai multă infrastructură — e să faci suprafața planetei să arate la nivelul restului. Și, dat fiind tiparul tău documentat de over-engineering: **publică globul cu texturi bune ÎNAINTE de a mai adăuga un observator sau un strat de runtime.**

### 2. Idei inovatoare pentru texturi

Ordonate după raport impact/efort pentru bugetul tău de 4GB VRAM.

**A. Compresie KTX2 / Basis Universal (EFORT MIC, IMPACT MARE) — fă asta prima.**
KTX2 cu Basis rămâne comprimat în VRAM (transcodează la formate GPU-native: BC pe desktop, ASTC/ETC2 pe mobil). Conform lui Don McCurdy (maintainer glTF/three.js), KTX2+Basis „typically cuts texture memory 4× to 8×", pentru că „a 2048×2048 RGBA texture is 16 MB in memory no matter how small the PNG was". Un test concret citat de Evergine: „The whole 4 images add up to 128MB of VRAM when using JPG, vs 32MB when using KTX. The quality of the final image is similar, and you won't notice the difference." Three.js are `KTX2Loader` nativ; ai nevoie de `basis_transcoder.wasm` + `detectSupport(renderer)`. Pentru normal maps folosește UASTC (calitate), pentru albedo ETC1S + supercompresie Zstandard. Tool: `toktx` din KTX-Software. **Asta îți eliberează VRAM pentru texturi mai mari.**

**B. Tile streaming din GIBS WMTS ca XYZ (EFORT MIC-MEDIU, IMPACT MARE).**
Nu construi virtual texturing de la zero. GIBS servește deja tile-uri pre-rendered, time-enabled, fără cheie, CORS-friendly. Template RESTful:
```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.jpg
```
Folosește DNS-urile `gibs-a/b/c.earthdata.nasa.gov` pentru a ocoli limita de conexiuni simultane a browserului. Layer-e utile: `BlueMarble_ShadedRelief_Bathymetry`, `MODIS_Terra_CorrectedReflectance_TrueColor`, `VIIRS_SNPP_DayNightBand_At_Sensor_Radiance`. Mapezi tile-ul (z/x/y) pe sfera globului printr-un quadtree simplu pe lat/lon. Cache GetCapabilities (e mare, ~5.6MB) — hardcodează layer-ele de care ai nevoie.

**C. Night lights VIIRS Black Marble (EFORT MIC, IMPACT MARE vizual).**
Ai deja „night lights" menționat în `earth-layers.js`, dar verifică sursa. Conform Black Marble User Guide (NASA VIIRS Land Team), produsul VNP46 este „at 15 arc-second spatial resolution [~500 m], available from January 2012-present with data from the VIIRS DNB sensor... processed on a daily basis within 3-5 hours of acquisition." Important pentru filozofia ta: VNP46 vine în compozite ajustate pentru lumina lunii la cadență zilnică (VNP46A2), lunară (VNP46A3) și anuală (VNP46A4) — deci poți face blend sezonier/temporal, nu doar un layer static. Cel mai simplu în browser: layer-ul GIBS `VIIRS_Black_Marble` sau compozitul Blue/Yellow. Se amestecă în shader cu terminatorul solar pe care deja îl calculezi (`sunDot`). Câștig cinematic imediat.

**D. Detail/procedural noise blending la zoom mare (EFORT MEDIU).**
Când tile-urile GIBS rămân fără rezoluție, amestecă un detail texture procedural (noise multi-octavă) modulat de land cover (ESA WorldCover, 11 clase la 10m) pentru a sparge aspectul de texel întins. Blend bazat pe distanța camerei. Se leagă de filozofia ta — noise-ul e „interpretive layer" declarat, nu date.

**E. Bathymetry shading (EFORT MIC).**
Ai deja ETOPO relief. Adaugă o rampă de culoare pe adâncime (hipsometrie) pentru ocean + shading pe pantă din normal map. GEBCO_2026 (15 arc-sec) via WMS dacă vrei date mai bune decât ETOPO. Fresnel-ul tău pe apă + bathymetry = ocean credibil.

**F. Normal/parallax mapping pe teren (EFORT MEDIU).**
Ai normal map ETOPO. Adaugă parallax occlusion mapping la zoom mare pentru relief de munte cu adâncime reală. Ieftin pe fragment shader, mare impact la zoom.

**G. BRDF-uri specializate (EFORT MEDIU, aliniat perfect cu Luminomorphism).**
- **Apă**: ai Fresnel Schlick; adaugă sun glint (specular Blinn-Phong pe direcția solară) și absorbție dependentă de adâncime.
- **Gheață/zăpadă**: subsurface scattering wrap (ai deja `sss = clamp((sunDot+0.3)/1.3, 0, 1)` — Jensen 2001 simplificat). Modulează cu mască sezonieră.
- **Vegetație**: BRDF cu backscatter (hotspot) modulat de WorldCover.

**H. Snow/ice masks sezoniere (EFORT MIC-MEDIU).**
GIBS `MODIS_Terra_Snow_Cover` sau `IMS_Snow_Ice` (zilnic). Sau derivă din Blue Marble seasonal albedo (12 luni) pe care README-ul îl menționează ca țintă. Interpolezi între luni după data reală.

**I. Cloud volumetric layers (EFORT MARE — lasă la urmă).**
Ai deja GIBS daily clouds ca snapshot 2D. Volumetric real (raymarching) e scump pe 1650. Alternativă ieftină: 2 straturi de nori 2D la altitudini diferite cu parallax + self-shadowing fake. Volumetric adevărat doar pe WebGPU compute.

**J. Aerosoli & scattering atmosferic (EFORT MEDIU).**
Ai `physical` atmosphere mode cu Mie-style scattering. Pentru aerosoli reali: Sentinel-5P AER_AI via GIBS WMTS (cel mai simplu — vezi tabel). Modulează densitatea Mie cu indexul de aerosoli. Cerul Hosek-Wilkie (menționat în R&D) e superior lui Preetham pentru turbiditate variabilă — există implementări GLSL de referință.

**Despre virtual texturing / SVT / clipmaps:** Da, sunt tehnicile „corecte" pentru globuri planetare (Gaia Sky le folosește, ellipsoidal clipmaps sunt SOTA academic — Losasso & Hoppe / clipmaps sferice Clasen & Hege). DAR: SVT e „notoriously complex and hard to implement" (Toni Sagristà, Gaia Sky), iar determinarea tile-urilor vizibile pe o sferă 3D e problema grea (RenaudPradenc: „could not find a reliable solution for the round 3D surface of the Earth"). **Pentru tine, solo, cu tiparul de over-engineering: NU construi SVT. Folosește tile streaming XYZ din GIBS (B) + KTX2 (A).** Asta îți dă ~90% din beneficiu la ~10% din efort. Clipmaps sferice doar dacă vrei teren displaced la scară de munte cu zoom la nivel de metri — probabil out of scope.

### 3. Surse gratuite de date

Legendă CORS: ✅ = fetch direct din browser; ⚠️ = necesită proxy (cheie secretă sau non-CORS).

| Sursă | Ce oferă | Format | Cheie? | Rate limit | CORS | Licență |
|---|---|---|---|---|---|---|
| **NASA GIBS** | >1.000 produse imagery (true color, night, snow, aerosoli, SST) | WMTS/WMS/TWMS, PNG/JPEG tiles, time-enabled | Nu | Fair-use; GetCapabilities ~5.6MB (cache!) | ✅ (gibs-a/b/c) | NASA EOSDIS open |
| **NASA EONET** | Evenimente naturale near-real-time | GeoJSON/JSON | Nu | Fair-use | ✅ | Open |
| **NASA FIRMS** | Hotspots incendii MODIS/VIIRS | CSV / KML | Da (MAP_KEY gratuit) | 5000 tranzacții/10min | ⚠️ proxy | NASA open |
| **NASA Black Marble** | Night lights VIIRS (VNP46), 15 arc-sec, 2012→, compozite zilnice/lunare/anuale | HDF5 (LAADS) / tiles via GIBS | Nu (via GIBS) | — | ✅ via GIBS | NASA open |
| **NASA POWER** | Meteo + solar (MERRA-2, CERES) | JSON/CSV/NetCDF | Nu | Fair-use; max 20 params/request | ✅ (verifică live) | Open US Gov |
| **USGS Earthquakes** | Cutremure real-time | GeoJSON | Nu | Fair-use | ✅ | Public domain |
| **GDACS** | Alerte dezastre globale (JRC/UN) | GeoJSON/RSS | Nu | — | ⚠️ proxy (CORS) | Open |
| **Copernicus DEM GLO-30/90** | Elevație globală 30/90m | COG GeoTIFF (AWS S3) | Nu (S3 public) | — | ⚠️ (pre-tile server-side) | Free + atribuire DLR/Airbus |
| **ESA WorldCover** | Land cover 10m, 11 clase | COG GeoTIFF / WMS (Terrascope) | Nu | — | ✅ WMS / ⚠️ COG | CC BY 4.0 |
| **GEBCO_2026** | Batimetrie globală 15 arc-sec | NetCDF / WMS | Nu | — | ✅ WMS | Free + atribuire |
| **Copernicus Marine** | Curenți, chlorophyll, SST, valuri | WMTS / NetCDF | Da (cont gratuit) | — | ⚠️ proxy | Copernicus open |
| **Sentinel-5P aerosoli/NO2** | AER_AI, NO2 | WMTS via GIBS / NetCDF via CDSE | Nu (GIBS) / Da (CDSE OAuth) | — | ✅ GIBS / ⚠️ CDSE | Copernicus/NASA open |
| **NOAA SWPC** | Space weather, OVATION aurora | JSON / text / image | Nu | Fair-use | ✅ (majoritatea) | Public domain |
| **NOAA NDBC** | Boi meteo/oceanografice (>900 stații) | text fixed-width / JSON wrappers | Nu | Fair-use | ⚠️ (verifică) | Public domain |
| **NOAA GOES** | Imagery satelit (sectoare) | PNG / imagery | Nu | — | ✅ | Public domain |
| **Open-Meteo** | Forecast + istoric din 1940, marine, air quality | JSON | Nu | ~10k req/zi non-comercial | ✅ (CORS nativ) | CC BY 4.0 |
| **OpenAQ** | Calitate aer global (PM2.5, NO2, O3...) | JSON (v3) | Da (cheie gratuită) | — | ⚠️ NU suportă CORS → proxy | Open |
| **GBIF** | Ocurențe specii (peste 3,1 mld. înregistrări, >2.500 instituții) + map tiles | JSON / vector+raster tiles PNG | Nu | 429 la load mare | ✅ (tile.gbif.org) | Open (CC-BY variabil) |
| **OpenStreetMap** | Vectori geo, granițe, orașe | tiles / Overpass API | Nu (tiles cu policy) | Tile usage policy strict | ✅ | ODbL |
| **Natural Earth** | Vectori geo (granițe, coaste) | Shapefile / GeoJSON | Nu | — (static) | ✅ | Public domain |
| **CelesTrak** | TLE sateliți (ISS etc.) | TLE / JSON | Nu | Fair-use | ✅ | Open |
| **OpenSky Network** | Trafic aerian ADS-B | JSON REST | Anonim (limitat) / cont OAuth | Anonim ~400 credite/zi, rez 10s; cont 4000/zi | ⚠️ (accesul anonim clasic deprecat pre-2025) | Non-comercial |
| **AISStream.io** | Trafic naval AIS | JSON over WebSocket (wss) | Da (gratuit) | Throttle per key; ~300 msg/s global | ⚠️ proxy (browser nesuportat) | ToS gratuit |
| **IRIS/EarthScope FDSNWS** | Seismic stații/evenimente/unde | StationXML/QuakeML/text/miniSEED | Nu (date deschise) | Fair-use; 307 redirect → earthscope.org | ✅ (urmează redirect) | NSF SAGE open |
| **Smithsonian GVP** | Vulcani Holocene (~1.400) + eruptii | GeoJSON (E3 app) / DB | Nu | — | ✅ | Open + atribuire |
| **Global Forest Watch / Hansen** | Pierdere pădure 2000-2024, 30m | WMTS tiles / GeoTIFF / JSON API | Nu (tiles) / Da (Data API) | — | ✅ tiles / ⚠️ Data API | CC BY 4.0 (Hansen 2013) |
| **Copernicus CDS ERA5** | Reanaliză climatică din 1940 | GRIB/NetCDF (async jobs) | Da (token) | Queue-based | ⚠️ server-only | Copernicus open |
| **GLIMS** | Ghețari globali | Shapefile/GeoJSON | Nu | — | ✅ | Open |

**Recomandări de prioritizare surse:** Începe cu ce e ✅ și fără cheie — GIBS (imagery + night + aerosoli + snow), USGS, EONET, GBIF tiles, GVP, Open-Meteo, IRIS. Astea nu-ți ating proxy-ul deloc. Lasă în proxy ce ai deja (FIRMS, GDACS) + adaugă OpenAQ și AISStream când ai nevoie. **De reținut din analiza pe surse**: patru surse „grele" (CDS ERA5, AISStream.io, Sentinel Hub/CDSE, GFW Data API) implică toate credențiale secrete sau pattern async/websocket și trebuie să stea în spatele unui proxy; restul le poți lovi direct din browser.

### 4. Design / UX

**Filozofia ta („lumina ca material") e deja diferențiatorul.** Nu o dilua. Direcții concrete:

- **Tipografie**: monospace pentru telemetrie/coordonate/UTC (ai deja vibe-ul ăsta din landing), grotesk clean pentru narativ. Numerele să fie tabular (`tabular-nums`) ca să nu danseze la update.
- **Paletă**: fundal near-black (`#05060e`, pe care îl ai deja), cu accent driven de date — culoarea unui eveniment din magnitudinea/severitatea lui, nu decorativă. Consistent cu principiul.
- **HUD layout**: ai deja „Runtime Control Center" bun. Pericol: prea multă telemetrie deodată. Progressive disclosure — carduri care se expandează la interacțiune.
- **Timeline scrubbing**: ai deja reel timeline. Adaugă un scrub global pe timp (GIBS e time-enabled!) — trage de timeline și vezi norii/aerosolii/incendiile din ziua aleasă. Killer feature aliniat cu datele.
- **Storytelling cu date**: ai „editorial tour". Extinde spre „cross-observatory stories" (deja pe roadmap).
- **Split-screen compare**: two-globe sau swipe — ex. night lights 2012 vs 2024, sau forest loss. Împrumută de la GFW și zoom.earth.
- **Cinematic camera**: ai Data Rhythm Camera, Vertical Director. Bun. Adaugă easing bazat pe fizică (spring), nu doar keyframe.
- **Accesibilitate**: contrast WCAG pe text peste glob (fundal variabil → pune scrim), respect `prefers-reduced-motion`, focus states pentru navigare cu tastatură. Momentan pare mouse/touch-first.
- **Mobile**: ai deja 9:16 director. Dar globul WebGL pe mobil low-end = risc. Detectează și degradează (mai puține straturi, fără bloom).

**Referințe & ce împrumuți:**
- **NASA Eyes**: cinematic camera transitions, time controls elegante.
- **Earth Nullschool** (Cameron Beccario): particle wind advection — tehnica canonică (versiune open source veche disponibilă, bază pentru Windy/Ventusky/Esri Wind-JS). Estetica minimalistă a HUD-ului.
- **Windy**: layer switching rapid, overlay + particule combinate.
- **Ventusky**: tranziții de culoare pe layere meteo.
- **Google Earth Web**: LOD streaming, gesture handling.
- **Cesium ion**: 3D tiles streaming, terrain LOD.
- **zoom.earth**: timeline scrubbing pentru satelit + dezastre, comparație temporală.

### 5. Îmbunătățiri tehnice

**Performanță (prioritar pe 1650 4GB):**
- **Draw calls / instancing**: markerele EONET ca meshe individuale → `InstancedMesh` cu per-instance color/scale. Ai deja `Points` pentru USGS dens; extinde pattern-ul.
- **LOD**: pentru glob, tile LOD prin GIBS TileMatrix (zoom-dependent). Pentru markere, cluster la depărtare.
- **Frustum culling**: Three.js îl face pe mesh; asigură-te că markerele grupate au bounding volumes corecte.
- **GPU picking**: render target cu ID-uri de culoare pentru selecția markerelor dense — mai robust decât raycasting pe mii de puncte.
- **Bloom**: rulează bloom la jumătate de rezoluție (downsample) — economie mare pe 1650, diferență vizuală minimă.

**Migrare WebGPU/TSL (R&D, nu urgent):**
- TSL compilează același graf la GLSL (WebGL) și WGSL (WebGPU) dintr-o sursă. Migrarea de bază e ~o linie: `WebGLRenderer` → `WebGPURenderer` din `three/webgpu`, cu fallback automat la WebGL2. DAR: câștigul real e la draw calls mari și compute. Pe globul tău actual, WebGPU nu ajută dacă bottleneck-ul e texture upload sau shader compile.
- **Singurul motiv convingător**: compute shaders pentru simulare.

**Compute shaders pentru simulare (justifică WebGPU):**
- **Particule de vânt** (advecție tip Nullschool): ping-pong pe texturi de poziții, câmp de vânt din Open-Meteo/GFS. Pe WebGL2 se face cu transform feedback / FBO ping-pong; pe WebGPU cu compute e mai curat.
- **Curenți oceanici**: același pattern cu date Copernicus Marine (WMTS currents, `cmems_mod_glo_phy-cur_...`).
- **Advecție** generală pentru orice câmp vectorial.

**Post-processing:**
- **Tone mapping HDR**: adaugă ACES Filmic (ai deja bloom care sugerează pipeline HDR, dar output-ul pare LDR). ACES îți dă highlights mai bune pe soare/night lights.
- **TAA** în loc de/pe lângă SMAA: mai bun pentru scene cu multe puncte mici (markere) care sclipesc.

**Export determinist / perfect loop:**
- Ai deja export 9:16 webm. Pentru perfect loop: fixează seed-ul pentru orice noise procedural + parametrizează camera pe o buclă închisă (perioada = durata reel). Renderizează pe timestep fix (nu real-time delta) pentru determinism.

**Caching / offline:**
- Ai deja cache persistent + „simulate offline". Adaugă **Service Worker** pentru cache-uirea tile-urilor GIBS și a asset-urilor — offline mode real + load instant la revizită. Aliniat cu „public resilience polish" din roadmap.

**Arhitectură de plugin pentru straturi:**
- Definește un `LayerPlugin` interface: `{ id, source, cadence, normalize(), toMarkers()/toTexture(), cors: bool }`. Fiecare sursă (USGS, FIRMS, GVP, GFW) devine un plugin înregistrat într-un registry. Rezolvă cablarea manuală din `live-data-layers.js` și se leagă direct de „observatory contract" pe care deja îl ai.

**Teste automate:**
- Prioritate #1: teste unitare pentru transformările de coordonate (bug-ul `[lat,lon]`/`[lon,lat]` din v2.4.2). Vitest + fixtures GeoJSON. Ieftin, previne clasa de bug care ți-a mâncat timp deja.
- Smoke test pentru fiecare adapter de sursă (mock response → normalized event).

## Recommendations

Prioritizare impact/efort. **„Livrează rapid" = zile; „Mediu" = 1-2 săptămâni; „Mare" = luni.**

### Nivel 1 — Livrează rapid, impact mare (fă ACUM, apoi PUBLICĂ)
1. **KTX2/Basis pe toate texturile.** Eliberezi VRAM (4-8×), load mai rapid. `KTX2Loader` + `toktx`. (efort mic)
2. **Tile streaming GIBS WMTS ca XYZ pe glob.** True color + shaded relief bathymetry. Sare peste texturile statice 2160×1080. (efort mic-mediu)
3. **Night lights VIIRS Black Marble via GIBS**, blend cu terminatorul. (efort mic)
4. **Bloom la jumătate de rezoluție + ACES tone mapping.** Câștig FPS + highlights. (efort mic)
5. **Service Worker pentru cache tile-uri.** Offline real. (efort mic)

**Benchmark care schimbă planul:** dacă după KTX2 + tiles ești sub ~3.5GB VRAM și >45fps la 1080p pe 1650 → publică. Dacă nu → profilează cu Spector.js / Chrome DevTools GPU înainte de a adăuga orice.

### Nivel 2 — Impact mare, efort mediu (după publicare)
6. **Registry de layer plugins** — refactor `live-data-layers.js`. Deblochează adăugarea rapidă de surse noi.
7. **Timeline scrubbing global** pe timp GIBS (nori/aerosoli/incendii istorice).
8. **Snow/ice masks sezoniere + Blue Marble seasonal albedo.**
9. **Bathymetry hipsometric shading + sun glint pe ocean.**
10. **InstancedMesh + GPU picking pentru markere.**
11. **Teste unitare coordonate + smoke tests adaptere.**

### Nivel 3 — R&D, efort mare (doar dacă nucleul e solid)
12. **Ramura WebGPU/TSL** cu fallback WebGL2.
13. **Compute shaders: particule de vânt (Open-Meteo) + curenți oceanici (Copernicus Marine).** Ăsta e adevăratul „living Earth".
14. **Parallax occlusion mapping la zoom mare + detail noise blending (WorldCover).**
15. **Cloud volumetric** (doar WebGPU).
16. **Cer Hosek-Wilkie + aerosoli Sentinel-5P modulând Mie.**

### Ce să NU faci
- **NU construi virtual texturing / SVT de la zero.** Complexitate uriașă; tile streaming XYZ îți dă ~90% din beneficiu.
- **NU adăuga un al treilea observator** înainte să faci Living Earth să arate la nivelul ambiției.
- **NU migra la WebGPU** ca scop în sine — doar pentru compute.

## Caveats
- **N-am putut citi codul sursă linie-cu-linie.** Analiza se bazează pe README-ul foarte detaliat, structura de module descrisă acolo, pagina demo publică (`victortutu-hub.github.io/living-earth-observatory`) și pe faptul că `raw.githubusercontent.com` și paginile GitHub de tree/commits au blocat fetch-ul automat. Concluziile despre bottleneck-uri sunt inferențe din arhitectura descrisă (texturile statice 2160×1080 sunt confirmate explicit în README ca assets), nu din profilare reală. **Profilează cu Spector.js / Chrome DevTools GPU înainte de a acționa pe presupunerile de performanță.**
- **Rate limits și CORS se schimbă.** OpenSky a deprecat accesul anonim clasic (pre-martie 2025 → OAuth client credentials). NASA POWER CORS n-a fost confirmat explicit în docs — testează cu un fetch live (nu conține cheie, deci un proxy e trivial dacă e blocat). Verifică GetCapabilities GIBS pentru identificatorii exacți de layer S5P.
- **Licențe**: Copernicus DEM cere notice specific („© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018...") la distribuție. Hansen cere citare Hansen et al. 2013, *Science* 342:850–853. GIBS/NASA cer atribuire. Respectă-le — se aliniază perfect cu etica ta de provenance.
- **GTX 1650 4GB e un constraint real.** Volumetric clouds și WebGPU compute grele pot depăși bugetul. Testează incremental cu monitorizare VRAM.
- **Notă strategică de personalitate:** dat fiind tiparul tău documentat de „build infrastructure too deep before publishing", tratează secțiunea Recomandări ca pe un gate: nu trece la Nivel 2 până Nivel 1 nu e live și public. Cel mai valoros lucru pe care-l poți face în următoarele zile nu e cod nou — e să faci suprafața planetei să arate la nivelul chassis-ului pe care deja l-ai construit, și apoi să apeși „publish".