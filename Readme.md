# DutyBack Privacy Shield

A client-side security enclave that removes identifying customs data before ingestion into the DutyBack AI agent on FAU's owlONE platform.
All CSV parsing, deadline calculations, and PII tokenization execute entirely in local browser memory with zero network requests.
Non-allowlisted columns (company names, filer codes, broker notes, addresses) are discarded permanently on your computer.
A multi-pattern safety scan verifies zero emails, phone numbers, ID numbers, or raw entry numbers exist before permitting file export.
Your private key mapping stays on your machine, enabling local restoration without ever exposing proprietary trade data.

---

## Zero-Network Guarantee

- **No Uploads**: No backend servers, no analytics, no tracking pixels, and no remote fonts or CDN dependencies.
- **Strict Headers**: Configured with strict Content Security Policy (`default-src 'none'; script-src 'self'; connect-src 'none'; ...`).
- **Offline Capable**: Save the page as HTML and run it offline (`file://`).

---

## Project Structure

```
dutyback-shield/
├── index.html                   # Polished, accessible UI (semantic HTML5)
├── css/
│   └── styles.css               # FAU brand styling, dark/light modes, animations
├── js/
│   ├── shield-core.js           # Verbatim scrubbing logic from v3
│   ├── sample-data.js           # Embedded fictional Seabreeze sample data
│   └── app.js                   # Client-side UI controller (zero network)
├── assets/
│   ├── favicon.svg              # SVG favicon with FAU security motif
│   └── screenshots/             # Verified screenshots of Hero and Tool views
├── legacy/
│   └── privacy-shield-v3.html   # Preserved original index.html reference
├── tests/
│   ├── run-tests.js             # Automated 7-point Node.js test suite
│   ├── serve.js                 # Local preview server with Vercel CSP headers
│   └── fixtures/                # Fictional CSVs and verified output fixture
├── vercel.json                  # Production headers, cleanUrls, and CSP enforcement
└── README.md                    # Project documentation
```

---

## Running the Automated Test Suite

Run the built-in test suite (zero external dependencies required):

```bash
node tests/run-tests.js
```

### Verified Test Results:
1. **Integrity Self-Test**: Validates core parsing, day counts, tokenizing, and scan output.
2. **Fixture Byte Parity**: Fixture CSVs match `example_attach_this_scrubbed_seabreeze.txt` identically.
3. **Missing Broker Warning**: Displays alert when broker list is omitted.
4. **PII Leak Blocker**: Blocks export and hides controls if planted PII exists in kept columns.
5. **As-Of Date Validation**: Rejects empty dates.
6. **PDF Text Mode**: Tokenizes entities, dates, PO numbers, and redacts emails/phones.
7. **Zero-Network Audit**: Confirms zero `fetch`, `XMLHttpRequest`, `WebSocket`, or external resource URLs.

---

## Local Development & Preview

To preview with full Vercel Content-Security-Policy headers locally:

```bash
node tests/serve.js
```
Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in your browser.

Or simply open `index.html` directly in any web browser (`file:///...`).

---

## Deployment to Vercel

### Option A: Vercel CLI (Fastest)

1. Open a terminal in the project directory:
   ```bash
   cd dutyback-shield
   ```
2. Deploy directly to production:
   ```bash
   npx vercel --prod
   ```
3. Follow the prompts:
   - Set up and deploy: **Yes**
   - Which scope: *(Select your Vercel account)*
   - Link to existing project: **No**
   - Project name: `dutyback-shield` (or your preferred name)
   - In which directory is your code located: `./`
   - Modify settings: **No** (Framework: Other, Build Command: none, Output Directory: root)

### Option B: GitHub + Vercel Dashboard

1. Initialize a git repository and commit:
   ```bash
   git init
   git add .
   git commit -m "feat: DutyBack Privacy Shield production release"
   ```
2. Push to your GitHub repository:
   ```bash
   git remote add origin https://github.com/<your-username>/dutyback-shield.git
   git branch -M main
   git push -u origin main
   ```
3. In [Vercel Dashboard](https://vercel.com/new):
   - Click **Import** next to your `dutyback-shield` repository.
   - **Framework Preset**: Select **Other**.
   - **Build and Output Settings**: Leave empty (Build Command: none, Output Directory: `./`).
   - Click **Deploy**.

### Final Production URL Format
`https://dutyback-shield-<unique-id>.vercel.app` or `https://dutyback-shield.vercel.app`