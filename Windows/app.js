// Windows-hosted EFI Boot Switch
// Uses `bcdedit /enum firmware` and `bcdedit /set {fwbootmgr} bootsequence {GUID}`
// Requires: Windows in UEFI mode, run as Administrator

const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");

// When packaged with pkg, process.pkg is defined.
// Use the directory of the executable instead of __dirname.
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const app = express();

// Port for the web UI
const PORT = process.env.PORT || 8088;

// Where we store rename/hide preferences
const CONFIG_PATH = path.join(APP_DIR, "config.yaml");

// GUID validator: {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}
const GUID_RE = /^\{[0-9A-Fa-f-]+\}$/;

// ---------- initial bootstrap (folders + config + favicon) ----------

(function bootstrapFileSystem() {
  try {
    if (!fs.existsSync(APP_DIR)) {
      fs.mkdirSync(APP_DIR, { recursive: true });
    }

    // Ensure public directory
    const publicDir = path.join(APP_DIR, "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
      console.log("[boot-switch-win] Created public/ directory");
    }

    // Ensure favicon.ico exists (placeholder; safe to replace with a real icon)
    const faviconPath = path.join(publicDir, "favicon.ico");
    if (!fs.existsSync(faviconPath)) {
      const placeholder = Buffer.from(
        "boot-switch icon placeholder – replace public/favicon.ico with your own .ico",
        "utf8"
      );
      fs.writeFileSync(faviconPath, placeholder);
      console.log("[boot-switch-win] Created placeholder favicon.ico");
    }

    // Ensure config.yaml exists
    if (!fs.existsSync(CONFIG_PATH)) {
      const initial = yaml.dump({ entries: {} }, { noRefs: true, indent: 2 });
      fs.writeFileSync(CONFIG_PATH, initial, "utf8");
      console.log("[boot-switch-win] Created default config.yaml");
    }
  } catch (e) {
    console.error("[boot-switch-win] bootstrap error:", e);
  }
})();

// ---------- config helpers ----------

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const data = yaml.load(raw) || {};
    if (typeof data.entries !== "object" || data.entries === null) {
      data.entries = {};
    }
    return data;
  } catch (_) {
    return { entries: {} };
  }
}

function saveConfig(cfg) {
  const safeCfg = { entries: cfg.entries || {} };
  const y = yaml.dump(safeCfg, { noRefs: true, indent: 2 });
  fs.writeFileSync(CONFIG_PATH, y, "utf8");
}

// ---------- small helpers ----------

