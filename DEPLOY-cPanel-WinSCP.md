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
`living-protein.html`, `sw.js`, `src/`, `assets/`, `styles/`, `vendor/`),
dar **NU** urcă `.env` (are secrete!), folderul `.git`, documentația,
arhivele zip, folderele de dev și `nasa-proxy-server.js`.

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
- `ETag` sau `Last-Modified`.

Sau din terminal: `curl -I https://luminomorphism.ro/src/main.js`

La a doua reîncărcare, fișierele neschimbate apar cu status `304`.

### Pasul 3 — abia acum urci fișierele

Continuă cu fluxul de la secțiunea 5 (**Synchronize**).

---

## 5. Fluxul de zi cu zi (asta faci mereu)

De fiecare dată când vrei să publici ce ai modificat:

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
| Node.js version | `18.20.8` |
| Config Passenger | `public_html/nasaproxy/.htaccess` — **DO NOT REMOVE** |

Passenger montează aplicația sub prefixul `/nasaproxy` (`PassengerBaseURI`),
deci proxy-ul primește căi ca `/nasaproxy/nasa-proxy`. Proxy-ul scoate exact
acest prefix (`PROXY_BASE_PATH`, implicit `/nasaproxy`) și compară apoi rutele
exact; local merge în continuare `/nasa-proxy`. **Nu** trebuie setat nimic
în cPanel pentru asta.

> Node 18 e fără suport din aprilie 2025. Dacă selectorul din **Setup Node.js
> App** oferă Node **20** sau **22**, alege-l și dă **Restart**. Cât timp
> serverul rămâne pe 18, rulează înainte de fiecare deploy
> `npm run check:proxy-node18` și `npm run smoke:proxy-node18`.

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
