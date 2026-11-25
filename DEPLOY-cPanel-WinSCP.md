# Deploy pe cPanel cu WinSCP — un singur click

Scopul: să urci pe `luminomorphism.ro` doar fișierele modificate, cu un click,
fără base64 / cron / automatizare de browser. Configurezi **o singură dată**,
apoi apeși mereu același buton **Synchronize**.

---

## 0. Date de conexiune (ale tale)

| Câmp | Valoare |
|---|---|
| Host | `luminomorphism.ro` (sau IP: `37.156.180.140`) |
| Utilizator | `luminomorphism` (userul tău de cPanel) |
| Parolă | parola ta de cPanel (o pui tu în WinSCP — eu nu o ating) |
| Protocol | **SFTP** port `22` dacă ai SSH; altfel **FTP** port `21` |
| Folder pe server | `/public_html` |
| Folder local | `D:\Proiecte\Luminomorphism Lab - Generative Science-Art through Code GPT\galaxie-luminomorphism-bloom` |

> Nu știu sigur dacă ai SSH activat. Nu contează: la pasul 2 încearcă întâi
> **SFTP**; dacă refuză conexiunea, schimbă pe **FTP**. Ambele funcționează
> identic cu restul ghidului.

---

## 0b. Obligatoriu înainte de ORICE deploy de site

> **De ce există secțiunea asta.** Pe 11 noiembrie 2026, deploy-ul LOT 1 a urcat
> doar fișierele din `git diff f211a3f..HEAD`, presupunând că serverul e la
> `f211a3f`. Nu era: 9 fișiere nu fuseseră urcate niciodată, iar vreo 18 erau
> versiuni mai vechi. Noul `app-runtime.js` importa `time-scrub-panel.js` și
> `surface-visual-lock.js`, care pe server dădeau `404`. Pagina Earth a rămas
> blocată la ecranul de încărcare până la rollback, câteva minute.

Regulile de mai jos sunt obligatorii, indiferent dacă urci prin arhivă și
cPanel sau prin WinSCP Synchronize.

### Regula 1 — se urcă tot site-ul din HEAD, niciodată un diff

- **Niciodată** o listă de fișiere de tipul `git diff <commit>..HEAD`. Nu știi
  sigur ce e pe server, iar un diff nu urcă fișierele care lipsesc acolo de la
  deploy-uri vechi.
- Arhiva se face din commit, nu din working tree:

  ```bash
  git -c core.autocrlf=false archive --format=zip -o exports/deploy-<lot>.zip HEAD -- \
    src styles index.html earth-eonet-relief.html living-protein.html living-himalaya.html sw.js     assets/himalaya assets/sky assets/moon assets/earth assets/fonts lib
  ```

  Plus un manifest `<sha256>  <cale>`, calculat din conținutul arhivei.

  > ⚠️ `-c core.autocrlf=false` e obligatoriu pe Windows. Fără el, `git archive`
  > convertește toate fișierele la CRLF, iar arhiva nu mai e identică cu HEAD.
  > Verificare: niciun fișier din arhivă nu conține `\r`.
- **Excepție: `assets/himalaya/` se promovează împreună cu `src/`, `styles/` și
  paginile** (din Himalaya Lot 2). Conține patch-urile de teren GLO-30
  (`glo30-<vârf>-<hash>.ktx2`, ~10 MB) la care trimite
  `src/config/himalaya-terrain-patches.js`; un cod nou fără patch-urile lui
  dă `404` la teren. Numele au hash-ul conținutului, deci un fișier nou nu
  suprascrie niciodată unul vechi. În raportul de deploy listezi separat
  fiecare fișier din `assets/himalaya/` cu mărime și SHA-256.
- **Excepție: `assets/sky/` se promovează la fel** (din Lot 15, cerul real
  Living Earth). Conține hărțile Căii Lactee (`milkyway-2020-luminance-<hash>.ktx2`,
  `milkyway-2020-chroma-<hash>.ktx2`, ~6,6 MB) și stelele
  (`hyg-v44-stars-<hash>.bin`), la care trimit `src/config/sky-map.js` și
  `src/config/sky-stars.js`; fără ele cerul cade pe fallback. Pe producție e un
  folder nou la primul deploy; la update-uri se copiază fișier cu fișier (numele
  au hash-ul conținutului, deci nu suprascriu nimic vechi). Listezi separat
  fiecare fișier din `assets/sky/` cu mărime și SHA-256. `tmp/sky/` (EXR-urile
  NASA SVS, HYG brut) nu intră niciodată în arhivă.
