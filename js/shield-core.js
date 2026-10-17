const Shield = (function () {
            const ENTRY_RE = /^[A-Z0-9]{3}-\d{7}-\d$/;
            const PATTERNS = {
                email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
                phone: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
                ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
                ein: /\b\d{2}-\d{7}\b/g,
                iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
                longdigits: /\b\d{9,17}\b/g
            };

            function parseCSVRaw(text) {
                const rows = []; let row = [], cur = '', q = false;
                text = text.replace(/^\uFEFF/, '');
                for (let i = 0; i < text.length; i++) {
                    const c = text[i];
                    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
                    else if (c === '"') q = true;
                    else if (c === ',') { row.push(cur); cur = ''; }
                    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
                    else cur += c;
                }
                if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
                return rows;
            }
            // Real exports start with banner lines (company, broker, dates). They are removed, never passed on.
            function parseTable(text) {
                const rows = parseCSVRaw(text); const pre = [];
                while (rows.length && rows[0].filter(c => c.trim() !== '').length <= 1) pre.push(rows.shift().join(' ').trim());
                const header = rows.shift() || [];
                return { header, rows, preamble: pre.filter(Boolean) };
            }
            function toCSV(header, rows) {
                const esc = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
                return [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
            }
            const norm = h => h.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const yn = v => { v = String(v || '').trim().toUpperCase(); return v === 'Y' || v === 'YES' || v === 'TRUE' ? 'Y' : (v === 'N' || v === 'NO' || v === 'FALSE' ? 'N' : ''); };

            function daysBetween(a, b) { // a - b in days, ISO dates
                const A = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)), B = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
                return Math.round((A - B) / 86400000);
            }
            const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test((s || '').trim());

            // Allowlists: only these columns are ever used. Anything else is dropped (and reported by name).
            const ES_USED = { entry_number: 'entry_number', entry_type: 'entry_type', hts_chapter_99_number: 'hts', ieepa_duty_amount: 'duty', duty_on_line: 'duty', ieepa_duty_usd: 'duty', liquidation_status: 'status', liquidation_date: 'liq_date' };
            const ES_IGNORED_OK = ['days_since_liquidation', 'days_since_liquidation_as_of', 'filer_code', 'line_number', 'country_of_origin', 'entry_date'];
            const BK_USED = { entry_number: 'entry_number', reconciliation_flag: 'recon', type_09_reconciliation_entry_filed: 't09', type_09_scheduled_filing_date: 't09_date', open_protest: 'protest', protest_filed_only_for_ieepa_refund: 'protest_ieepa', cit_plaintiff: 'cit' };
            const SU_USED = { po_number: 'po', supplier: 'supplier', incoterms: 'incoterms', importer_of_record: 'ior', ieepa_tariff_surcharge_passed_through: 'surcharge' };

            function mapColumns(header, used, ignoredOk) {
                const idx = {}, dropped = [], derived = [];
                header.forEach((h, i) => {
                    const n = norm(h);
                    if (used[n]) idx[used[n]] = i; else dropped.push(h);
                });
                return { idx, dropped };
            }

            function makeTokener(key) {
                const counters = {}, reverse = {};
                return (prefix, value) => {
                    const k = prefix + '|' + value;
                    if (!reverse[k]) { counters[prefix] = (counters[prefix] || 0) + 1; const t = prefix + '-' + String(counters[prefix]).padStart(3, '0'); reverse[k] = t; key.tokens[t] = value; }
                    return reverse[k];
                };
            }
            const roleOf = v => { v = String(v || '').toLowerCase(); if (/forwarder|logistics|freight/.test(v)) return 'Forwarder'; if (/^(the )?(supplier|seller|manufacturer|vendor)/.test(v)) return 'Supplier'; if (/^(importer|buyer|company|self|us)$/.test(v.trim())) return 'Buyer'; return 'Other (check)'; };

            function scrubCSVs(esText, bkText, suText, asOf) {
                const key = { version: 2, created: new Date().toISOString().slice(0, 10), tokens: {} };
                const tok = makeTokener(key);
                const report = { preambleRemoved: 0, dropped: {}, flags: {}, notes: [] };
                const bump = f => { report.flags[f] = (report.flags[f] || 0) + 1; };
                const es = parseTable(esText); report.preambleRemoved += es.preamble.length;
                const ec = mapColumns(es.header, ES_USED);
                report.dropped.es = ec.dropped;
                if (ec.idx.entry_number === undefined) throw new Error('No entry number column found in the ES-003 file.');
                let bk = null, bc = null, bmap = {};
                if (bkText) {
                    bk = parseTable(bkText); report.preambleRemoved += bk.preamble.length; bc = mapColumns(bk.header, BK_USED); report.dropped.bk = bc.dropped;
                    bk.rows.forEach(r => { const e = (r[bc.idx.entry_number] || '').trim(); if (e) bmap[e] = r; });
                }
                const seen = {}; const g = (r, c, k) => (c.idx[k] === undefined ? '' : (r[c.idx[k]] || '').trim());
                const outHeader = ['entry_number', 'entry_type', 'hts_chapter_99', 'ieepa_duty_usd', 'liquidation_status', 'days_since_liquidation', 'cape_days_left', 'protest_days_left', 'reconciliation_flag', 'type_09_filed', 'type_09_days_until_filing', 'open_protest', 'protest_ieepa_only', 'cit_plaintiff', 'entry_number_valid', 'data_flags'];
                const entries = es.rows.filter(r => (r[ec.idx.entry_number] || '').trim() !== '').map(r => {
                    const raw = (r[ec.idx.entry_number] || '').trim(); const flags = [];
                    const valid = ENTRY_RE.test(raw); if (!valid) { flags.push('malformed_entry_number'); bump('malformed_entry_number'); }
                    if (seen[raw]) { flags.push('duplicate_entry'); bump('duplicate_entry'); } seen[raw] = true;
                    const status = g(r, ec, 'status'), liq = g(r, ec, 'liq_date');
                    let days = '', cape = '', prot = '';
                    if (isISO(liq) && asOf) { const d = daysBetween(asOf, liq); days = String(d); cape = String(80 - d); prot = String(180 - d); }
                    if (/^liquidated/i.test(status) && !isISO(liq)) { flags.push('liquidated_no_date'); bump('liquidated_no_date'); }
                    if (status === '' && !isISO(liq)) { flags.push('status_missing'); bump('status_missing'); }
                    let b = null, recon = '', t09 = '', t09d = '', prot_open = '', pie = '', cit = '';
                    if (bk) {
                        b = bmap[raw];
                        if (!b) { flags.push('no_broker_row'); bump('no_broker_row'); }
                        else {
                            recon = yn(g(b, bc, 'recon')); t09 = yn(g(b, bc, 't09')); prot_open = yn(g(b, bc, 'protest')); pie = yn(g(b, bc, 'protest_ieepa')); cit = yn(g(b, bc, 'cit'));
                            const sd = g(b, bc, 't09_date'); if (isISO(sd) && asOf) t09d = String(daysBetween(sd, asOf));
                        }
                    }
                    const duty = g(r, ec, 'duty').replace(/[$,]/g, '');
                    return [tok('ENT', raw), g(r, ec, 'entry_type'), g(r, ec, 'hts'), duty, status, days, cape, prot, recon, t09, t09d, prot_open, pie, cit, valid ? 'Y' : 'N', flags.join(';')];
                });
                let sup = null;
                if (suText) {
                    const su = parseTable(suText); report.preambleRemoved += su.preamble.length; const sc = mapColumns(su.header, SU_USED); report.dropped.su = sc.dropped;
                    const sh = ['po', 'supplier', 'incoterms', 'importer_of_record_role', 'ieepa_surcharge_usd'];
                    sup = {
                        header: sh, rows: su.rows.filter(r => r.join('').trim() !== '').map(r => {
                            const inc = g(r, sc, 'incoterms').split(/[\s,]+/)[0] || '';
                            return [tok('PO', g(r, sc, 'po')), tok('SUPPLIER', g(r, sc, 'supplier')), inc, roleOf(g(r, sc, 'ior')), g(r, sc, 'surcharge').replace(/[$,]/g, '')];
                        })
                    };
                }
                return { entries: { header: outHeader, rows: entries }, suppliers: sup, key, report };
            }

            function rehydrate(text, key) {
                const toks = Object.keys(key.tokens).sort((a, b) => b.length - a.length);
                let out = text;
                toks.forEach(t => { out = out.replace(new RegExp('(^|[^A-Za-z0-9-])' + t.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9-])', 'g'), (m, p) => p + key.tokens[t]); });
                return out;
            }

            // Text mode (PDF copy and paste): known names, entry numbers, invoice and protest numbers, and PII patterns
            function scrubText(text, names) {
                const key = { version: 2, created: new Date().toISOString().slice(0, 10), tokens: {} }; const tok = makeTokener(key);
                const report = { namesReplaced: 0, entries: 0, patterns: 0, possibleNames: [] };
                const list = (names || []).map(s => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
                let out = text;
                list.forEach(n => { const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi'); out = out.replace(re, m => { report.namesReplaced++; return tok('PARTY', n.toLowerCase()); }); });
                const swap = (re, prefix) => { out = out.replace(re, m => { report.entries++; return tok(prefix, m); }); };
                swap(/\b[A-Z0-9]{3}-\d{6,8}-\d\b/g, 'ENT');
                swap(/\b\d{4}-\d{2}-\d{6}\b/g, 'PROTEST');
                swap(/\bINV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g, 'INV');
                swap(/\b[A-Z]{2}-PO-\d{4}-\d{4}\b/g, 'PO');
                out = out.replace(/\b(FOB|CIF|CFR|EXW|FCA|DAP|DDP|CPT|CIP|DPU)[ \t]+[A-Z][A-Za-z.]*(?:[ \t,]+[A-Z][A-Za-z.]*)*/g, (m, t) => { report.patterns++; return t + ' [PLACE]'; });
                out = out.replace(/\$\s?\d+(?:\.\d+)?\s?(?:M|MM|B|million|billion)\b(?:\s+(?:in\s+)?revenue)?/gi, () => { report.patterns++; return '[REDACTED]'; });
                out = out.replace(/\b\d[\d,]*\s+(?:employees|staff|workers)\b/gi, () => { report.patterns++; return '[REDACTED]'; });
                for (const k of ['email', 'phone', 'ssn', 'ein', 'iban', 'longdigits']) { PATTERNS[k].lastIndex = 0; out = out.replace(PATTERNS[k], () => { report.patterns++; return '[REDACTED]'; }); }
                const sus = /\b([A-Z][\w&.'-]*(?:[ \t]+[A-Z][\w&.'-]*)*[ \t]+(?:Co\.?|LLC|Ltd\.?|Inc\.?|Corp\.?|Company|Partners|Brokers|Brokerage|Logistics|Collective|Ceramics|Housewares|Textile|Manufacturing|Supply|Freight|Customs|Group))\b/g;
                const found = {}; let m; while ((m = sus.exec(out))) found[m[1]] = 1; report.possibleNames = Object.keys(found);
                return { text: out, key, report };
            }

            // Final safety scan on anything about to be shown or downloaded. Reports kinds only, never the values.
            function scanOutput(text) {
                const checks = { email: PATTERNS.email, phone: PATTERNS.phone, ssn: PATTERNS.ssn, ein: PATTERNS.ein, iban: PATTERNS.iban, long_number: PATTERNS.longdigits, real_entry_number: /\b[A-Z0-9]{3}-\d{6,8}-\d\b/g };
                const found = {};
                Object.keys(checks).forEach(k => { const m = String(text || '').match(checks[k]); if (m) found[k] = m.length; });
                return found;
            }

            function asPipeTable(header, rows) {
                const line = r => '| ' + r.map(v => String(v).replace(/\|/g, '/')).join(' | ') + ' |';
                return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
            }
            function entriesText(res, asOf) {
                let t = 'DutyBack scrubbed report. As-of date: ' + asOf + '. Identifiers removed or tokenized locally. Day counts were computed locally; use them as given.\n\n## Entries\n' + asPipeTable(res.entries.header, res.entries.rows);
                if (res.suppliers) t += '\n\n## Supplier purchase records\n' + asPipeTable(res.suppliers.header, res.suppliers.rows);
                return t;
            }
            return { parseTable, parseCSVRaw, toCSV, scrubCSVs, scrubText, rehydrate, entriesText, scanOutput, ENTRY_RE, norm };
        })();
