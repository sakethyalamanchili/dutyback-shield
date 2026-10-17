/**
 * DutyBack Privacy Shield - Test Suite
 * Validates integrity self-test, fixture parity, leak scanning, and zero-network compliance.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('====================================================');
console.log('Running DutyBack Privacy Shield Test Suite');
console.log('====================================================\n');

// 1. Load Shield core in sandbox VM
const corePath = path.resolve(__dirname, '../js/shield-core.js');
const coreCode = fs.readFileSync(corePath, 'utf8');
const context = {};
vm.createContext(context);
const Shield = vm.runInContext(coreCode + '\n; Shield;', context);

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  process.stdout.write(`Test ${total}: ${name} ... `);
  try {
    fn();
    passed++;
    console.log('\x1b[32mPASS\x1b[0m');
  } catch (err) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.error('   Error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Self-test passes
// ---------------------------------------------------------------------------
runTest('Integrity self-test passes', () => {
  const es =
    'FICTIONAL. Acme Co. export for Beta LLC\nEntry Number,Filer Code,Entry Type,Entry Date,HTS Chapter 99 Number,Country of Origin,IEEPA Duty Amount (USD),Liquidation Status,Liquidation Date\nABC-1234560-4,ABC,01,2025-12-09,9903.01.24,CN,3200.00,Unliquidated,\nABC-123456-7,ABC,01,2025-12-15,9903.02.01,VN,4100.00,Liquidated,2026-08-07\nABC-1234562-1,ABC,21,2025-12-22,9903.01.24,CN,2850.00,Liquidated,';
  const bk =
    'Prepared by Gamma Brokerage\nEntry Number,Reconciliation Flag (Y/N),Type 09 Reconciliation Entry Filed (Y/N),Type 09 Scheduled Filing Date,Open Protest (Y/N),Protest Filed Only for IEEPA Refund (Y/N),CIT Plaintiff (Y/N),Broker Notes\nABC-1234560-4,Y,N,2026-10-22,N,,N,call Jane Doe 561-555-0100\nABC-123456-7,N,N,,Y,Y,N,';
  const su =
    'Header line\nPO Number,Supplier,Incoterms,Importer of Record,Product,Ship Date,Invoice Value (USD),IEEPA Tariff Surcharge Passed Through (USD)\nSB-PO-1,Delta Toys Ltd.,"DDP Boca Raton, FL","Freight forwarder (Echo Logistics)",Puzzles,2025-05-14,48000,4200';

  const r = Shield.scrubCSVs(es, bk, su, '2026-10-16');
  const H = r.entries.header;
  const c = n => H.indexOf(n);
  const R = r.entries.rows;
  const txt = Shield.entriesText(r, '2026-10-16');

  assert(!/Acme|Beta|Gamma|Delta|Echo|Jane|ABC-|Puzzles|Boca/.test(txt), 'Banner or PII leaked in txt');
  assert(R[0][c('entry_number')] === 'ENT-001', 'Entry 1 not ENT-001');
  assert(R[0][c('reconciliation_flag')] === 'Y', 'Reconciliation flag mismatch');
  assert(R[1][c('open_protest')] === 'Y', 'Open protest flag mismatch');
  assert(R[1][c('days_since_liquidation')] === '70', 'Days since liquidation mismatch');
  assert(R[1][c('cape_days_left')] === '10', 'CAPE days left mismatch');
  assert(R[1][c('entry_number_valid')] === 'N', 'Malformed entry not marked N');
  assert(/liquidated_no_date/.test(R[2][c('data_flags')]), 'liquidated_no_date flag missing');
  assert(R[0][c('type_09_days_until_filing')] === '6', 'Type 09 days mismatch');
  assert(H.indexOf('country_of_origin') < 0, 'country_of_origin not dropped');
  assert(r.suppliers.rows[0][2] === 'DDP', 'Incoterms mismatch');
  assert(r.suppliers.rows[0][3] === 'Forwarder', 'Role mapping mismatch');
  assert(Object.keys(Shield.scanOutput(txt)).length === 0, 'Clean output failed scan');
  assert(Shield.rehydrate('File ENT-001 now', r.key) === 'File ABC-1234560-4 now', 'Restore failed');

  const t = Shield.scrubText('Importer: Beta LLC prepared by Gamma Brokerage. Entry ABC-1234560-4 contact a@b.com 561-555-0100', ['Beta LLC', 'Gamma Brokerage']);
  assert(!/Beta|Gamma|ABC-|a@b|561/.test(t.text), 'Text mode leaked PII');
  assert(/ENT-001/.test(t.text), 'Text mode did not tokenize entry number');
});

// ---------------------------------------------------------------------------
// Test 2: Fixture CSVs with as-of 2026-10-15 produce byte-for-byte match
// ---------------------------------------------------------------------------
runTest('Fixture CSVs match example_attach_this_scrubbed_seabreeze.txt byte-for-byte', () => {
  const es = fs.readFileSync(path.resolve(__dirname, 'fixtures/1_Seabreeze_ES-003_Export_FICTIONAL.csv'), 'utf8');
  const bk = fs.readFileSync(path.resolve(__dirname, 'fixtures/2_Seabreeze_Broker_Status_List_FICTIONAL.csv'), 'utf8');
  const su = fs.readFileSync(path.resolve(__dirname, 'fixtures/3_Seabreeze_Supplier_Purchase_Records_FICTIONAL.csv'), 'utf8');
  const expected = fs.readFileSync(path.resolve(__dirname, 'fixtures/example_attach_this_scrubbed_seabreeze.txt'), 'utf8').replace(/\r\n/g, '\n');

  const res = Shield.scrubCSVs(es, bk, su, '2026-10-15');
  const actual = Shield.entriesText(res, '2026-10-15').replace(/\r\n/g, '\n');

  assert.strictEqual(actual, expected, 'Actual scrubbed text does not match expected fixture');
  assert.strictEqual(res.entries.rows.length, 28, 'Expected 28 entries');
  assert.strictEqual(res.suppliers ? res.suppliers.rows.length : 0, 3, 'Expected 3 supplier records');
  assert.strictEqual(res.report.flags.malformed_entry_number, 2, 'Expected 2 malformed entries');
  assert.strictEqual(res.report.flags.status_missing, 1, 'Expected 1 status_missing flag');
  assert.strictEqual(res.report.preambleRemoved, 3, 'Expected 3 banner lines removed');
});

// ---------------------------------------------------------------------------
// Test 3: Without broker CSV, warning appears
// ---------------------------------------------------------------------------
runTest('Without broker CSV, warning condition is met', () => {
  const es = fs.readFileSync(path.resolve(__dirname, 'fixtures/1_Seabreeze_ES-003_Export_FICTIONAL.csv'), 'utf8');
  const su = fs.readFileSync(path.resolve(__dirname, 'fixtures/3_Seabreeze_Supplier_Purchase_Records_FICTIONAL.csv'), 'utf8');

  // Passing empty string for broker list
  const res = Shield.scrubCSVs(es, '', su, '2026-10-15');
  assert.strictEqual(res.entries.rows.length, 28);
  // Verify broker fields are empty
  const reconIdx = res.entries.header.indexOf('reconciliation_flag');
  assert.strictEqual(res.entries.rows[0][reconIdx], '', 'Broker field should be empty');

  // Verify UI logic check: if (!files.bk.text) renders warning
  const appCode = fs.readFileSync(path.resolve(__dirname, '../js/app.js'), 'utf8');
  assert(appCode.includes('No broker status list added'), 'UI warning message for missing broker CSV missing from app.js');
});

// ---------------------------------------------------------------------------
// Test 4: Planted email or phone number in kept column is BLOCKED
// ---------------------------------------------------------------------------
runTest('Planted PII in kept column is BLOCKED and controls hidden', () => {
  const es = fs.readFileSync(path.resolve(__dirname, 'fixtures/1_Seabreeze_ES-003_Export_FICTIONAL.csv'), 'utf8');
  // Plant an email into the liquidation_status column (which is a kept column)
  const plantedEs = es.replace('Unliquidated', 'leaked_agent@fau.edu');

  const res = Shield.scrubCSVs(plantedEs, '', '', '2026-10-15');
  const outText = Shield.entriesText(res, '2026-10-15');
  const leaks = Shield.scanOutput(outText);

  assert(leaks.email > 0, 'Planted email not caught by scanOutput');

  // Verify app.js blocks output and hides controls when leakKinds exist
  const appCode = fs.readFileSync(path.resolve(__dirname, '../js/app.js'), 'utf8');
  assert(appCode.includes('Blocked by Safety Scan'), 'Safety scan blocking logic missing in app.js');
  assert(appCode.includes("outBox.style.display = 'none'") || appCode.includes('outBox.style.display = "none"'), 'Hiding outbox on leak missing');
});

// ---------------------------------------------------------------------------
// Test 5: Empty as-of date is rejected
// ---------------------------------------------------------------------------
runTest('Empty as-of date is rejected', () => {
  const appCode = fs.readFileSync(path.resolve(__dirname, '../js/app.js'), 'utf8');
  assert(appCode.includes('Choose the as-of date first'), 'Empty as-of validation alert missing from app.js');

  // When asOf is empty, days cannot be computed
  const es = 'Entry Number,Entry Type,HTS Chapter 99 Number,IEEPA Duty Amount (USD),Liquidation Status,Liquidation Date\nABC-1234560-4,01,9903.01.24,100.00,Liquidated,2026-08-01';
  const res = Shield.scrubCSVs(es, '', '', '');
  const daysIdx = res.entries.header.indexOf('days_since_liquidation');
  assert.strictEqual(res.entries.rows[0][daysIdx], '', 'Days should not be calculated without as-of date');
});

// ---------------------------------------------------------------------------
// Test 6: PDF-text mode replaces listed names, entry numbers, and emails
// ---------------------------------------------------------------------------
runTest('PDF-text mode replaces names, entry numbers, and emails', () => {
  const samplePdf = 'Ocean freight notice for Harborline Home Goods LLC. Entry HBL-7762101-5 arrived at Port of Miami. Contact broker at ops@gatewaybrokers.com or call (305) 555-0144.';
  const names = ['Harborline Home Goods LLC'];

  const res = Shield.scrubText(samplePdf, names);
  assert(!res.text.includes('Harborline Home Goods LLC'), 'Name was not replaced');
  assert(res.text.includes('PARTY-001'), 'Name was not replaced with PARTY token');
  assert(!res.text.includes('HBL-7762101-5'), 'Entry number was not tokenized');
  assert(res.text.includes('ENT-001'), 'Entry number not replaced with ENT token');
  assert(!res.text.includes('ops@gatewaybrokers.com'), 'Email was not redacted');
  assert(!res.text.includes('(305) 555-0144'), 'Phone was not redacted');
  assert(res.key.tokens['PARTY-001'] === 'harborline home goods llc', 'Key token map mismatch');
});

// ---------------------------------------------------------------------------
// Test 7: Zero network grep check across all built files
// ---------------------------------------------------------------------------
runTest('Grep check confirms zero network requests or remote resources', () => {
  const filesToCheck = [
    path.resolve(__dirname, '../index.html'),
    path.resolve(__dirname, '../css/styles.css'),
    path.resolve(__dirname, '../js/shield-core.js'),
    path.resolve(__dirname, '../js/sample-data.js'),
    path.resolve(__dirname, '../js/app.js'),
    path.resolve(__dirname, '../vercel.json')
  ];

  const forbiddenTerms = [
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    'sendBeacon'
  ];

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.basename(filePath);

    // Check forbidden API calls
    for (const term of forbiddenTerms) {
      assert(!content.includes(term), `File ${rel} contains forbidden network call: ${term}`);
    }

    // Check remote resource URLs in src or href (allowing only outbound anchor links like owlone.fau.edu)
    const remoteResourceRegex = /(?:src|href)\s*=\s*["']https?:\/\/(?!owlone\.fau\.edu)[^"']+["']/gi;
    const matches = content.match(remoteResourceRegex);
    assert(!matches, `File ${rel} references external remote resource: ${matches}`);
  }
});

// ---------------------------------------------------------------------------
// Test 8: Zero inline styles in index.html and js/app.js (strict CSP compliance)
// ---------------------------------------------------------------------------
runTest('Zero inline style attributes in index.html and js/app.js', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const appJs = fs.readFileSync(path.resolve(__dirname, '../js/app.js'), 'utf8');

  const inlineStyleRegex = /style\s*=\s*['\"][^'\"]*['\"]/i;

  const htmlMatch = html.match(inlineStyleRegex);
  assert(!htmlMatch, `index.html contains inline style attribute: ${htmlMatch ? htmlMatch[0] : ''}`);

  const appMatch = appJs.match(inlineStyleRegex);
  assert(!appMatch, `js/app.js contains inline style attribute in template strings: ${appMatch ? appMatch[0] : ''}`);
});

// ---------------------------------------------------------------------------
// Test 9: Lookup CSV has the same token count as the scrubbed file
// ---------------------------------------------------------------------------
runTest('Lookup CSV has the same token count as the scrubbed file', () => {
  const es = fs.readFileSync(path.resolve(__dirname, 'fixtures/1_Seabreeze_ES-003_Export_FICTIONAL.csv'), 'utf8');
  const bk = fs.readFileSync(path.resolve(__dirname, 'fixtures/2_Seabreeze_Broker_Status_List_FICTIONAL.csv'), 'utf8');
  const su = fs.readFileSync(path.resolve(__dirname, 'fixtures/3_Seabreeze_Supplier_Purchase_Records_FICTIONAL.csv'), 'utf8');

  const res = Shield.scrubCSVs(es, bk, su, '2026-10-15');
  const scrubbedText = Shield.entriesText(res, '2026-10-15');

  // Entry token count in the scrubbed file (each row in entries table has 1 token)
  const scrubbedEntryTokenCount = res.entries.rows.length;
  assert.strictEqual(scrubbedEntryTokenCount, 28, 'Fixture should produce 28 scrubbed entries');

  // In scrubbed markdown output, count unique ENT-xxx tokens
  const scrubbedTokensInText = new Set(scrubbedText.match(/\bENT-\d+\b/g) || []);
  assert.strictEqual(scrubbedTokensInText.size, scrubbedEntryTokenCount, 'Token count in scrubbed text table mismatch');

  // Verify app.js generates lookup CSV using the in-memory key data
  const { generateLookupCSV } = require('../js/app.js');
  assert(typeof generateLookupCSV === 'function', 'generateLookupCSV function exported by app.js');

  const csvContent = generateLookupCSV(res.key);
  const lines = csvContent.trim().split(/\r?\n/);

  // Check header
  assert.strictEqual(lines[0], 'token,real_entry_number', 'Lookup CSV header must be token,real_entry_number');

  // Count rows in lookup CSV (excluding header)
  const lookupDataRows = lines.slice(1);
  const lookupTokenCount = lookupDataRows.length;

  assert.strictEqual(
    lookupTokenCount,
    scrubbedEntryTokenCount,
    `Lookup CSV token count (${lookupTokenCount}) must equal scrubbed file token count (${scrubbedEntryTokenCount})`
  );

  // Verify that every token in the lookup CSV corresponds to an entry in the scrubbed file
  lookupDataRows.forEach(row => {
    const [token, realNumber] = row.split(',');
    assert(token.startsWith('ENT-'), `Token must start with ENT-: ${token}`);
    assert(scrubbedTokensInText.has(token), `Token ${token} not found in scrubbed file`);
    assert.strictEqual(res.key.tokens[token], realNumber, `Real entry number mismatch for ${token}`);
  });

  // Verify UI elements exist in index.html
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert(html.includes('id="dl_lookup_csv"'), 'Missing dl_lookup_csv link in index.html');
  assert(html.includes('Optional: download lookup table (.csv)'), 'Missing link text in index.html');
  assert(html.includes('Contains your real entry numbers. Keep it private and never attach it to DutyBack.'), 'Missing notice text in index.html');
  assert(!html.includes('id="dlkey"'), 'dlkey should be removed from main screen');
  assert(html.includes('id="advanced_accordion"'), 'Missing collapsed advanced accordion in index.html');
});

// ---------------------------------------------------------------------------
// Test 10: OWLONE_URL equals target chat link and index.html contains no iframe
// ---------------------------------------------------------------------------
runTest('OWLONE_URL equals target chat link and index.html contains no iframe', () => {
  const { OWLONE_URL } = require('../js/app.js');
  const expectedUrl = 'https://owlone.fau.edu/chat/858e4234-d789-4261-a229-0a10f5299f1b';
  assert.strictEqual(OWLONE_URL, expectedUrl, `OWLONE_URL must be ${expectedUrl}`);

  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert(!/<iframe\b/i.test(html), 'index.html must not contain any iframe elements');

  // Verify all owlone-link anchors have target="_blank" and rel="noopener noreferrer"
  const owlLinks = html.match(/<a[^>]*class="[^"]*owlone-link[^"]*"[^>]*>/g) || [];
  assert(owlLinks.length > 0, 'No owlone-link anchors found in index.html');
  for (const link of owlLinks) {
    assert(link.includes('target="_blank"'), `owlone link missing target="_blank": ${link}`);
    assert(link.includes('rel="noopener noreferrer"'), `owlone link missing rel="noopener noreferrer": ${link}`);
    assert(link.includes(expectedUrl), `owlone link missing expected href: ${link}`);
  }
});

console.log(`\n====================================================`);
console.log(`Results: ${passed} / ${total} tests passed.`);
console.log(`====================================================`);

if (passed !== total) {
  process.exit(1);
}