- **Excepție: `assets/moon/`, `assets/earth/` și `assets/fonts/` se promovează la fel**
  (din Lot 30). `assets/moon/`: culoarea LROC 4K și harta normală LOLA ale Lunii
  (`moon-lroc-color-4k-<hash>.jpg`, `moon-lola-normal-4k-<hash>.jpg`, ~5,7 MB), la care
  trimit `src/config/moon-color.js` și `src/config/moon-normal.js`. `assets/earth/`:
  Black Marble 2016, norii Blue Marble și masca speculară
  (`black-marble-2016-3600x1800-<hash>.jpg`, `blue-marble-clouds-2048x1024-<hash>.jpg`,
  `specular-mod44w-2160x1080-<hash>.png`, ~1,9 MB), din `src/config/earth-local-textures.js`.
  `assets/fonts/`: Inter (`inter-4.1-var-<hash>.woff2`, ~0,2 MB) și `OFL.txt`, din
  `styles/inter.css`. Fără ele Luna rămâne fără culoare 4K (cade pe LROC 1K), Pământul
  fără lumini de noapte / nori / speculară, iar textul cade pe fontul de sistem.
  Pe producție sunt foldere noi la primul deploy; la update-uri se copiază fișier cu
  fișier (numele au hash-ul conținutului; `OFL.txt` nu se schimbă). Listezi separat
  fiecare fișier din cele trei foldere cu mărime și SHA-256. Brutul descărcat
  (`tmp/lot30/raw/`: TIFF-urile SVS, JPEG-urile NASA, arhiva Inter) nu intră niciodată
  în arhivă. În staging verifici în Network că `.woff2` vine cu `200` și un
  `Content-Type` de font (`font/woff2`); dacă serverul nu-l recunoaște, oprești deploy-ul
  și întrebi (nu se adaugă `.htaccess` fără decizie).
  După promovarea Lot 30 nu devine mort niciun fișier de pe producție: texturile vechi
  veneau de pe threejs.org / jsDelivr (nu de pe server), iar `assets/moon-lroc-color-1k-1024x512.jpg`
  (fallback etichetat) și `assets/moon-ldem-elevation-1024x512.jpg` (relief) rămân folosite.
- **Excepție: `lib/` intră în arhivă și se promovează ca folder** (din Lot 37).
  Conține bibliotecile JS servite local, în loc de unpkg / jsDelivr / esm.sh:
  `lib/three@0.185.1/`, `lib/earcut@2.2.4/`, `lib/astronomy-engine@2.1.19/`,
  `lib/satellite.js@6.0.2/` (35 de fișiere, ~2,97 MB, plus `lib/MANIFEST.json`
  cu SHA-256 pentru fiecare fișier și integritatea npm a fiecărui pachet). Import
  map-urile din `earth-eonet-relief.html`, `living-himalaya.html` și
  `living-protein.html`, plus `src/earth/astronomy-runtime.js` și
  `src/earth/iss-system.js`, trimit **doar** acolo, fără fallback pe CDN: un cod
  nou fără `lib/` dă `404` la `three` și pagina rămâne neagră. Folderele au versiunea
  în nume, deci o versiune nouă e un folder nou și nu suprascrie nimic vechi; la
  primul deploy `lib/` e un folder nou pe producție. Fișierele se refac doar cu
  `node tools/vendor-libs.mjs <tarball-uri>` (vezi `tests/lib-vendor.test.js`), niciodată
  de mână. În raportul de deploy listezi separat fiecare fișier din `lib/` cu mărime
  și SHA-256 (sunt deja în `lib/MANIFEST.json`) și verifici că sunt identice.
  `LICENSE` / `LICENSE.md` din fiecare `lib/<pachet>@<versiune>/` trebuie să
  ajungă pe server (licențele MIT / ISC cer păstrarea notiței cu codul distribuit).
- `vendor/` rămâne exact ca până acum (Lot 37 nu îl atinge): `vendor/basis/`
  (transcoderul Basis pentru KTX2) nu intră în arhivă.