function titleCase(str) {
  return String(str)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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

function simplifyLabel(description, header) {
  if (description && description.trim()) {
    return description.trim();
  }
  if (header && header.trim()) {
    const base = header.split("(")[0].trim();
    return titleCase(base || "Firmware Entry");
  }
  return "Firmware Entry";
}

// ---------- parse `bcdedit /enum firmware` ----------
//
// We keep only "Firmware Application" blocks and pull:
//  - identifier {GUID}
//  - description (if present)
//
function parseBcdFirmware(output) {
  const lines = output.split("\n").map((l) => l.replace(/\r$/, "").trim());
  const entries = [];

  let currentHeader = null;
  let currentLines = [];
  let inFirmwareAppBlock = false;

  function flushBlock() {
    if (!inFirmwareAppBlock || currentLines.length === 0) {
      currentHeader = null;
      currentLines = [];
      inFirmwareAppBlock = false;
      return;
    }

    let id = null;
    let description = null;

    for (const line of currentLines) {
      // identifier              {GUID}
      let m = line.match(/^identifier\s+(.+)$/i);
      if (m) {
        id = m[1].trim();
        continue;
      }
      // description             Something
      m = line.match(/^description\s+(.+)$/i);
      if (m) {
        description = m[1].trim();
        continue;
      }
    }

    if (id && GUID_RE.test(id)) {
      entries.push({
        id,
        description: description || "",
        header: currentHeader || "",
      });
    }

    currentHeader = null;
    currentLines = [];
    inFirmwareAppBlock = false;
  }

  for (const line of lines) {
    if (!line) {
      flushBlock();
      continue;
    }

    if (line.startsWith("Firmware Application")) {
      flushBlock();
      currentHeader = line;
      currentLines = [];
      inFirmwareAppBlock = true;
      continue;
    }

    if (inFirmwareAppBlock) {
      currentLines.push(line);
    }
  }
  flushBlock();

  return entries;
}

// ---------- express setup ----------

// Serve favicon and static assets from APP_DIR/public
app.use(express.static(path.join(APP_DIR, "public")));

// ---------- command runner ----------

function runCommand(cmd, res, targetLabel) {
  exec(cmd, (error, stdout, stderr) => {
    console.log("[boot-switch-win] Command:", cmd);
    console.log("[boot-switch-win] STDOUT:\n" + stdout);

    if (error) {
      console.error("[boot-switch-win] ERROR:", error);
      console.error("[boot-switch-win] STDERR:\n" + stderr);

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
                Make sure this service is running in an elevated terminal (Administrator)
                and that <code>bcdedit</code> is available.
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
            <p style="font-size:0.9rem; color:#9ca3af; margin-bottom:0.75rem;">The machine is now rebooting. You can close this tab.</p>
            <p style="font-size:0.75rem; color:#6b7280;">You can always fall back to your firmware boot menu (F12, Esc, etc.) if needed.</p>
          </div>
        </body>
      </html>
    `);
  });
}

// ---------- main page ----------

app.get("/", (_req, res) => {
  exec("bcdedit /enum firmware", (error, stdout, stderr) => {
    if (error) {
      console.error("[boot-switch-win] bcdedit error:", error);
      console.error("[boot-switch-win] STDERR:\n" + stderr);

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
            <h1 style="margin-top:0; font-size:1.4rem; margin-bottom:0.75rem;">Cannot read firmware boot entries</h1>
            <p style="font-size:0.9rem; color:#9ca3af; margin-bottom:0.75rem;">
              Running <code>bcdedit /enum firmware</code> failed. Make sure this app is running in an
              elevated (Administrator) terminal on a UEFI Windows system.
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

    const entries = parseBcdFirmware(stdout);
    const cfg = loadConfig();
    const cfgEntries = cfg.entries || {};

    const visibleEntries = [];
    const hiddenEntries = [];

    for (const entry of entries) {
      const c = cfgEntries[entry.id] || {};
      const displayLabel =
        c.label || simplifyLabel(entry.description, entry.header);

      const record = {
        id: entry.id,
        description: entry.description,
        header: entry.header,
        displayLabel,
      };

      if (c.hidden) hiddenEntries.push(record);
      else visibleEntries.push(record);
    }

    const buttonsHtml =
      visibleEntries.length === 0
        ? "<p>No firmware boot entries found.</p>"
        : visibleEntries
            .map((entry, idx) => {
              const isPrimary = idx === 0;
              const accent = isPrimary ? "#2563eb" : "#111827";
              const accentHover = isPrimary ? "#1d4ed8" : "#020617";
              const shadow = isPrimary
                ? "0 15px 25px -10px rgba(37, 99, 235, 0.7)"
                : "0 12px 20px -8px rgba(15, 23, 42, 0.9)";

              const title = escapeHtml(entry.displayLabel);
              const subtitle = `GUID: ${entry.id}`;

              return `
                <form method="POST" action="/boot/${encodeURIComponent(
                  entry.id
                )}" style="margin:0;">
                  <button
                    type="submit"
                    data-id="${escapeAttr(entry.id)}"
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
                    <span style="opacity:0.7;">(${escapeHtml(e.id)})</span>
                  </span>
                  <button
                    type="button"
                    onclick="window.unhideEntry('${escapeAttr(e.id)}')"
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
        <title>Boot Switch – Windows Firmware</title>
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
            <span>EFI Boot Switch (Windows)</span>
          </div>
          <h1>Boot Switch</h1>
          <p class="subtitle">
            Detected firmware boot entries from <code>bcdedit /enum firmware</code>.
            Choose one to boot <strong>next</strong>; the machine will reboot immediately.
          </p>
          <div class="buttons">
            ${buttonsHtml}
          </div>
          ${hiddenHtml}
          <div class="note">
            This uses <code>bcdedit /set {fwbootmgr} bootsequence {GUID}</code> and
            <code>shutdown /r /t 0</code>. Run this server as Administrator.
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

            let currentId = null;
            let currentLabel = null;

            function hideMenu() {
              menu.style.display = "none";
              currentId = null;
              currentLabel = null;
            }

            document.addEventListener("click", function () {
              hideMenu();
            });

            card.addEventListener("contextmenu", function (e) {
              const target = e.target.closest("button[data-id]");
              if (!target) return;
              e.preventDefault();

              currentId = target.getAttribute("data-id");
              currentLabel = target.getAttribute("data-label") || "";

              const rect = card.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;

              menu.style.left = x + "px";
              menu.style.top = y + "px";
              menu.style.display = "block";
            });

            renameBtn.addEventListener("click", function () {
              if (!currentId) return;
              const idCopy = currentId;
              const labelCopy = currentLabel;
              const newLabel = prompt("New name:", labelCopy);
              hideMenu();
              if (!newLabel) return;

              const url =
                "/rename?id=" +
                encodeURIComponent(idCopy) +
                "&label=" +
                encodeURIComponent(newLabel);
              window.location.href = url;
            });

            hideBtn.addEventListener("click", function () {
              if (!currentId) return;
              const idCopy = currentId;
              hideMenu();

              const url =
                "/hide?id=" +
                encodeURIComponent(idCopy) +
                "&hidden=1";
              window.location.href = url;
            });

            window.unhideEntry = function (id) {
              const url =
                "/hide?id=" +
                encodeURIComponent(id) +
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
  const id = String(req.query.id || "").trim();
  const label = String(req.query.label || "").trim();

  console.log("[boot-switch-win] /rename", { id, label });

  if (!GUID_RE.test(id) || !label) {
    return res.redirect("/");
  }

  const cfg = loadConfig();
  cfg.entries = cfg.entries || {};
  cfg.entries[id] = cfg.entries[id] || {};
  cfg.entries[id].label = label;
  saveConfig(cfg);

  res.redirect("/");
});

app.get("/hide", (req, res) => {
  const id = String(req.query.id || "").trim();
  const hidden = req.query.hidden === "1";

  console.log("[boot-switch-win] /hide", { id, hidden });

  if (!GUID_RE.test(id)) {
    return res.redirect("/");
  }

  const cfg = loadConfig();
  cfg.entries = cfg.entries || {};
  cfg.entries[id] = cfg.entries[id] || {};
  cfg.entries[id].hidden = hidden;
  saveConfig(cfg);

  res.redirect("/");
});

// ---------- boot endpoint ----------

app.post("/boot/:id", (req, res) => {
  const idRaw = req.params.id || "";
  const id = decodeURIComponent(idRaw).trim();

  if (!GUID_RE.test(id)) {
    return res.status(400).send("Invalid firmware GUID");
  }

  const cfg = loadConfig();
  const c = (cfg.entries || {})[id];
  const targetLabel = (c && c.label) || id;

  const cmd = `bcdedit /set {fwbootmgr} bootsequence ${id} && shutdown /r /t 0`;
  runCommand(cmd, res, targetLabel);
});

// Start server with defensive error handler
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Boot switch listening on http://0.0.0.0:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Not starting a second instance.`);
    // Exit with 0 so Task Scheduler doesn't treat this as a failure
    process.exit(0);
  } else {
    console.error("Unhandled server error:", err);
    // Non-zero so we see real problems
    process.exit(1);
  }
});

