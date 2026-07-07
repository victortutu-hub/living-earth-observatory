# Living Earth Observatory

Living Earth Observatory este o scena WebGL/Three.js care combina o planeta 3D cinematica cu evenimente naturale aproape in timp real. Proiectul porneste de la NASA EONET si adauga straturi vizuale pentru relief, nori, zi/noapte cu Astronomy Engine, atmosfera fizica, cutremure USGS, NASA FIRMS, GDACS, aurora NOAA, Luna reala si ISS.

Fisierul principal este:

```text
earth-eonet-relief.html
```

Versiunea curenta include presetul `Showcase reel`, panou `Data sources`, export video 9:16, pacing de demo reel single-card sincronizat cu target-ul, card intro reparat, restore atomic dupa Demo reel, Vertical Director, caption system, Data Rhythm Camera, Moon/Earthshine reel moment, ISS trail si straturi atmosferice subtile controlabile.

## Rulare Locala

Din radacina proiectului:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Apoi deschide:

```text
http://127.0.0.1:8765/earth-eonet-relief.html
```

Pentru a evita cache-ul browserului in timpul dezvoltarii, poti adauga un query string:

```text
http://127.0.0.1:8765/earth-eonet-relief.html?dev=1
```

### Proxy local pentru GDACS / FIRMS / H.264

Pentru surse fara CORS deschis si pentru conversia optionala H.264:

```bash
node nasa-proxy-server.js
```

Pentru NASA FIRMS, copiaza `.env.example` in `.env` si seteaza:

```text
FIRMS_MAP_KEY=your_firms_map_key_here
```

Cheia reala ramane locala. `.env` si `proxy-cache/` sunt ignorate de git.

## Ce Face Aplicatia

- Afiseaza un glob 3D cu relief si bathymetry pe baza de texturi ETOPO.
- Incarca evenimente naturale din NASA EONET.
- Poate folosi GDACS ca fallback inteligent sau sursa principala temporara.
- Integreaza cutremure USGS in categoria `Earthquakes`.
- Integreaza NASA FIRMS ca layer suplimentar pentru hotspot-uri de incendiu prin proxy local.
- Poate afisa daily clouds din NASA GIBS.
- Poate afisa aurora NOAA SWPC OVATION ca oval polar discret.
- Sincronizeaza iluminarea zi/noapte cu pozitia solara reala.
- Are atmosfera `dot` sau `physical` cu scattering fizic aproximat.
- Include Luna cu pozitie, faza, distanta, orientare/libration, relief lunar si Earthshine.
- Include ISS cu telemetrie, tracking si trail vizual subtil.
- Include Airglow, Zodiacal Light si Noctilucent Clouds ca fenomene reale reprezentate procedural, cu toggle/preset/intensitate.
- Exporta PNG si video reel vertical 9:16.

## Surse De Date

- NASA EONET: evenimente naturale aproape in timp real.
- GDACS: EU JRC / UN OCHA global disaster alerts, folosit ca fallback sau mod GDACS-only.
- NASA FIRMS: MODIS/VIIRS wildfire hotspots, optional prin proxy local si `FIRMS_MAP_KEY`.
- NASA GIBS: daily cloud snapshot, nu live minut-cu-minut.
- USGS: feed de cutremure, integrat local ca evenimente `earthquakes`.
- NOAA SWPC OVATION: forecast aurora, folosit pentru intensitatea ovalului polar.
- NOAA/ETOPO-derived relief assets: texturi locale pentru relief si normal map.
- Astronomy Engine: pozitie solara aparenta, Solar clock, Luna, faza, distanta si geometrie astronomica.
- TLE/SGP4: pozitie ISS si tracking orbital.
- Airglow: fenomen real de emisie in atmosfera superioara, intensitate procedurala, nu snapshot live.
- Zodiacal Light: lumina solara imprastiata de praf interplanetar, aproximata pe ecliptica.
- Noctilucent Clouds: fereastra reala de latitudine/sezon/twilight, morfologie procedurala.

Assets locale importante:

```text
assets/etopo2022-bedrock-relief-2160x1080.png
assets/etopo2022-bedrock-normal-2160x1080.png
```

## Module Principale

### Bootstrap si runtime

- `src/earth/scene-runtime.js` creeaza scena, renderer, camera, controls si composer.
- `src/earth/earth-app-bootstrap.js` incarca texturile si pregateste scena initiala.
- `src/earth/app-services.js` leaga serviciile principale ale aplicatiei.
- `src/earth/app-runtime.js` porneste lifecycle-ul, UI wiring-ul, animation loop-ul si demo reel.
- `src/earth/app-state.js` defineste starea initiala si presetul default.
- `src/earth/scene-runtime.js` foloseste `EffectComposer` cu `UnrealBloomPass`, `SMAAPass` si `OutputPass`.

### Planeta, lumina si atmosfera

- `src/earth/app-visual-foundation.js` compune fundatia vizuala: geo utils, event utils, solar runtime, earth layers, stars si clouds.
- `src/earth/earth-layers.js` creeaza mesh-urile pentru Earth, night lights si atmosphere.
- `src/earth/earth-material.js`, `earth-look.js`, `earth-appearance.js` controleaza materialele si look preset-urile.
- `src/earth/atmosphere.js` contine atmosfera `dot` si `physical`.
- `src/earth/solar-runtime.js`, `solar-system.js` calculeaza pozitia solara si solar clock.