- Restul `assets/` și `vendor/` (fișiere mari) nu intră în arhivă. Le compari separat
  cu serverul (`git ls-tree -r -l HEAD -- assets vendor` față de lista de pe
  server) și le urci doar dacă diferă.
- **Dacă folosești WinSCP Synchronize**, acesta urcă *working tree*-ul, nu
  HEAD. E sigur doar dacă working tree-ul e identic cu HEAD pe căile site-ului:

  ```bash
  git status --porcelain -- src styles index.html earth-eonet-relief.html living-protein.html living-himalaya.html sw.js assets/himalaya assets/sky assets/moon assets/earth assets/fonts lib
  ```

  Comanda trebuie să nu afișeze nimic. Altfel faci commit sau stash înainte, ori
  folosești arhiva. În Synchronize, la **Comparison criteria**, alege
  **Checksum** dacă e disponibil (pe SFTP); altfel **Modification time +
  File size**.

### Regula 2 — graful de importuri trebuie să fie complet

Înainte de orice upload, verifici că fiecare import relativ (`import … from
'./…'`, `import('./…')`, `<script src>`) din fișierele urcate duce la un
fișier care există fie în arhivă, fie deja pe server. Un singur `404` pe un
modul oprește tot graful de module, iar pagina rămâne neagră.

Specificatorii simpli (`three`, `three/addons/…`, `earcut`) se rezolvă prin
import map-ul din HTML în `./lib/…` (din Lot 37) și **intră** în verificare: fiecare
țintă a import map-ului și fiecare import relativ din `lib/` trebuie să existe în
arhivă. `npm run check:origins` pică dacă reapare un CDN de biblioteci (unpkg.com,
cdn.jsdelivr.net, esm.sh).

### Regula 3 — întâi staging pe server, apoi producția

1. **Backup în afara site-ului:** în cPanel → File Manager, copiază `src/`,
   `styles/`, `assets/himalaya/`, `assets/sky/`, `assets/moon/`, `assets/earth/`, `assets/fonts/`, `lib/` (cele care există deja), cele 4 HTML-uri și `sw.js` în
   `/home/luminomorphism/deploy-backups/<lot>-<AAAALLZZ>/`. Nu pune backup-ul
   în `public_html`.
2. Creează `public_html/_staging-<lot>/` și copiază în el `assets/` și
   `vendor/` (paginile le referă relativ). `assets/himalaya/`, `assets/sky/`, `assets/moon/`, `assets/earth/`, `assets/fonts/` și `lib/` vin
   din arhivă, peste această copie.
3. Urcă arhiva în `_staging-<lot>/` și dezarhiveaz-o acolo.
4. Deschide `https://luminomorphism.ro/_staging-<lot>/earth-eonet-relief.html`,
   apoi `/_staging-<lot>/index.html`, `/_staging-<lot>/living-protein.html` și
   `/_staging-<lot>/living-himalaya.html` (din Himalaya Lot 1).
   Pentru fiecare pagină, în DevTools verifici:
   - niciun `404` în Network;
   - niciun modul încărcat de două ori (același fișier cu `?v=` diferite);
   - canvasul randează, iar datele se încarcă.
5. **Doar dacă trec toate patru:** dezarhivezi aceeași arhivă peste
   `public_html`.

### Regula 4 — data fișierelor după dezarhivare

Serverul trimite doar `Last-Modified`, **fără `ETag`**. `unzip` păstrează data
din arhivă, adică data commit-ului. Dacă un browser are în cache o versiune cu
`Last-Modified` mai nou decât commit-ul (de exemplu după un rollback), serverul
îi răspunde `304` și browserul rămâne pe versiunea veche, deși fișierul de pe
server e nou.

De aceea, după ce ai dezarhivat în producție, **copiezi fișierele din
`_staging-<lot>/` peste `public_html`** cu File Manager → Copy. Copierea pe
server le dă data curentă. Apoi verifici într-un browser care a mai deschis
site-ul (fără `Ctrl+Shift+R`) că pagina e cea nouă.

### Regula 5 — verificare după deploy și curățenie

- Fiecare fișier din manifest, cerut de pe site cu `cache: 'no-store'`, are
  hash-ul din manifest.
