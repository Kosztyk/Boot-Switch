const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 8088;
const CONFIG_PATH = path.join(__dirname, "config.json");
const BOOTNUM_RE = /^[0-9A-Fa-f]{4}$/;

// ---------- config helpers ----------

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

// ---------- small helpers ----------

function titleCase(str) {
  return String(str)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function simplifyLabel(rawLabel, bootnum) {
  if (!rawLabel) return `Boot ${bootnum}`;
  let label = rawLabel.trim();

  const hdMatch = label.match(/HD\((\d+),/i);
  const diskIdx = hdMatch ? hdMatch[1] : null;

  let base = label.split("HD(")[0].trim();
  if (!base && label.toLowerCase().startsWith("hd(")) base = "Disk";

  if (base) base = titleCase(base);

  if (base && diskIdx) return `${base} HD${diskIdx}`;

  if (!base) base = label;
  if (base.length > 40) base = base.slice(0, 37) + "...";
  return titleCase(base);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

// ---------- parse efibootmgr ----------

function parseEfibootmgr(output) {
  const lines = output.split("\n").map((l) => l.trim());
  let current = null;
  let order = [];
  const entries = [];

  for (const line of lines) {
    if (line.startsWith("BootCurrent:")) {
      current = line.split(":")[1].trim().toUpperCase();
      continue;
    }
    if (line.startsWith("BootOrder:")) {
      const raw = line.split(":")[1].trim();
      order = raw
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
      continue;
    }

    const m = line.match(/^Boot([0-9A-Fa-f]{4})\*?\s+(.+?)(\s{2,}|$)/);
    if (m) {
      const num = m[1].toUpperCase();
      const label = m[2].trim();
      entries.push({ num, rawLabel: label });
    }
  }

  if (order.length > 0) {
    entries.sort((a, b) => {
      const ia = order.indexOf(a.num);
      const ib = order.indexOf(b.num);
      if (ia === -1 && ib === -1) return a.num.localeCompare(b.num);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else {
    entries.sort((a, b) => a.num.localeCompare(b.num));
  }

  return { current, entries };
}

// ---------- express setup ----------

app.use(express.static(path.join(__dirname, "public")));

// ---------- command runner ----------

function runCommand(cmd, res, targetLabel) {
  exec(cmd, (error, stdout, stderr) => {
    console.log("[boot-switch] Command:", cmd);
    console.log("[boot-switch] STDOUT:\n" + stdout);

    if (error) {
      console.error("[boot-switch] ERROR:", error);
      console.error("[boot-switch] STDERR:\n" + stderr);

      res.status(500).send(`
        <html>
          <head>
            <title>Boot Switch Error</title>
            <link rel="icon" href="/favicon.ico" type="image/x-icon" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
          </head>
          <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#020617; color:#e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
            <div style="background:#0f172a; border-radius:1rem; padding:2rem 2.5rem; max-width:640px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.75); border:1px solid rgba(148,163,184,0.5);">
              <h1 style="margin-top:0; font-size:1.4rem; margin-bottom:0.75rem;">Failed to schedule boot to ${escapeHtml(
                targetLabel
              )}</h1>
              <p style="font-size:0.9rem; color:#9ca3af; margin-bottom:0.75rem;">The underlying command returned an error:</p>
              <pre style="background:#020617; padding:0.75rem 1rem; border-radius:0.75rem; overflow-x:auto; font-size:0.8rem; border:1px solid rgba(148,163,184,0.35); color:#e5e7eb;">${escapeHtml(
                stderr || error.message || "Unknown error"
              )}</pre>
              <p style="margin-top:1rem; font-size:0.8rem; color:#6b7280;">
                Make sure <code>efibootmgr</code> exists and this service runs as root.
              </p>
              <a href="/" style="display:inline-flex; align-items:center; gap:0.35rem; margin-top:1.25rem; font-size:0.9rem; color:#93c5fd; text-decoration:none;">
                <span style="font-size:1.1rem;">←</span> Back to boot switch
              </a>
            </div>
          </body>
        </html>
      `);
      return;
    }

    res.send(`
      <html>
        <head>
          <title>Rebooting to ${escapeHtml(targetLabel)}</title>
          <meta http-equiv="refresh" content="10; url=/" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        </head>
        <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#020617; color:#e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
          <div style="background:#0f172a; border-radius:1rem; padding:2rem 2.5rem; max-width:420px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.75); border:1px solid rgba(148,163,184,0.5); text-align:center;">
            <h1 style="margin-top:0; font-size:1.4rem; margin-bottom:0.75rem;">Rebooting to ${escapeHtml(
              targetLabel
            )}…</h1>
            <p style="font-size:0.9rem; color:#9ca3af; margin-bottom:0.75rem;">The host is now rebooting. You can close this tab.</p>
            <p style="font-size:0.75rem; color:#6b7280;">You can always fall back to the boot menu (F12, Esc, etc.) if needed.</p>
          </div>
        </body>
      </html>
    `);
  });
}

// ---------- main page ----------

app.get("/", (_req, res) => {
  exec("efibootmgr -v", (error, stdout, stderr) => {
    if (error) {
      console.error("[boot-switch] efibootmgr error:", error);
      console.error("[boot-switch] STDERR:\n" + stderr);

      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>Boot Switch – Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        </head>
        <body style="margin:0; padding:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#020617; color:#e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh;">
          <div style="background:#0f172a; border-radius:1rem; padding:2rem 2.5rem; max-width:640px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.75); border:1px solid rgba(148,163,184,0.5);">
            <h1 style="margin-top:0; font-size:1.4rem; margin-bottom:0.75rem;">Cannot read EFI boot entries</h1>
            <p style="font-size:0.9rem; color:#9ca3af; margin-bottom:0.75rem;">
              Running <code>efibootmgr -v</code> failed. Make sure this service runs on a UEFI system
              with <code>efibootmgr</code> installed and root privileges.
            </p>
            <pre style="background:#020617; padding:0.75rem 1rem; border-radius:0.75rem; overflow-x:auto; font-size:0.8rem; border:1px solid rgba(148,163,184,0.35); color:#e5e7eb;">${escapeHtml(
              stderr || error.message || "Unknown error"
            )}</pre>
          </div>
        </body>
        </html>
      `);
      return;
    }

    const info = parseEfibootmgr(stdout);
    const current = info.current;
    const config = loadConfig();

    const visibleEntries = [];
    const hiddenEntries = [];

    for (const entry of info.entries) {
      const cfg = config[entry.num] || {};
      const displayLabel =
        cfg.label || simplifyLabel(entry.rawLabel, entry.num);
      const record = {
        num: entry.num,
        rawLabel: entry.rawLabel,
        displayLabel,
      };
      if (cfg.hidden) hiddenEntries.push(record);
      else visibleEntries.push(record);
    }

    const buttonsHtml = visibleEntries
      .map((entry, idx) => {
        const isPrimary = idx === 0;
        const isCurrent = entry.num === current;
        const accent = isPrimary ? "#2563eb" : "#111827";
        const accentHover = isPrimary ? "#1d4ed8" : "#020617";
        const shadow = isPrimary
          ? "0 15px 25px -10px rgba(37, 99, 235, 0.7)"
          : "0 12px 20px -8px rgba(15, 23, 42, 0.9)";

        const title = escapeHtml(entry.displayLabel);
        const subtitle = isCurrent
          ? `BootNum: ${entry.num} · Currently booted`
          : `BootNum: ${entry.num}`;

        return `
          <form method="POST" action="/boot/${entry.num}" style="margin:0;">
            <button
              type="submit"
              data-bootnum="${entry.num}"
              data-label="${escapeAttr(entry.displayLabel)}"
              style="
                background:${accent};
                color:${isPrimary ? "#ffffff" : "#e5e7eb"};
                border-radius:999px;
                border:${isPrimary ? "none" : "1px solid rgba(148,163,184,0.5)"};
                padding:0.8rem 1.2rem;
                font-size:0.95rem;
                font-weight:600;
                cursor:pointer;
                width:100%;
                box-shadow:${shadow};
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:0.75rem;
                transition:transform 0.07s ease, box-shadow 0.07s ease, background 0.1s ease;
              "
              onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 18px 35px -14px rgba(37,99,235,0.9)'; this.style.background='${accentHover}';"
              onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='${shadow}'; this.style.background='${accent}';"
            >
              <span style="display:flex; flex-direction:column; align-items:flex-start;">
                <span>${title}</span>
                <span style="font-size:0.75rem; opacity:0.8;">${escapeHtml(
                  subtitle
                )}</span>
              </span>
              <span style="font-size:1.1rem; opacity:0.9;">↻</span>
            </button>
          </form>
        `;
      })
      .join("\n");

    const hiddenHtml =
      hiddenEntries.length === 0
        ? ""
        : `
      <div style="margin-top:1.75rem; padding-top:1rem; border-top:1px dashed rgba(75,85,99,0.7);">
        <div style="font-size:0.8rem; color:#9ca3af; margin-bottom:0.5rem;">
          Hidden entries:
        </div>
        <div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.8rem;">
          ${hiddenEntries
            .map((e) => {
              return `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
                  <span>
                    <strong>${escapeHtml(e.displayLabel)}</strong>
                    <span style="opacity:0.7;">(BootNum: ${e.num})</span>
                  </span>
                  <button
                    type="button"
                    onclick="window.unhideEntry('${e.num}')"
                    style="
                      font-size:0.75rem;
                      padding:0.25rem 0.6rem;
                      border-radius:999px;
                      border:1px solid rgba(148,163,184,0.5);
                      background:#020617;
                      color:#e5e7eb;
                      cursor:pointer;
                    "
                  >Unhide</button>
                </div>
              `;
            })
            .join("\n")}
        </div>
      </div>
    `;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Boot Switch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: radial-gradient(circle at top, #111827, #020617);
            color: #e5e7eb;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .card {
            position: relative;
            background: rgba(15, 23, 42, 0.96);
            border-radius: 1.2rem;
            padding: 2.25rem 2.5rem 2rem;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.75);
            max-width: 520px;
            width: 100%;
            border: 1px solid rgba(148, 163, 184, 0.35);
          }
          .badge {
            display:inline-flex;
            align-items:center;
            gap:0.4rem;
            padding:0.2rem 0.6rem;
            border-radius:999px;
            border:1px solid rgba(148,163,184,0.6);
            font-size:0.7rem;
            color:#9ca3af;
            margin-bottom:0.75rem;
          }
          .badge-dot {
            width:0.45rem;
            height:0.45rem;
            border-radius:999px;
            background:#22c55e;
          }
          h1 {
            font-size:1.5rem;
            margin:0 0 0.35rem 0;
          }
          .subtitle {
            font-size:0.9rem;
            color:#9ca3af;
            margin:0 0 1.5rem 0;
          }
          .buttons {
            display:flex;
            flex-direction:column;
            gap:0.75rem;
          }
          .note {
            margin-top:1.5rem;
            font-size:0.75rem;
            color:#6b7280;
          }
          .note code {
            font-size:0.7rem;
            background:#020617;
            padding:0.15rem 0.3rem;
            border-radius:0.35rem;
            border:1px solid rgba(55,65,81,0.7);
          }
          #context-menu {
            position:absolute;
            display:none;
            min-width:140px;
            background:#020617;
            border-radius:0.5rem;
            border:1px solid rgba(148,163,184,0.6);
            box-shadow:0 20px 40px -12px rgba(0,0,0,0.85);
            z-index:50;
            overflow:hidden;
          }
          #context-menu button {
            width:100%;
            padding:0.45rem 0.75rem;
            background:transparent;
            border:none;
            color:#e5e7eb;
            font-size:0.85rem;
            text-align:left;
            cursor:pointer;
          }
          #context-menu button:hover {
            background:#111827;
          }
        </style>
      </head>
      <body>
        <div class="card" id="card-root">
          <div class="badge">
            <span class="badge-dot"></span>
            <span>EFI Boot Switch</span>
          </div>
          <h1>Boot Switch</h1>
          <p class="subtitle">
            Detected UEFI boot entries. Choose one to boot <strong>next</strong>;
            the host will reboot immediately after your choice.
          </p>
          <div class="buttons">
            ${buttonsHtml || "<p>No BootXXXX entries found.</p>"}
          </div>
          ${hiddenHtml}
          <div class="note">
            Powered by <code>efibootmgr -v</code>. Current entry: <code>${escapeHtml(
              current || "unknown"
            )}</code>.
          </div>

          <div id="context-menu">
            <button id="ctx-rename">Rename…</button>
            <button id="ctx-hide">Hide</button>
          </div>
        </div>

        <script>
          document.addEventListener("DOMContentLoaded", function () {
            const card = document.getElementById("card-root");
            const menu = document.getElementById("context-menu");
            const renameBtn = document.getElementById("ctx-rename");
            const hideBtn = document.getElementById("ctx-hide");

            let currentBootnum = null;
            let currentLabel = null;

            function hideMenu() {
              menu.style.display = "none";
              currentBootnum = null;
              currentLabel = null;
            }

            document.addEventListener("click", function () {
              hideMenu();
            });

            card.addEventListener("contextmenu", function (e) {
              const target = e.target.closest("button[data-bootnum]");
              if (!target) return;
              e.preventDefault();

              currentBootnum = target.getAttribute("data-bootnum");
              currentLabel = target.getAttribute("data-label") || "";

              const rect = card.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;

              menu.style.left = x + "px";
              menu.style.top = y + "px";
              menu.style.display = "block";
            });

            renameBtn.addEventListener("click", function () {
              if (!currentBootnum) return;
              const bootnum = currentBootnum;        // copy before hideMenu()
              const labelBefore = currentLabel;
              const newLabel = prompt("New name:", labelBefore);
              hideMenu();
              if (!newLabel) return;

              const url =
                "/rename?bootnum=" +
                encodeURIComponent(bootnum) +
                "&label=" +
                encodeURIComponent(newLabel);
              window.location.href = url;
            });

            hideBtn.addEventListener("click", function () {
              if (!currentBootnum) return;
              const bootnum = currentBootnum;        // copy before hideMenu()
              hideMenu();

              const url =
                "/hide?bootnum=" +
                encodeURIComponent(bootnum) +
                "&hidden=1";
              window.location.href = url;
            });

            window.unhideEntry = function (bootnum) {
              const url =
                "/hide?bootnum=" +
                encodeURIComponent(bootnum) +
                "&hidden=0";
              window.location.href = url;
            };
          });
        </script>
      </body>
      </html>
    `);
  });
});

// ---------- rename / hide via GET ----------

app.get("/rename", (req, res) => {
  const bootStr = String(req.query.bootnum || "").toUpperCase();
  const label = String(req.query.label || "").trim();

  console.log("[boot-switch] /rename", { bootStr, label });

  if (!BOOTNUM_RE.test(bootStr) || !label) {
    return res.redirect("/");
  }

  const cfg = loadConfig();
  cfg[bootStr] = cfg[bootStr] || {};
  cfg[bootStr].label = label;
  saveConfig(cfg);
  res.redirect("/");
});

app.get("/hide", (req, res) => {
  const bootStr = String(req.query.bootnum || "").toUpperCase();
  const hidden = req.query.hidden === "1";

  console.log("[boot-switch] /hide", { bootStr, hidden });

  if (!BOOTNUM_RE.test(bootStr)) {
    return res.redirect("/");
  }

  const cfg = loadConfig();
  cfg[bootStr] = cfg[bootStr] || {};
  cfg[bootStr].hidden = hidden;
  saveConfig(cfg);
  res.redirect("/");
});

// ---------- boot endpoint ----------

app.post("/boot/:bootnum", (req, res) => {
  const bootStr = String(req.params.bootnum || "").toUpperCase();

  if (!BOOTNUM_RE.test(bootStr)) {
    return res.status(400).send("Invalid BootNum");
  }

  const cfg = loadConfig();
  const labelCfg = cfg[bootStr];
  const targetLabel =
    labelCfg && labelCfg.label ? labelCfg.label : `BootNum ${bootStr}`;

  const cmd = `efibootmgr -n ${bootStr} && reboot`;
  runCommand(cmd, res, targetLabel);
});

// ---------- start ----------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Boot switch listening on http://0.0.0.0:${PORT}`);
});
