/**
 * DutyBack Privacy Shield - UI Controller (app.js)
 * Zero network dependencies. All processing in browser memory.
 */

// Target URL for DutyBack agent on FAU's owlONE platform
const OWLONE_URL = "https://owlone.fau.edu";

(function () {
  "use strict";

  // Cache DOM element getter
  const $ = (id) => document.getElementById(id);

  // In-memory file storage (never logged, never sent over network)
  const files = {
    es: { name: "", text: "", rows: 0 },
    bk: { name: "", text: "", rows: 0 },
    su: { name: "", text: "", rows: 0 },
  };

  let csvResult = null;
  let textResult = null;
  let restoreKey = null;

  // -------------------------------------------------------------------------
  // 1. Integrity Self-Test
  // -------------------------------------------------------------------------
  function runIntegritySelfTest() {
    const es =
      "FICTIONAL. Acme Co. export for Beta LLC\nEntry Number,Filer Code,Entry Type,Entry Date,HTS Chapter 99 Number,Country of Origin,IEEPA Duty Amount (USD),Liquidation Status,Liquidation Date\nABC-1234560-4,ABC,01,2025-12-09,9903.01.24,CN,3200.00,Unliquidated,\nABC-123456-7,ABC,01,2025-12-15,9903.02.01,VN,4100.00,Liquidated,2026-08-07\nABC-1234562-1,ABC,21,2025-12-22,9903.01.24,CN,2850.00,Liquidated,";
    const bk =
      "Prepared by Gamma Brokerage\nEntry Number,Reconciliation Flag (Y/N),Type 09 Reconciliation Entry Filed (Y/N),Type 09 Scheduled Filing Date,Open Protest (Y/N),Protest Filed Only for IEEPA Refund (Y/N),CIT Plaintiff (Y/N),Broker Notes\nABC-1234560-4,Y,N,2026-10-22,N,,N,call Jane Doe 561-555-0100\nABC-123456-7,N,N,,Y,Y,N,";
    const su =
      'Header line\nPO Number,Supplier,Incoterms,Importer of Record,Product,Ship Date,Invoice Value (USD),IEEPA Tariff Surcharge Passed Through (USD)\nSB-PO-1,Delta Toys Ltd.,"DDP Boca Raton, FL","Freight forwarder (Echo Logistics)",Puzzles,2025-05-14,48000,4200';

    const checks = [];
    try {
      const r = Shield.scrubCSVs(es, bk, su, "2026-10-16");
      const H = r.entries.header;
      const c = (n) => H.indexOf(n);
      const R = r.entries.rows;
      const txt = Shield.entriesText(r, "2026-10-16");

      checks.push([
        "banner lines removed, no party names leak",
        !/Acme|Beta|Gamma|Delta|Echo|Jane|ABC-|Puzzles|Boca/.test(txt),
      ]);
      checks.push([
        "entry numbers tokenized and joined to broker data",
        R[0][c("entry_number")] === "ENT-001" &&
          R[0][c("reconciliation_flag")] === "Y" &&
          R[1][c("open_protest")] === "Y",
      ]);
      checks.push([
        "days computed locally (70) with 10 days left",
        R[1][c("days_since_liquidation")] === "70" &&
          R[1][c("cape_days_left")] === "10",
      ]);
      checks.push([
        "malformed number and missing date flagged",
        R[1][c("entry_number_valid")] === "N" &&
          /liquidated_no_date/.test(R[2][c("data_flags")]),
      ]);
      checks.push([
        "type 09 days until filing computed (6)",
        R[0][c("type_09_days_until_filing")] === "6",
      ]);
      checks.push([
        "unneeded columns dropped (country, entry date, notes)",
        H.indexOf("country_of_origin") < 0 &&
          !/CN|2025-12-09/.test(R[0].join("|")),
      ]);
      checks.push([
        "supplier role and incoterms reduced to categories",
        r.suppliers.rows[0][2] === "DDP" &&
          r.suppliers.rows[0][3] === "Forwarder",
      ]);
      checks.push([
        "final scan passes clean output",
        Object.keys(Shield.scanOutput(txt)).length === 0,
      ]);
      checks.push([
        "final scan catches a planted email, phone and entry number",
        (function (f) {
          return f.email && f.phone && f.real_entry_number;
        })(Shield.scanOutput("x a@b.com 561-555-0100 ABC-1234560-4")),
      ]);
      checks.push([
        "restore returns the real entry number",
        Shield.rehydrate("File ENT-001 now", r.key) === "File ABC-1234560-4 now",
      ]);
      const t = Shield.scrubText(
        "Importer: Beta LLC prepared by Gamma Brokerage. Entry ABC-1234560-4 contact a@b.com 561-555-0100",
        ["Beta LLC", "Gamma Brokerage"]
      );
      checks.push([
        "text mode removes names, numbers and contact details",
        !/Beta|Gamma|ABC-|a@b|561/.test(t.text) && /ENT-001/.test(t.text),
      ]);
    } catch (e) {
      checks.push(["page ran without an error: " + e.message, false]);
    }

    const bad = checks.filter((item) => !item[1]);
    const chip = $("selftest_chip");
    if (chip) {
      if (bad.length === 0) {
        chip.className = "status-chip chip-safe";
        chip.innerHTML =
          '<span class="status-dot"></span> Self-test: Passed (' +
          checks.length +
          "/" +
          checks.length +
          " checks)";
        chip.setAttribute(
          "title",
          "Integrity self-test passed: parsing, day counts, tokenizing, and leak scanning operate correctly."
        );
      } else {
        chip.className = "status-chip chip-fail";
        chip.innerHTML =
          '<span class="status-dot"></span> Self-test: FAILED (' +
          bad.length +
          " errors)";
        chip.setAttribute(
          "title",
          "Errors: " + bad.map((b) => b[0]).join("; ")
        );
      }
    }
    return bad.length === 0;
  }

  // -------------------------------------------------------------------------
  // 2. Real-time Network Counter
  // -------------------------------------------------------------------------
  function updateNetworkMetric() {
    let count = 0;
    if (typeof performance !== "undefined" && performance.getEntriesByType) {
      const resources = performance.getEntriesByType("resource");
      const network = resources.filter(
        (r) => r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest"
      );
      count = network.length;
    }
    const el = $("network_count");
    if (el) el.textContent = String(count);
  }

  // -------------------------------------------------------------------------
  // 3. Redaction Visual Animation Player
  // -------------------------------------------------------------------------
  function setupRedactionVisual() {
    const card = $("redaction_visual_card");
    const replayBtn = $("replay_redaction_btn");
    if (!card || !replayBtn) return;

    function triggerAnimation() {
      card.classList.remove("animating");
      // Force DOM reflow
      void card.offsetWidth;
      card.classList.add("animating");
    }

    replayBtn.addEventListener("click", triggerAnimation);
    // Trigger on load
    triggerAnimation();
  }

  // -------------------------------------------------------------------------
  // 4. File Drag & Drop Helpers
  // -------------------------------------------------------------------------
  function countLines(text) {
    if (!text) return 0;
    return text.trim().split(/\r\n|\r|\n/).length;
  }

  function setFileLoaded(type, name, content) {
    const lines = countLines(content);
    files[type] = {
      name: name,
      text: content,
      rows: Math.max(0, lines - 1),
    };
    const zone = $("drop_" + type);
    const status = $("status_" + type);
    if (zone && status) {
      zone.classList.add("has-file");
      status.innerHTML =
        '<span class="icon-check-green">&#10003;</span> ' +
        escapeHtml(name) +
        " (" +
        lines +
        " lines)";
    }
  }

  function setupDropZone(type, inputId) {
    const zone = $("drop_" + type);
    const input = $(inputId);
    if (!zone || !input) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("dragover");
      });
    });

    zone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        handleFileSelect(type, dt.files[0]);
      }
    });

    input.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelect(type, e.target.files[0]);
      }
    });

    // Keyboard support
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
  }

  function handleFileSelect(type, file) {
    const reader = new FileReader();
    reader.onload = () => {
      setFileLoaded(type, file.name, reader.result);
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------------------
  // 5. Sample Data Loader
  // -------------------------------------------------------------------------
  function loadSampleData() {
    if (
      typeof SAMPLE_ES_CSV === "undefined" ||
      typeof SAMPLE_BK_CSV === "undefined" ||
      typeof SAMPLE_SU_CSV === "undefined"
    ) {
      alert("Sample data file not loaded.");
      return;
    }

    setFileLoaded(
      "es",
      "1_Seabreeze_ES-003_Export_FICTIONAL.csv",
      SAMPLE_ES_CSV
    );
    setFileLoaded(
      "bk",
      "2_Seabreeze_Broker_Status_List_FICTIONAL.csv",
      SAMPLE_BK_CSV
    );
    setFileLoaded(
      "su",
      "3_Seabreeze_Supplier_Purchase_Records_FICTIONAL.csv",
      SAMPLE_SU_CSV
    );

    const asofInput = $("asof");
    if (asofInput) {
      asofInput.value = new Date().toISOString().slice(0, 10);
    }

    // Run scrubbing immediately
    scrubCSVData();

    // Scroll smoothly to results
    setTimeout(() => {
      const results = $("results_panel");
      if (results) {
        results.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 350);
  }

  // -------------------------------------------------------------------------
  // 6. Before / After Preview Generator
  // -------------------------------------------------------------------------
  function renderBeforeAfterPreview(rawEsText, result) {
    const container = $("before_after_container");
    if (!container) return;

    const rawParsed = Shield.parseTable(rawEsText);
    const rawHeader = rawParsed.header;
    const rawRows = rawParsed.rows.slice(0, 5);

    const scrubbedHeader = result.entries.header;
    const scrubbedRows = result.entries.rows.slice(0, 5);

    let html = '<div class="preview-box">';
    html += '<div class="preview-header">';
    html +=
      '<h4 class="preview-title">Before &amp; After Comparison (First 5 Rows)</h4>';
    html +=
      '<span class="status-chip chip-safe">&#128274; Safe In-Memory Inspection Only</span>';
    html += "</div>";

    html += '<div class="table-responsive">';
    html += '<table class="table-customs">';
    html += "<thead><tr>";
    html += "<th>Row</th>";
    html += "<th>Raw Entry #</th>";
    html += "<th>Raw Filer</th>";
    html += "<th>Tokenized Entry #</th>";
    html += "<th>Duty (USD)</th>";
    html += "<th>Status</th>";
    html += "<th>Days Left</th>";
    html += "<th>Data Flags</th>";
    html += "</tr></thead><tbody>";

    const rawEntryIdx = rawHeader.findIndex(
      (h) => Shield.norm(h) === "entry_number"
    );
    const rawFilerIdx = rawHeader.findIndex(
      (h) => Shield.norm(h) === "filer_code"
    );

    const sEntryIdx = scrubbedHeader.indexOf("entry_number");
    const sDutyIdx = scrubbedHeader.indexOf("ieepa_duty_usd");
    const sStatusIdx = scrubbedHeader.indexOf("liquidation_status");
    const sDaysIdx = scrubbedHeader.indexOf("cape_days_left");
    const sFlagsIdx = scrubbedHeader.indexOf("data_flags");

    for (let i = 0; i < scrubbedRows.length; i++) {
      const rRow = rawRows[i] || [];
      const sRow = scrubbedRows[i] || [];

      const rawEntry = rawEntryIdx >= 0 ? rRow[rawEntryIdx] || "" : "";
      const rawFiler = rawFilerIdx >= 0 ? rRow[rawFilerIdx] || "" : "";

      const tokEntry = sRow[sEntryIdx] || "";
      const duty = sRow[sDutyIdx] || "";
      const status = sRow[sStatusIdx] || "";
      const days = sRow[sDaysIdx] || "";
      const flags = sRow[sFlagsIdx] || "";

      html += "<tr>";
      html += "<td>#" + (i + 1) + "</td>";
      html +=
        '<td><span class="cell-redacted">' +
        escapeHtml(rawEntry) +
        "</span></td>";
      html +=
        '<td><span class="cell-redacted">' +
        escapeHtml(rawFiler) +
        "</span></td>";
      html +=
        '<td><span class="cell-token">' +
        escapeHtml(tokEntry) +
        "</span></td>";
      html += "<td>$" + escapeHtml(duty) + "</td>";
      html += "<td>" + escapeHtml(status || "—") + "</td>";
      html +=
        "<td>" +
        (days ? escapeHtml(days) + "d" : '<span class="text-dim">—</span>') +
        "</td>";
      html +=
        "<td>" +
        (flags
          ? '<span class="chip chip-danger">' + escapeHtml(flags) + "</span>"
          : '<span class="tag-clean">clean</span>') +
        "</td>";
      html += "</tr>";
    }

    html += "</tbody></table></div>";
    html +=
      '<p class="small preview-caption">Redacted cells are stripped permanently. Only the tokenized output is saved to the downloaded file.</p>';
    html += "</div>";

    container.innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // 7. Scrub CSV Action
  // -------------------------------------------------------------------------
  function scrubCSVData() {
    const es = files.es.text;
    const bk = files.bk.text;
    const su = files.su.text;
    const asofInput = $("asof");
    const asOf = asofInput ? asofInput.value.trim() : "";

    const reportEl = $("report");
    const resultsPanel = $("results_panel");
    const outBox = $("outbox");
    const outTextarea = $("out");
    const scrubBtn = $("run");

    if (!es) {
      alert("Choose the ES-003 CSV first.");
      if (asofInput) asofInput.focus();
      return;
    }

    if (!asOf) {
      alert("Choose the as-of date first.");
      if (asofInput) asofInput.focus();
      return;
    }

    // Button loading state
    if (scrubBtn) {
      scrubBtn.innerHTML = '<span class="spinner"></span> Scrubbing...';
      scrubBtn.disabled = true;
    }

    setTimeout(() => {
      try {
        csvResult = Shield.scrubCSVs(es, bk, su, asOf);
        const rep = csvResult.report;
        const dropped = rep.dropped;
        const flagsList =
          Object.keys(rep.flags)
            .map((k) => k + ": " + rep.flags[k])
            .join(", ") || "none";

        const outText = Shield.entriesText(csvResult, asOf);
        const leaks = Shield.scanOutput(outText);
        const leakKinds = Object.keys(leaks)
          .map((k) => k + " (" + leaks[k] + ")")
          .join(", ");

        if (resultsPanel) resultsPanel.classList.add("visible");

        if (leakKinds) {
          csvResult = null;
          if (outTextarea) outTextarea.value = "";
          if (outBox) outBox.style.display = "none";
          if (reportEl) {
            reportEl.innerHTML =
              '<div class="alert alert-danger">' +
              "<div><strong>Blocked by Safety Scan.</strong><br>" +
              "The scrubbed text still contains what looks like: <strong>" +
              escapeHtml(leakKinds) +
              "</strong>.<br>" +
              "Download controls have been disabled to prevent accidental leaks. Remove or fix that column in your CSV and scrub again.</div></div>";
          }
          if (scrubBtn) {
            scrubBtn.innerHTML = "Scrub now";
            scrubBtn.disabled = false;
          }
          return;
        }

        // Summary cards
        const bannerCount = rep.preambleRemoved;
        const entryCount = csvResult.entries.rows.length;
        const supCount = csvResult.suppliers
          ? csvResult.suppliers.rows.length
          : 0;

        let repHtml = "";

        // Subtle success banner
        repHtml +=
          '<div class="alert alert-success">' +
          '<div class="alert-icon-check">&#10004;</div>' +
          "<div><strong>Scrubbing Complete.</strong> Identifiers stripped, tokens generated, and deadlines computed locally.</div>" +
          "</div>";

        // Metrics grid
        repHtml += '<div class="stat-cards-grid">';
        repHtml +=
          '<div class="stat-card"><div class="stat-value">' +
          bannerCount +
          '</div><div class="stat-label">Banner Lines Dropped</div></div>';
        repHtml +=
          '<div class="stat-card"><div class="stat-value">' +
          entryCount +
          '</div><div class="stat-label">Customs Entries</div></div>';
        repHtml +=
          '<div class="stat-card"><div class="stat-value">' +
          supCount +
          '</div><div class="stat-label">Supplier Records</div></div>';
        repHtml +=
          '<div class="stat-card"><div class="stat-value stat-value-sm">' +
          escapeHtml(flagsList) +
          '</div><div class="stat-label">Data Flags</div></div>';
        repHtml += "</div>";

        // Dropped columns report as chips
        const esDropped = (dropped.es || []).join(", ") || "none";
        const bkDropped = dropped.bk ? dropped.bk.join(", ") : "";
        const suDropped = dropped.su ? dropped.su.join(", ") : "";

        repHtml +=
          '<div class="dropped-columns-card">';
        repHtml +=
          '<div class="dropped-columns-title">Dropped Non-Allowlisted Columns (Permanent Removal):</div>';
        repHtml +=
          '<div class="dropped-columns-row"><strong>ES-003:</strong> ' +
          escapeHtml(esDropped) +
          "</div>";
        if (bkDropped) {
          repHtml +=
            '<div class="dropped-columns-row"><strong>Broker list:</strong> ' +
            escapeHtml(bkDropped) +
            "</div>";
        }
        if (suDropped) {
          repHtml +=
            '<div class="dropped-columns-row-last"><strong>Supplier records:</strong> ' +
            escapeHtml(suDropped) +
            "</div>";
        }
        repHtml += "</div>";

        // Warning if broker file not provided
        if (!files.bk.text) {
          repHtml +=
            '<div class="alert alert-warning">' +
            "<div><strong>No broker status list added.</strong> DutyBack will skip Phase 2, protest, and Phase 3 checks. Add the broker CSV and scrub again for a full analysis.</div></div>";
        }

        // Passed safety scan alert
        repHtml +=
          '<div class="alert alert-success">' +
          "<div><strong>Final safety scan passed.</strong> Zero emails, phone numbers, ID numbers, or raw entry numbers found in scrubbed output.</div></div>";

        if (reportEl) reportEl.innerHTML = repHtml;

        // Render Before/After Preview
        renderBeforeAfterPreview(es, csvResult);

        // Update output textarea & display download controls
        if (outTextarea) outTextarea.value = outText;
        if (outBox) outBox.style.display = "block";

        updateNetworkMetric();
      } catch (err) {
        if (reportEl) {
          reportEl.innerHTML =
            '<div class="alert alert-danger"><strong>Error:</strong> ' +
            escapeHtml(err.message) +
            "</div>";
        }
      } finally {
        if (scrubBtn) {
          scrubBtn.innerHTML = "Scrub now";
          scrubBtn.disabled = false;
        }
      }
    }, 200);
  }

  // -------------------------------------------------------------------------
  // 8. PDF Text Scrub Action
  // -------------------------------------------------------------------------
  function scrubPdfText() {
    const namesVal = $("names") ? $("names").value : "";
    const pdfVal = $("pdftext") ? $("pdftext").value : "";
    const textReport = $("textreport");
    const textOut = $("textout");

    if (!pdfVal.trim()) {
      alert("Please paste text from your PDF first.");
      return;
    }

    const namesList = namesVal.split("\n");
    textResult = Shield.scrubText(pdfVal, namesList);
    const r = textResult.report;

    let repHtml = '<div class="alert alert-success">';
    repHtml +=
      "<div>Names replaced: <strong>" +
      r.namesReplaced +
      "</strong>. Entry, invoice, protest &amp; PO numbers tokenized: <strong>" +
      r.entries +
      "</strong>. Pattern redactions: <strong>" +
      r.patterns +
      "</strong>.</div>";
    repHtml += "</div>";

    if (r.possibleNames.length) {
      repHtml +=
        '<div class="alert alert-warning">' +
        "<div><strong>Possible company names still in text:</strong> " +
        escapeHtml(r.possibleNames.join("; ")) +
        "<br>Add them to the names box and scrub again to redact.</div></div>";
    } else {
      repHtml +=
        '<div class="alert alert-success">' +
        "<div>No other company-like names detected.</div></div>";
    }

    const tOut =
      "DutyBack scrubbed text. Identifiers removed or tokenized locally.\n\n" +
      textResult.text;
    const tLeaks = Shield.scanOutput(tOut);
    const tKinds = Object.keys(tLeaks)
      .map((k) => k + " (" + tLeaks[k] + ")")
      .join(", ");

    if (tKinds) {
      if (textOut) textOut.value = "";
      repHtml +=
        '<div class="alert alert-danger"><strong>Blocked by Safety Scan.</strong> The text still contains what looks like: ' +
        escapeHtml(tKinds) +
        ". Edit the text and scrub again.</div>";
      if (textReport) textReport.innerHTML = repHtml;
      return;
    }

    if (textReport) textReport.innerHTML = repHtml;
    if (textOut) textOut.value = tOut;
    updateNetworkMetric();
  }

  // -------------------------------------------------------------------------
  // 9. Restore Action
  // -------------------------------------------------------------------------
  function restoreTokens() {
    const tokensVal = $("tokens") ? $("tokens").value : "";
    const restoredEl = $("restored");

    if (!restoreKey) {
      alert("Choose your key file first.");
      return;
    }

    if (!tokensVal.trim()) {
      alert("Paste the text from owlONE containing tokens first.");
      return;
    }

    const output = Shield.rehydrate(tokensVal, restoreKey);
    if (restoredEl) restoredEl.value = output;
  }

  // -------------------------------------------------------------------------
  // 10. Downloads & Copy Helpers
  // -------------------------------------------------------------------------
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // -------------------------------------------------------------------------
  // 10b. Lookup Table CSV Generator
  // -------------------------------------------------------------------------
  function generateLookupCSV(key) {
    if (!key || !key.tokens) return "";
    const header = "token,real_entry_number";
    const entryTokens = Object.keys(key.tokens)
      .filter((tok) => tok.startsWith("ENT-"))
      .sort((a, b) => {
        const na = parseInt(a.replace("ENT-", ""), 10) || 0;
        const nb = parseInt(b.replace("ENT-", ""), 10) || 0;
        return na - nb;
      });

    const escapeCSV = (val) => {
      const s = String(val == null ? "" : val);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const lines = [header];
    for (const t of entryTokens) {
      lines.push(t + "," + escapeCSV(key.tokens[t]));
    }
    return lines.join("\n");
  }

  function downloadLookupCSV() {
    if (!csvResult || !csvResult.key) {
      alert("Please scrub your CSV files first to generate the lookup table.");
      return;
    }
    const csvContent = generateLookupCSV(csvResult.key);
    downloadFile("dutyback-lookup-table.csv", csvContent, "text/csv;charset=utf-8");
  }

  function copyToClipboard(text, btn, successMessage) {
    const originalText = btn.textContent;
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.className = "clipboard-shim";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        btn.textContent = successMessage;
      } catch (e) {
        btn.textContent = "Press Ctrl+C to copy";
      }
      document.body.removeChild(ta);
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = successMessage;
          setTimeout(() => {
            btn.textContent = originalText;
          }, 2500);
        })
        .catch(fallback);
    } else {
      fallback();
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // -------------------------------------------------------------------------
  // 11. Tab Controller
  // -------------------------------------------------------------------------
  function switchTab(index) {
    const tabs = ["t1", "t2", "t3"];
    const panes = ["s1", "s2", "s3"];

    tabs.forEach((tabId, idx) => {
      const btn = $(tabId);
      const pane = $(panes[idx]);
      if (btn && pane) {
        if (idx === index) {
          btn.classList.add("active");
          btn.setAttribute("aria-selected", "true");
          pane.classList.add("active");
        } else {
          btn.classList.remove("active");
          btn.setAttribute("aria-selected", "false");
          pane.classList.remove("active");
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 12. Accordion Controller
  // -------------------------------------------------------------------------
  function setupAccordion() {
    const triggers = document.querySelectorAll(".faq-trigger");
    triggers.forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".faq-item");
        if (!item) return;
        const isOpen = item.classList.contains("open");
        item.classList.toggle("open", !isOpen);
        btn.setAttribute("aria-expanded", !isOpen ? "true" : "false");
      });
    });
  }

  // -------------------------------------------------------------------------
  // 13. Initialization & Event Binding
  // -------------------------------------------------------------------------
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      // Run integrity self-test on boot
      runIntegritySelfTest();

    // Redaction visual animation
    setupRedactionVisual();

    // Default as-of date to today
    const asofInput = $("asof");
    if (asofInput) {
      asofInput.value = new Date().toISOString().slice(0, 10);
    }

    // Tab buttons
    $("t1")?.addEventListener("click", () => switchTab(0));
    $("t2")?.addEventListener("click", () => switchTab(1));
    $("t3")?.addEventListener("click", () => switchTab(2));

    // Setup drag-and-drop zones
    setupDropZone("es", "f_es");
    setupDropZone("bk", "f_bk");
    setupDropZone("su", "f_su");

    // Sample data buttons
    $("hero_try_sample")?.addEventListener("click", loadSampleData);
    $("tool_try_sample")?.addEventListener("click", loadSampleData);

    // Scroll to tool button
    $("hero_scrub_files")?.addEventListener("click", () => {
      $("tool_section")?.scrollIntoView({ behavior: "smooth" });
    });

    // Scrub CSVs
    $("run")?.addEventListener("click", scrubCSVData);

    // CSV Download & Lookup CSV buttons
    $("dltxt")?.addEventListener("click", () => {
      const asOf = asofInput ? asofInput.value.trim() : "date";
      const outText = $("out") ? $("out").value : (csvResult ? Shield.entriesText(csvResult, asOf) : "");
      downloadFile("dutyback-scrubbed-" + asOf + ".txt", outText, "text/plain");
    });

    $("dl_lookup_csv")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadLookupCSV();
    });

    $("copy")?.addEventListener("click", function () {
      const outText = $("out") ? $("out").value : "";
      copyToClipboard(outText, this, "Copied! Ready for owlONE");
    });

    $("dlkey")?.addEventListener("click", () => {
      if (!csvResult || !csvResult.key) return;
      downloadFile(
        "dutyback-key-KEEP-PRIVATE.json",
        JSON.stringify(csvResult.key, null, 2),
        "application/json"
      );
    });

    // PDF Text scrubbing
    $("runtext")?.addEventListener("click", scrubPdfText);

    $("dltext")?.addEventListener("click", () => {
      const outText = $("textout") ? $("textout").value : "";
      downloadFile("dutyback-scrubbed-text.txt", outText, "text/plain");
    });

    $("copytext")?.addEventListener("click", function () {
      const outText = $("textout") ? $("textout").value : "";
      copyToClipboard(outText, this, "Copied! Ready for owlONE");
    });

    $("dltxt2")?.addEventListener("click", () => {
      const outText = $("textout") ? $("textout").value : "";
      downloadFile("dutyback-scrubbed-text.txt", outText, "text/plain");
    });

    $("dlkey2")?.addEventListener("click", () => {
      if (!textResult || !textResult.key) return;
      downloadFile(
        "dutyback-key-KEEP-PRIVATE.json",
        JSON.stringify(textResult.key, null, 2),
        "application/json"
      );
    });

    // Restore key file input
    $("keyfile")?.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            restoreKey = JSON.parse(reader.result);
            const status = $("keystatus");
            if (status) {
              const count = Object.keys(restoreKey.tokens || {}).length;
              status.innerHTML =
                '<span class="key-loaded-msg">&#10003; Loaded key: ' +
                escapeHtml(e.target.files[0].name) +
                " (" +
                count +
                " tokens)</span>";
            }
          } catch (err) {
            alert("Invalid key JSON file.");
          }
        };
        reader.readAsText(e.target.files[0]);
      }
    });

    $("restore")?.addEventListener("click", restoreTokens);

    $("copyrestored")?.addEventListener("click", function () {
      const restored = $("restored") ? $("restored").value : "";
      copyToClipboard(restored, this, "Copied restored text");
    });

    // Setup FAQ Accordion
    setupAccordion();

    // DutyBack owlONE buttons (set link destination)
    document.querySelectorAll(".owlone-link").forEach((link) => {
      link.setAttribute("href", OWLONE_URL);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });

    // Update real-time network counter
    updateNetworkMetric();
    window.addEventListener("load", updateNetworkMetric);

    // Auto-load sample demo if requested via query string
    if (window.location.search.includes("demo=true")) {
      loadSampleData();
    }
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateLookupCSV };
  }
})();