- Earth, Atlas și Protein se încarcă de la adresele de producție, cu aceleași
  criterii ca la staging.
- Proxy: `GET /nasaproxy/nasa-proxy?source=gdacs|gvp|firms` răspunde `200`.
- Ștergi `_staging-<lot>/` și toate arhivele `.zip` din `public_html`, fiindcă
  sunt publice.
- **Ștergerea e definitivă, nu în Coș** — o faci abia după promovare și după
  ce hash-ul agregat al fișierelor de pe producție e identic cu manifestul. În
  cPanel → File Manager → Delete bifezi **„Skip the trash and permanently delete
  the files”** (sau golești Coșul imediat după). Contul are o cotă de
  **1000 MB**, iar un staging cu `assets/` are câteva sute de MB; în Coș ocupă
  la fel de mult.

  > **Incident 2026-11-18:** staging-urile șterse anterior ajunseseră în Coș și
  > au umplut cota; la dezarhivare cPanel a dat **„quota exceeded”**.
  > Rezolvare: Coșul golit, după care contul a coborât la **254 MB** folosiți.
  > De atunci: staging-ul se șterge definitiv, iar înainte de dezarhivare
  > verifici spațiul liber (cPanel → Disk Usage).

### Regula 6 — CSS schimbat = `?v=` nou în HTML (Lot 25)

Politica de cache constatată pe producție (2026-11-19, din antetele răspunsurilor):

- `.js`, `.mjs`, `.html`: `Cache-Control: no-cache` (regula din secțiunea 4b).
  Browserul revalidează la fiecare încărcare, deci nu se pot amesteca module
  vechi și noi.
- `.css`: `public, max-age=604800` (7 zile). Un vizitator care a mai fost pe
  site păstrează CSS-ul vechi până la 7 zile, cât timp URL-ul nu se schimbă.
- Asset-urile din `assets/himalaya/`, `assets/sky/`, `assets/moon/`, `assets/earth/` și `assets/fonts/` au hash-ul conținutului
  în nume: un fișier nou are alt URL.
- `lib/<pachet>@<versiune>/…` (din Lot 37) are versiunea în cale: o versiune nouă are
  alt URL. Ca orice `.js`, vine cu `no-cache` (revalidare la fiecare încărcare).
  `sw.js` le trece prin `networkFirstShell` (scripturi same-origin), ca pe `src/`.

Regula: dacă `styles/X.css` diferă de deploy-ul anterior, fiecare HTML care îl
referea trebuie să îl refere acum cu alt `?v=` decât în snapshot-ul anterior.
Un stylesheet nou, sau referit pentru prima dată de o pagină, nu are nevoie de
bump.

Verificarea e automată și se face după ce ai creat arhiva și manifestul:

```bash
node tools/check-css-cache-bust.mjs --zip exports/deploy-<lot>.zip
# sau: npm run check:css-cache -- --zip exports/deploy-<lot>.zip
```

Scriptul compară arhiva nouă cu cel mai recent `exports/deploy-*.manifest.txt`
(și cu arhiva `.zip` de lângă el, din care ia `?v=` vechi). Cu
`--previous exports/deploy-<lot-anterior>` alegi explicit snapshot-ul anterior.
Dacă eșuează, mesajul numește CSS-ul, HTML-ul și `?v=` vechi. Atunci schimbi
`?v=` în HTML, faci commit și refaci arhiva. `.htaccess` nu se atinge pentru
asta.

> Verificat pe arhivele vechi: garda ar fi oprit deploy-himalaya-12 (Lot 15b +
> Lot 18: `styles/himalaya.css` schimbat, dar `living-himalaya.html` încă pe
> `?v=himalayaLot14`). Acceptă însă deploy-himalaya-15 (Lot 21: `main.css` cu
> `?v=atlasLot21` în loc de `atlasEarthMount1`).

### Rollback

Copiezi fișierele din `deploy-backups/<lot>-<AAAALLZZ>/` înapoi peste
`public_html`, director cu director, și verifici că dimensiunile coincid cu
backup-ul. Copierea le dă data curentă, deci browserele primesc imediat
versiunea restaurată. Fișierele noi pe care codul vechi nu le importă pot
rămâne; nu strică nimic.