### Date si UI EONET / multi-source

- `src/earth/eonet-data.js` incarca feed-ul NASA EONET, providerii suplimentari si fallback-ul GDACS.
- `src/earth/eonet-ui.js` randeaza lista, Today on Earth, detaliile si filtrele.
- `src/earth/eonet-workflow.js` coordoneaza load/filter/select.
- `src/earth/event-scene.js`, `marker-system.js`, `polygon-overlays.js` randeaza markeri, clustere si poligoane. Calea stabila pastreaza mesh-uri individuale pentru EONET/highlights si foloseste un `Points` shader layer pentru cutremure USGS de fundal cand sunt multe evenimente.
- `src/earth/gdacs-provider.js`, `firms-wildfires.js`, `usgs-earthquakes.js` normalizeaza sursele alternative in modelul comun de eveniment.

### Live layers

- `src/earth/live-data-layers.js` conecteaza USGS, NASA FIRMS si NOAA aurora.
- `src/earth/usgs-earthquakes.js` transforma feed-ul USGS in evenimente compatibile cu UI-ul EONET.
- `src/earth/noaa-aurora-layer.js` creeaza ovalul polar pe baza de intensitate NOAA.
- `src/earth/iss-system.js` calculeaza pozitia ISS si randarea trail-ului orbital.
- `src/earth/moon-system.js` calculeaza Luna, faza, libration/orientare, texturi si Earthshine.
- `src/earth/airglow-system.js`, `zodiacal-light-system.js`, `noctilucent-cloud-system.js` adauga fenomene atmosferice/astronomice subtile cu intensitate controlata.

### Reel si export

- `src/earth/reel-timeline.js` controleaza Demo reel: intro, evenimente, outro, restore.
- `src/earth/reel-overlay.js` deseneaza cardurile, caption-urile, locator line si signal pulse.
- `src/earth/reel-presets.js` contine mood-urile si motion preset-urile.
- `src/earth/vertical-director.js`, `caption-system.js`, `data-rhythm-camera.js` controleaza compozitia 9:16, textul social si ritmul camerei bazat pe date.
- `src/earth/export-system.js` exporta PNG si video 9:16 cu acelasi bloom + SMAA polish ca scena interactiva.

## Preseturi Importante

### Default

La pornire, aplicatia foloseste:

- `Cinematic Earth`
- `Cinematic mood`
- `Atmosphere: physical`
- `Daily clouds: off`
- `USGS quakes: off`
- `Aurora: off`

### Showcase reel

Butonul `Showcase reel` seteaza un mod pregatit pentru social/reel:

- `Reel duration: 24s`
- `Cinematic mood`
- `Showcase Earth`
- `Atmosphere: physical`
- `Slow orbit`
- `Guide 9:16: on`
- `Fit 9:16`

Nu forteaza `Brand: on`; brand-ul ramane alegerea utilizatorului.

### Demo reel

Butonul `Demo reel` porneste exportul publicabil:

- seteaza temporar un look cinematic/showcase;
- foloseste atmosfera fizica;
- ruleaza un tur editorial prin evenimentele selectate;
- exporta video 1080x1920;
- afiseaza progresul exportului;
- restaureaza starea initiala dupa final.

Restore-ul Demo reel pastreaza:

- durata reel;
- brand/capture;
- motion preset;
- earth look;
- atmosphere mode;
- reel mood;
- spin speed;
- snap duration;
- night look.

## Workflow Recomandat Pentru Reel

1. Porneste serverul local.
2. Deschide `earth-eonet-relief.html`.
3. Apasa `Showcase reel`.
4. Alege `Brand: on/off` dupa preferinta.
5. Verifica incadrarea in ghidul 9:16.
6. Apasa `Demo reel`.
7. Asteapta exportul pana la 100%.
8. Verifica fisierul `.webm` descarcat.

## Backup / Freeze

Snapshot-ul final curent este:

```text
Back Up/earth-eonet-relief-v2.4.4-earthshine-reel-moment-20260703-0942
```

Acest snapshot include:

- multi-source data layer: EONET, GDACS, USGS, FIRMS;
- proxy local cu `.env` pentru FIRMS si cache local;
- Moon V2.1+ cu faza, distanta, libration, Earthshine si texturi comutabile;
- ISS tracking si trail vizual subtil;
- Zodiacal Light, Noctilucent Clouds si Airglow cu toggle/preset/intensitate;
- Showcase reel, Vertical Director, captions si Data Rhythm Camera;
- restore atomic pentru Demo reel si export video 9:16.

## Note De Dezvoltare

- Proiectul este modularizat; evita schimbari mari direct in HTML.
- Pentru editari vizuale, prefera modulele din `src/earth`.
- Pentru date externe, pastreaza fallback-uri si statusuri clare in UI.
- Pentru reel, testeaza intotdeauna in 9:16 si verifica daca textul ramane in safe margins.
- Dupa o stare buna, creeaza un nou snapshot in `Back Up`.
