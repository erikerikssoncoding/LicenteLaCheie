# Licente la Cheie — Platforma pentru lucrari de licenta

Platforma complet integrata pentru gestionarea serviciilor de redactare lucrari de licenta, dizertatii si proiecte academice. Aplicatia ruleaza pe Node.js, utilizeaza o baza de date MySQL/MariaDB si ofera un panou de control pentru clienti, redactori, admini si superadmini.

## Functionalitati principale

- **Website optimizat SEO** pentru cuvantul cheie „lucrari de licenta”, cu pagini dedicate (Acasa, Servicii, Despre noi, Oferta, Contact).
- **Panou de control securizat** cu autentificare pe roluri (client, redactor, admin, superadmin).
- **Ticketing inteligent** in contul clientului, cu posibilitatea de a raspunde si de a actualiza statusul de catre echipa.
- **Management de proiecte**: adminii/superadminii pot crea proiecte, aloca redactori si urmari statusul redactarii.
- **Generare oferta & contract**: solicitarea de oferta creeaza automat un ticket dedicat, un cont de client si gestioneaza negocierile (oferta, acceptare, contraoferta) cu termene de expirare configurabile.
- **Contact si lead management**: formular de contact salvat in baza de date pentru urmarire ulterioara.
- **Securitate imbunatatita**: HTTPS enforcement, sesiuni stocate in baza de date, middleware CSRF, Helmet si validari cu Zod.
- **Scripturi CLI** pentru instalare initiala si actualizari ale schemei bazei de date.

## Cerinte de sistem

- Node.js 18+ (LTS recomandat).
- NPM 9+.
- MySQL 8+ sau MariaDB 10.5+.
- Acces la un certificat TLS valabil (pentru productie se recomanda folosirea unui reverse proxy Nginx/Traefik cu Let’s Encrypt).

## Instalare rapida (one-click setup)

1. **Clonati repository-ul**:

   ```bash
   git clone https://github.com/organizatie/licente-la-cheie.git
   cd licente-la-cheie
   ```

2. **Instalati dependintele Node.js** (este necesara conectivitate la registry-ul npm):

   ```bash
   npm install
   ```

3. **Rulati scriptul de instalare**. Acesta creeaza fisierul `.env`, configureaza baza de date, ruleaza migratiile si poate genera un superadmin.

   ```bash
   node scripts/install.js
   ```

   Veti fi ghidati sa introduceti:

   - Host/port pentru MySQL
   - Credentiale DB
   - Numele bazei de date (se creaza automat daca nu exista)
   - Portul aplicatiei
   - Cheia secreta pentru sesiuni
   - Optional: datele unui cont superadmin (e-mail, telefon, parola)

4. **Porniti aplicatia in productie** (modul server):

   ```bash
   npm run start
   ```

   Pentru dezvoltare cu reload automat:

   ```bash
   npm run dev
   ```

5. **Configurati HTTPS** la nivel de reverse proxy. Exemplu minimal Nginx:

   ```nginx
   server {
       listen 443 ssl;
       server_name licentelacheie.ro;

       ssl_certificate /etc/letsencrypt/live/licentelacheie.ro/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/licentelacheie.ro/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto https;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

   In `.env` este setat `ENFORCE_HTTPS=true`, astfel incat traficul HTTP este redirectionat automat.

## Structura proiectului

```
├─ src/
│  ├─ server.js                # Entry point Express
│  ├─ config/                  # Configurari DB & sesiuni
│  ├─ middleware/              # Middleware autentificare
│  ├─ routes/                  # Rute publice, auth, dashboard
│  ├─ services/                # Logica aplicatie (user, proiecte, etc.)
│  └─ views/                   # Sabloane EJS (pagini, partiale)
├─ public/                     # Active statice (CSS, JS)
├─ migrations/                 # Scripturi SQL versionate
├─ scripts/                    # CLI pentru instalare & update
├─ .env.example                # Exemplu configuratie
└─ README.md
```

## Gestionarea bazei de date

- Pentru **actualizari ulterioare** ale schemei (migratii noi) rulati scriptul one-click:

  ```bash
  node scripts/update-db.js
  ```

- Noua migratie se adauga in directorul `migrations/` cu un nume incremental (`002_feature.sql`) si scriptul se ocupa de aplicarea doar a fisierelor neexecutate.

## Roluri si permisiuni

| Rol         | Capabilitati principale |
|-------------|-------------------------|
| Client      | Vizualizare proiecte, status, deschidere/raspuns tichete, generare contract |
| Redactor    | Vizualizare proiecte alocate, actualizare status si note, raspuns la tichete |
| Admin       | Creare proiecte, alocare echipa, gestionare tichete, vizualizare clienti |
| Superadmin  | Toate drepturile (inclusiv management utilizatori viitor) |

Sesiunile sunt stocate in MySQL, parolele sunt hash-uite cu bcryptjs (cost 12), iar middleware-urile Helmet, CSRF si rate limiting (nivel browser cu cookies HttpOnly) contribuie la securizare.

## Fluxuri principale

1. **Clientul viziteaza website-ul** si trimite formularul de oferta (acceptand crearea contului).
2. Platforma creeaza automat contul clientului, ticketul de negociere si codul de oferta.
3. Administratorul propune oferta cu valoare si termen de expirare (minim 12h) direct in ticket.
4. Clientul poate accepta, refuza sau trimite contraoferta (cu fereastra de 30 de minute), iar discutiile raman in ticket.
5. Dupa acceptare, contractul personalizat este disponibil online si poate fi urmat de alocarea proiectului.

## Cum adaug un redactor, client sau admin?

- Autentifica-te ca admin/superadmin si acceseaza modulul **Administrare utilizatori** din panoul de control.
- Completeaza formularul de creare cont: nume, email, telefon si rol (`client`, `redactor`, `admin` sau `superadmin` — ultimul doar pentru superadmini). Parola temporara se genereaza automat si este afisata dupa salvare.
- Pentru clientii existenti poti filtra dupa rol/status, iar conturile pot fi activate/dezactivate sau li se poate schimba rolul.

## Testare si mentenanta

- Folositi `npm run dev` pentru a testa functionalitatile local.
- Utilizati `node scripts/update-db.js` pe productie inainte de a face deploy cand apar migratii noi.
- Asigurati backup-uri regulate pentru baza de date MySQL si rotirea log-urilor aplicatiei.

## Protectia datelor si securitate

- Utilizati parole puternice si schimbati `SESSION_SECRET` in productie.
- Activati HTTPS si setati `Secure` pe cookie-uri (deja activ cand `NODE_ENV=production`).
- Recomandam integrarea unui WAF si configurarea reCaptcha pentru formularele publice daca traficul creste.

## Probleme cunoscute / Limitari

- Pentru notificari e-mail/SMS este necesara integrare suplimentara (Sendinblue, Twilio etc.).

## Contributii

1. Fork & clone
2. Creaza branch nou
3. Ruleaza `npm run lint` (optional) si adauga teste daca este cazul
4. Deschide pull request cu descriere detaliata

---

Platforma Licente la Cheie este construita pentru a oferi o experienta premium studentilor si partenerilor academici, cu accent pe calitate, securitate si automatizare a proceselor cheie.