---

## 1. Instalează WinSCP (o dată)

Descarcă de pe `https://winscp.net` → instalează (Next → Next → Finish).
E gratuit, în română, ușor.

---

## 2. Creează sesiunea salvată (o dată)

La pornire apare fereastra **Login**:

1. **File protocol:** alege `SFTP`. (Dacă la Login dă eroare de conexiune,
   revii și alegi `FTP`.)
2. **Host name:** `luminomorphism.ro`
3. **Port number:** `22` pentru SFTP, sau `21` pentru FTP.
4. **User name:** `luminomorphism`
5. **Password:** parola ta de cPanel.
6. Apasă **Save** → dă-i un nume (ex. `Luminomorphism`) → bifează
   **Save password** dacă vrei să nu o mai tastezi → OK.
7. **Login.**

Prima dată te întreabă despre cheia serverului (SSH host key) → **Yes/Accept**.

---

## 3. Setează folderele (o dată)

După conectare, WinSCP arată două panouri: stânga = calculatorul tău,
dreapta = serverul.

- **Stânga (local):** navighează în
  `...\galaxie-luminomorphism-bloom`
- **Dreapta (server):** intră în `public_html`

WinSCP ține minte ultimul folder, deci data viitoare o să fie deja acolo.

---

## 4. Configurează sincronizarea sigură (o dată)

