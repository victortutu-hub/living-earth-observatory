# Post public — Gate 0 (schiță de editat)

Structura urmează filozofia ta: separă explicit **ce e observat**, **ce e fizic**
și **ce e interpretativ**. Alege varianta RO sau EN, taie ce vrei, e punct de plecare.

---

## Varianta LinkedIn — RO

Am publicat **Living Earth Observatory** — un glob 3D pe care evenimentele
naturale ale planetei apar în timp cvasi-real, direct din surse deschise.

Principiul din spate (Luminomorphism): **lumina e material, nu decor.** Fiecare
element vizual e justificat de date reale sau de fizică reală — și e etichetat
onest ca atare.

**Ce e observat** (date măsurate):
– Suprafața: NASA GIBS Blue Marble, relief + batimetrie, 8192×4096
– Noaptea: VIIRS Black Marble (2016), care se stinge exact la terminatorul solar
– Evenimente: NASA EONET, cutremure USGS, incendii NASA FIRMS, alerte GDACS

**Ce e fizic** (geometrie/simulare reală):
– Poziția Soarelui și a Lunii (Astronomy Engine), cu librație lunară reală
– Orbita ISS (TLE CelesTrak + propagator SGP4)
– Terminatorul zi/noapte, cu refracție atmosferică

**Ce e interpretativ** (reprezentare procedurală, declarată ca atare):
– Airglow, lumină zodiacală, nori noctilucenți — constrânse fizic, dar nu un
snapshot live

Tehnic: rulează pe o GTX 1650 (4GB) la ~60 FPS median. Three.js / WebGL2,
texturi comprimate KTX2/Basis (relief 755 → 168 MB VRAM), tone mapping ACES,
bloom la jumătate de rezoluție.

Nimic din ce se mișcă pe glob nu e animație de dragul efectului. Dacă un strat
nu poate fi legat de o măsurătoare sau de o lege fizică, poartă eticheta
„interpretive" — sau nu există.

🌍 Live: luminomorphism.ro

#dataviz #WebGL #ThreeJS #NASA #opendata #creativecoding #Luminomorphism

---

## Varianta LinkedIn — EN

I just published **Living Earth Observatory** — a cinematic 3D globe where the
planet's natural events appear in near real-time, straight from open data.

The principle behind it (Luminomorphism): **light is a material, not
decoration.** Every visual element is justified by real data or real physics —
and labeled honestly as such.

**Observed** (measured data):
– Surface: NASA GIBS Blue Marble, shaded relief + bathymetry, 8192×4096
– Night: VIIRS Black Marble (2016), fading exactly at the solar terminator
– Events: NASA EONET, USGS earthquakes, NASA FIRMS wildfires, GDACS alerts

**Physical** (real geometry / simulation):
– Sun and Moon positions (Astronomy Engine), with real lunar libration
– ISS orbit (CelesTrak TLE + SGP4 propagator)
– Day/night terminator, with atmospheric refraction

**Interpretive** (procedural representation, declared as such):
– Airglow, zodiacal light, noctilucent clouds — physically constrained, but not
a live snapshot

Under the hood: runs on a GTX 1650 (4GB) at ~60 FPS median. Three.js / WebGL2,
KTX2/Basis compressed textures (relief 755 → 168 MB VRAM), ACES tone mapping,
half-resolution bloom.

Nothing moving on the globe is animation for effect. If a layer can't be tied to
a measurement or a physical law, it wears the "interpretive" label — or it
doesn't exist.

🌍 Live: luminomorphism.ro

#dataviz #WebGL #ThreeJS #NASA #opendata #creativecoding #Luminomorphism

---

## Varianta scurtă (X / Threads)

Living Earth Observatory e live 🌍

Glob 3D cu evenimente naturale în timp cvasi-real (NASA EONET, USGS, FIRMS,
GDACS), suprafață NASA GIBS 8192×4096, ISS pe orbită reală (SGP4).

Regula: lumina e material, nu decor. Fiecare strat e observat, fizic, sau
etichetat „interpretive". ~60 FPS pe o GTX 1650.

→ luminomorphism.ro

---

## Screenshot-uri pentru post + README (recomandare: 3)

Fă capturile cu panourile ascunse (buton „hide panels" / captura curată) pentru
post, și una cu panoul vizibil pentru README (arată sursele).

1. **Hero — glob întreg, cinematic.** Terra pe partea de zi, cu atmosferă și
   bloom subtil la limb. Poza de titlu.
2. **Zoom regional — dovada de rezoluție.** Un continent/regiune unde se vede
   detaliul Blue Marble 8192×4096 (relief + batimetrie). Contrastul cu vechea
   textură 2160×1080 e argumentul tehnic.
3. **Partea de noapte — Black Marble + evenimente.** Terminatorul solar cu
   luminile VIIRS care se sting la graniță, plus câțiva markeri de eveniment
   (incendii/cutremure) aprinși. Arată „observed" + „physical" într-un cadru.

> Roadmap-ul cerea deja (Sprint 0.1) capturi „înainte" la 3 niveluri de zoom —
> dacă le mai ai, pune-le side-by-side cu cele „după" în README, e cea mai bună
> dovadă a saltului.