Meniu: **Commands → Synchronize...** (sau butonul „Synchronize" din bara de sus).

Setează exact așa:

- **Local directory:** `...\galaxie-luminomorphism-bloom`
- **Remote directory:** `/public_html`
- **Direction / Target directory:** `Remote` (ținta e serverul → urcă local → server).
  ⚠️ NU alege `Local` — ăla trage de pe server peste fișierele tale locale.
- **Mode:** `Synchronize files` (NU `Mirror` — Mirror poate șterge).
- **Synchronize options:**
  - ✅ **Preview changes** (îți arată lista înainte de upload)
  - ❌ **Existing files only** — **DEBIFAT.** Bifat = urcă doar fișiere care
    există deja pe server (sare peste cele noi). Debifat = urcă și modificate,
    și noi.
  - ❌ **Delete files** — **LASĂ DEBIFAT.** Foarte important: așa NU șterge
    de pe server fișiere care nu există local (ex. `nasaproxy/`, aplicația
    proxy, alte fișiere puse direct pe server).
  - ✅ **Use same options next time** (reține setările pentru data viitoare)

### Masca de excludere (ca să nu urci gunoaie sau secrete)

La **Synchronize → butonul „Transfer settings..." → câmpul „File mask"**,
lipește exact:

```
| .env; .env.*; .git/; .gitignore; LICENSE; .claude/; .agents/; .codex-analysis/; .codex-validation/; _deploy_cpanel/; proxy-cache/; tmp/; exports/; releases/; Up/; Back Up/; docs/; tools/; nasa-proxy-server.js; *.md; *.pdf; *.docx; *.zip
```

Ce face: urcă tot site-ul (`index.html`, `earth-eonet-relief.html`,
`living-protein.html`, `living-himalaya.html`, `sw.js`, `src/`, `assets/`, `styles/`, `vendor/`, `lib/`),
dar **NU** urcă `.env` (are secrete!), folderul `.git`, documentația,
arhivele zip, folderele de dev și `nasa-proxy-server.js`.

> ⚠️ Masca exclude `LICENSE` și `*.md` în orice folder, deci și licențele din `lib/`
> (`lib/*/LICENSE`, `lib/satellite.js@6.0.2/LICENSE.md`). Pentru `lib/` folosești
> arhiva (Regula 1), sau urci acele patru fișiere separat și verifici că sunt pe
> server. Masca nu se schimbă fără decizie.

> `.env` conține chei/secrete — de-aia e prima în listă. Nu trebuie NICIODATĂ
> să ajungă în `public_html`, unde ar putea fi accesat public.

Apasă **OK**. WinSCP îți arată o **previzualizare** cu ce urmează să urce —
uită-te o secundă peste listă, apoi **OK** ca să confirme.

---

## 4b. Revalidarea fișierelor `.js` / `.html` (o dată, ÎNAINTE de upload)

De ce: modulele din `src/` se importă acum fără `?v=...`, ca fiecare modul să
existe o singură dată în browser. Fără tag, browserul ar putea servi un modul
vechi din cache după un deploy. Regula de mai jos îi cere să întrebe serverul
la fiecare încărcare dacă fișierul s-a schimbat; dacă nu, primește un răspuns
mic `304 Not Modified` (verificare prin ETag / Last-Modified).

**Ordinea e obligatorie: întâi `.htaccess` pe server, abia apoi fișierele.**

### Pasul 1 — `.htaccess` pe server, din cPanel File Manager

1. cPanel → **File Manager** → `public_html`.
2. **Settings** (dreapta sus) → bifează **Show Hidden Files (dotfiles)** → Save.
3. Click dreapta pe `.htaccess` → **Edit**. Înainte să adaugi ceva, caută
   reguli de cache existente:
   - `ExpiresActive`, `ExpiresByType`, `ExpiresDefault` (modulul `mod_expires`);
   - orice `Header set Cache-Control` sau `max-age` care prind
     `application/javascript`, `text/javascript`, `text/html` ori `.js` / `.html`.

   Dacă există reguli de acest tip pentru JS sau HTML, scoate-le (sau notează-le)
   — altfel pot da `max-age` în paralel cu regula nouă. Verificarea de la pasul 2
   îți arată dacă au rămas efecte.

   > Verificat pe server: în `public_html/.htaccess`, `mod_expires` acoperă doar
   > `ktx2`, `wasm`, `jpeg` și `png` — nu intră în conflict cu regula pentru
   > `.js` / `.html`.
4. Adaugă la final blocul:

   ```apache
   <IfModule mod_headers.c>
     <FilesMatch "\.(js|mjs|html)$">
       Header set Cache-Control "no-cache"
     </FilesMatch>
   </IfModule>
   ```

5. **Save Changes**.

> ⚠️ Editează `.htaccess` **doar pe server**. Nu crea un `.htaccess` în folderul
> local: la Synchronize ar suprascrie fișierul de pe server, care conține și
> alte reguli.
>
> Dacă după salvare site-ul dă `500 Internal Server Error`, scoate blocul și
> salvează din nou — e o greșeală de sintaxă în `.htaccess`.

### Pasul 2 — verifică antetul

În browser, pe `https://luminomorphism.ro/`: DevTools (`F12`) → **Network** →
reîncarcă → click pe `main.js` → **Response Headers**. Trebuie să vezi:

- `Cache-Control: no-cache` (fără `max-age=...`);
- `Last-Modified`. Verificat pe 11 noiembrie 2026: serverul **nu** trimite
  `ETag`, deci revalidarea se face doar după dată. Vezi capcana de la
  secțiunea 0b, regula 4.

Sau din terminal: `curl -I https://luminomorphism.ro/src/main.js`

La a doua reîncărcare, fișierele neschimbate apar cu status `304`.

### Pasul 3 — abia acum urci fișierele

Continuă cu fluxul de la secțiunea 5 (**Synchronize**).

---

## 5. Fluxul de zi cu zi (asta faci mereu)

De fiecare dată când vrei să publici ce ai modificat:

0. **Parcurge secțiunea 0b.** Synchronize e permis doar dacă `git status
   --porcelain` pe căile site-ului nu afișează nimic și ai verificat graful de
   importuri.
1. Deschide WinSCP → dublu-click pe sesiunea `Luminomorphism`.
2. Apasă **Synchronize** (setările de la pasul 4 rămân memorate).
3. Confirmă previzualizarea → gata. Urcă doar fișierele schimbate.

Apoi pe site: `Ctrl+Shift+R` (hard refresh) ca să vezi noua versiune.

### Cum citești preview-ul (ca să nu te sperii)

- **Săgeată verde (➡)** = fișier care se **urcă** (local → server). Astea sunt
  modificările tale.
- **X roșu** = fișier care există **doar pe server**, nu și local. Fiindcă ai
  **„Delete files" debifat**, aceste fișiere **NU se șterg** — sunt doar
  afișate. Aici intră fișiere importante puse direct pe server (`.htaccess`,
  `.well-known/`, `cgi-bin/`, `nasaproxy/` = proxy-ul) și vechituri
  (`.bak`, `.tmp`). Le lași în pace.
- Preview-ul arată **doar diferențele**. Dacă un fișier al site-ului nu apare,
  înseamnă că e deja identic pe server — perfect normal.
- Verifică mereu că printre uploaduri (verzi) **nu** e `.env`.

---

## 6. Bonus — „urcă automat când salvez" (opțional)

Dacă vrei să nu apeși nimic: meniu **Commands → Keep Remote Directory up to
Date...** cu aceleași setări (Local → Remote, Delete debifat, aceeași mască).
WinSCP urmărește folderul local și urcă automat orice fișier de îndată ce îl
salvezi. Îl pornești o dată la începutul sesiunii de lucru.

---

## 7. Ce s-a schimbat față de metoda veche

Înainte, eu urcam prin automatizare de browser (base64 → fișier staging →
cron temporar care decodează → verificare → curățare). Funcționa, dar era lent
și fragil (tab-uri înghețate, sesiuni cPanel expirate, browsere diferite).

Cu WinSCP, tu urci direct prin FTP/SFTP — instant, robust, și vezi exact ce
pleacă. Eu rămân doar cu partea de **editat fișierele local**; publicarea o
faci tu cu un click.

> Notă: eu, din mediul meu, nu pot urca direct prin FTP la serverul tău
> (rețea restricționată), de-aceea uploadul pleacă de pe calculatorul tău.
> Dar acum e trivial.

---

## 8. Proxy-ul NASA (cPanel → Setup Node.js App)

**Sursa unică este `nasa-proxy-server.js` din rădăcina repo-ului.**
Folderul `_deploy_cpanel/` NU mai e sursa: conține o variantă veche (fără
limită de concurență pentru H.264, fără verificarea Origin, fără cache TTL),
ignorată de git. Nu mai copia nimic de acolo pe server.

Masca de la pasul 4 exclude `nasa-proxy-server.js`, deci **Synchronize nu
urcă proxy-ul**. Fișierul se înlocuiește manual, cu pașii de mai jos.

### Configurația de pe server (verificată)

| Câmp | Valoare |
|---|---|
| Application URL | `luminomorphism.ro/nasaproxy` |
| Application root | `/home/luminomorphism/nasa-proxy` |
| Application startup file | `nasa-proxy-server.js` |
| Node.js version | `22.23.4` (de pe 11 noiembrie 2026; înainte `18.20.8`) |
| Binar Node (Passenger) | `/home/luminomorphism/nodevenv/nasa-proxy/22/bin/node` |
| Config Passenger | `public_html/nasaproxy/.htaccess` — **DO NOT REMOVE** |

Passenger montează aplicația sub prefixul `/nasaproxy` (`PassengerBaseURI`),
deci proxy-ul primește căi ca `/nasaproxy/nasa-proxy`. Proxy-ul scoate exact
acest prefix (`PROXY_BASE_PATH`, implicit `/nasaproxy`) și compară apoi rutele
exact; local merge în continuare `/nasa-proxy`. **Nu** trebuie setat nimic
în cPanel pentru asta.

**`PORT` e un socket, nu un număr.** Sub LiteSpeed/Passenger, aplicația
primește în `PORT` calea unui socket Unix. Proxy-ul ascultă exact pe acea cale
(fără `HOST`); doar o valoare formată numai din cifre e tratată ca port TCP.
Deploy-ul `7bb6c15` a dat `503` tocmai pentru că transforma calea în `8787` și
asculta pe TCP, unde LiteSpeed nu găsea aplicația. `npm run smoke:proxy-node18`
acoperă acum și acest caz (socket Unix pe Linux, named pipe pe Windows).

**Startup file-ul e încărcat prin `require()`, nu rulat cu `node fișier`.**
LiteSpeed (`lsnode.js`) și Passenger fac `require()` pe
`nasa-proxy-server.js`, deci proxy-ul pornește serverul necondiționat la
încărcare. Deploy-ul `1f23100` a dat tot `503` pentru că pornea doar când
`require.main === module`, ceea ce în producție e fals. Smoke-ul include
acum exact acest caz: loader cu `require()`, `PORT` socket, fără `HOST`.

> ⚠️ **`NASA_PROXY_NO_LISTEN` nu se setează niciodată pe server.** Variabila
> există doar pentru testele care importă proxy-ul ca bibliotecă (o setează
> `vitest.config.mjs`); cu ea setată, proxy-ul nu ascultă și site-ul primește
> `503`.

> **Serverul rulează Node 22.23.4** din 11 noiembrie 2026. Comutarea s-a făcut
> din **Setup Node.js App** → versiune → **Save** → **Restart**. Proxy-ul nu
> are dependențe npm (`package.json` are `dependencies: {}`), deci nu e nevoie
> de **Run NPM Install**. Verificat după restart: GDACS, GVP și FIRMS au
> răspuns `200`, `POST /convert-h264` a dat `404`, iar `stderr.log` nu are
> erori noi.
>
> Rollback: aceeași procedură, cu versiunea `18.20.8`. Smoke-urile
> `check:proxy-node18` și `smoke:proxy-node18` rămân utile: garantează că
> fișierul merge și pe 18, ca rollback-ul să fie sigur.

### Variabile de mediu (Setup Node.js App → aplicația → Environment variables)

Acum pe server există doar `FIRMS_MAP_KEY`.

| Variabilă | Ce faci | Valoare |
|---|---|---|
| `FIRMS_MAP_KEY` | există deja — nu o schimba | cheia ta FIRMS (doar în cPanel, niciodată într-un fișier urcat) |
| `ALLOWED_ORIGINS_EXTRA` | **de adăugat** | `https://luminomorphism.ro,https://www.luminomorphism.ro` |

- Valoarea pentru `ALLOWED_ORIGINS_EXTRA` se scrie exact așa: `https://`, fără
  `/` la final, separate prin virgulă. O intrare greșită e ignorată, cu
  avertisment în log.
- **Nu seta `H264_ENABLED`.** H.264 e dezactivat implicit; se activează doar
  local, în `.env`.
- **`HOST` nu are rol** pe server (Passenger alege adresa); nu o seta.
- `PROXY_BASE_PATH` și `PROXY_MAX_UPSTREAM_BYTES` nu se setează; valorile
  implicite (`/nasaproxy`, 64 MB) sunt cele corecte.

Dacă pe server există și un fișier `.env` lângă proxy, variabilele din cPanel
au prioritate (proxy-ul completează din `.env` doar ce lipsește).

### Pași de înlocuire a fișierului de pe server

1. Local, înainte: `npm run verify:f0`, `npm run check:proxy-node18`,
   `npm run smoke:proxy-node18` — toate cu exit 0.
2. cPanel → **Setup Node.js App** → aplicația `luminomorphism.ro/nasaproxy` →
   adaugă `ALLOWED_ORIGINS_EXTRA` → **Save**.
3. **File Manager** → `/home/luminomorphism/nasa-proxy` → redenumește
   `nasa-proxy-server.js` în `nasa-proxy-server.js.bak-AAAALLZZ` (backup).
4. Urcă `nasa-proxy-server.js` din repo în `/home/luminomorphism/nasa-proxy`
   (File Manager → Upload, sau drag & drop manual în WinSCP — **nu**
   Synchronize, care lucrează pe `public_html`).
5. Șterge de pe server `nasa-proxy-server.js.b64`, rămas de la metoda veche de
   upload (aplicația nu îl folosește).
6. **Setup Node.js App** → **Restart**.
7. Verifică (nu afișa și nu copia cheia FIRMS):
   - `GET https://luminomorphism.ro/nasaproxy/nasa-proxy?source=gvp` → `200`,
     `proxyStatus` `live`; reîncărcat imediat → `cache-fresh`. (Dacă varianta
     veche a cerut GVP în ultimele 24 h, chiar primul răspuns poate fi deja
     `cache-fresh` — e normal.)
   - `POST https://luminomorphism.ro/nasaproxy/convert-h264` → `404`
     (de ex. `curl -i -X POST https://luminomorphism.ro/nasaproxy/convert-h264`).
   - În site: straturile GDACS, FIRMS și GVP se încarcă; în DevTools →
     Console nu apar erori pentru `nasaproxy`.
8. Dacă ceva nu merge: șterge fișierul nou, redenumește backup-ul înapoi în
   `nasa-proxy-server.js`, **Restart**.
