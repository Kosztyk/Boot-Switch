# How to build EFI Boot Switch for Windows (`boot-switch.exe` + installer)

This guide explains **all the steps and dependencies** required to:

1. Build the standalone `boot-switch.exe` from source.
2. Create a Windows installer `boot-switch-setup.exe` that:
   - Installs the app to `C:\Program Files\boot-switch`
   - Installs the favicon and config path
   - Creates a **scheduled task** that runs the app at **system startup** as `SYSTEM`
   - Creates Start Menu and optional desktop shortcuts that open the web UI

> These instructions assume you already have the project source files (`app.js`, `package.json`, and `boot-switch-installer.iss`) in a folder, as described below.

---

## 1. Requirements & dependencies

### 1.1. Operating system

- Windows 10 / 11, 64‑bit
- System must be booted in **UEFI mode**, because the app uses `bcdedit /enum firmware`.

### 1.2. Software you need

1. **Node.js (includes npm)**
   - Download from: <https://nodejs.org/>
   - Install the **LTS** 64‑bit version.
   - Make sure the installer option **“Add to PATH”** is enabled.

2. **pkg** (to build a single `.exe` from Node script)
   - Will be installed using `npm` (see steps below).

3. **Inno Setup** (to build the Windows installer)
   - Download from: <https://jrsoftware.org/isinfo.php>
   - Install Inno Setup 6.x (or newer).

---

## 2. Project layout

Create a working directory for the project, for example:

```powershell
mkdir C:oot-switch-src
cd C:oot-switch-src
```

Inside `C:oot-switch-src`, you should have:

```text
C:oot-switch-src  app.js                     # main Node.js app (Windows version)
  package.json               # project definition
  public    favicon.ico              # icon for web UI and installer
  boot-switch-installer.iss  # Inno Setup script
```

### 2.1. Files overview

- **`app.js`**  
  Node.js web application that:
  - Reads UEFI firmware entries via `bcdedit /enum firmware`
  - Shows them in a web UI
  - Lets you pick one to boot next (`bcdedit /set {fwbootmgr} bootsequence {GUID}` + `shutdown /r /t 0`)
  - Stores rename/hide preferences in `config.yaml`
  - Serves `/favicon.ico` from `publicavicon.ico`
  - Listens on `http://localhost:8088`

- **`package.json`**  
  Declares dependencies:
  - `express`
  - `js-yaml`
  - `pkg` (dev dependency or global tool)

- **`publicavicon.ico`**  
  Icon shown in the browser tab and used as the installer/app icon.

- **`boot-switch-installer.iss`**  
  Inno Setup script that:
  - Installs `boot-switch.exe` and `favicon.ico`
  - Registers a Task Scheduler job `BootSwitch` to autostart on boot
  - Creates Start Menu / optional desktop shortcuts that open `http://localhost:8088/`

> All these files are already prepared in your project; this document focuses on *how to build*.

---

## 3. Install Node.js and verify `node` / `npm`

1. Install Node.js from <https://nodejs.org/> (LTS, 64‑bit).
2. Close all Command Prompt / PowerShell windows.
3. Open a **new** PowerShell and run:

```powershell
node -v
npm -v
```

You should see version numbers for both.

### 3.1. If PowerShell blocks `npm.ps1` (execution policy error)

If you see an error like:

> *“running scripts is disabled on this system”*

run this **once per PowerShell session**:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then retry:

```powershell
npm -v
```

> Alternatively, you can use **Command Prompt (cmd.exe)** instead of PowerShell; it doesn’t enforce PowerShell execution policy.

---

## 4. Install project dependencies

From the project folder:

```powershell
cd C:oot-switch-src

npm install
```

This will install:

- `express`
- `js-yaml`
- `pkg` (as dev dependency, if defined in `package.json`)

You can test the app directly (without packaging) with:

```powershell
node app.js
```

Then open in your browser:

```text
http://localhost:8088/
```

You should see the **Boot Switch** UI.  
(You may need to run PowerShell **as Administrator** for `bcdedit` and `shutdown` to work.)

Stop the app with **Ctrl+C** in the terminal.

---

## 5. Build the standalone `boot-switch.exe` with `pkg`

From `C:oot-switch-src`:

```powershell
npx pkg app.js --target node18-win-x64 --output boot-switch.exe
```

This will:

- Bundle the Node runtime + your app into a single `boot-switch.exe`.
- Keep the config and `public` directory **external**, so they can live next to the exe at install time.

After this, your folder should contain:

```text
C:oot-switch-src  app.js
  package.json
  node_modules  boot-switch.exe      # standalone executable
  public    favicon.ico
  boot-switch-installer.iss
```

You can test the exe directly:

```powershell
.oot-switch.exe
```

The console should show something like:

```text
Windows boot switch listening on http://localhost:8088
```

Open `http://localhost:8088/` in your browser to confirm it works.  
Press **Ctrl+C** to stop.

---

## 6. Build the Windows installer with Inno Setup

### 6.1. Inno Setup script

Your `boot-switch-installer.iss` should look like this:

```ini
; boot-switch-installer.iss
; Inno Setup script to install EFI Boot Switch for Windows

[Setup]
AppName=EFI Boot Switch
AppVersion=1.0.0
DefaultDirName={commonpf}oot-switch
DefaultGroupName=EFI Boot Switch
OutputDir=.
OutputBaseFilename=boot-switch-setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
DisableDirPage=no
; Icon for the installer EXE itself
SetupIconFile=publicavicon.ico

[Files]
; Main executable
Source: "boot-switch.exe"; DestDir: "{app}"; Flags: ignoreversion
; Web favicon served by the app at /favicon.ico
Source: "publicavicon.ico"; DestDir: "{app}\public"; Flags: ignoreversion

[Icons]
; Start Menu shortcut: open web UI, use same favicon as icon
Name: "{group}\EFI Boot Switch";   Filename: "{win}\explorer.exe";   Parameters: "http://localhost:8088/";   IconFilename: "{app}\publicavicon.ico"

; Optional desktop shortcut: same icon
Name: "{userdesktop}\EFI Boot Switch";   Filename: "{win}\explorer.exe";   Parameters: "http://localhost:8088/";   IconFilename: "{app}\publicavicon.ico";   Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
; Create a scheduled task "BootSwitch" that runs boot-switch.exe at SYSTEM startup.
Filename: "{sys}\schtasks.exe";     Parameters: "/Create /TN ""BootSwitch"" /SC ONSTART /RU ""SYSTEM"" /RL HIGHEST /TR """"{app}oot-switch.exe"""" /F"

; Run the task once immediately so you don't need to reboot to test
Filename: "{sys}\schtasks.exe"; Parameters: "/Run /TN ""BootSwitch"""
```

### 6.2. Compile the installer

1. Open **Inno Setup**.
2. Click **File → Open**, select `boot-switch-installer.iss`.
3. Click **Build → Compile**.

If everything is correct, Inno will create:

```text
C:oot-switch-src  boot-switch-setup.exe
```

This is your **installer**.

---

## 7. Install and test the application

1. Run `boot-switch-setup.exe`.
2. Accept the UAC prompt (it needs admin rights).
3. Choose defaults (installation path will be `C:\Program Filesoot-switch`).
4. Finish the wizard.

The installer will:

- Copy `boot-switch.exe` to `C:\Program Filesoot-switch\`
- Copy `publicavicon.ico` to `C:\Program Filesoot-switch\publicavicon.ico`
- Create a **Task Scheduler** job named `BootSwitch` that:
  - Runs `C:\Program Filesoot-switchoot-switch.exe`
  - Triggers **On system startup**
  - Runs as **SYSTEM**
- Run the task once immediately so you can test without rebooting
- Add shortcuts:
  - Start Menu → EFI Boot Switch (opens `http://localhost:8088/`)
  - Optional desktop icon (same behavior)

### 7.1. Verify the task

Open an elevated PowerShell and run:

```powershell
schtasks /Query /TN "BootSwitch" /V /FO LIST
```

You should see:

- `TaskName: \BootSwitch`
- `Schedule: On startup`
- `Run As User: SYSTEM`
- `Last Run Result: 0x0` (success)

### 7.2. Test after reboot

1. Reboot Windows.
2. Log in.
3. Open a browser and go to:

```text
http://localhost:8088/
```

The app should load automatically (no need to start anything manually).

You can also use the **Start Menu shortcut** “EFI Boot Switch”, which simply opens the same URL.

---

## 8. Troubleshooting

### 8.1. `npm` not recognized

- Open **a new** PowerShell or Command Prompt after installing Node.js.
- If still not recognized, reboot once and try again.
- Or reinstall Node.js ensuring **“Add to PATH”** is selected.

### 8.2. PowerShell execution policy blocks `npm.ps1`

Run in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run `npm install` again, or use **Command Prompt** instead.

### 8.3. Web UI doesn’t open after reboot

- Check Task Scheduler:

```powershell
schtasks /Query /TN "BootSwitch" /V /FO LIST
```

- Verify:
  - The **Task path** is `\BootSwitch`.
  - **Run As User** is `SYSTEM`.
  - **Task To Run** points to `C:\Program Filesoot-switchoot-switch.exe`.
- Check Windows Firewall if you’re trying to access it remotely; locally, `http://localhost:8088/` should work without extra firewall rules.

### 8.4. EFI entries look wrong or `bcdedit` fails

- Make sure you run on a **UEFI Windows install**.
- Run `bcdedit /enum firmware` manually in an elevated terminal to see what the system returns.
- The app only works with what `bcdedit` exposes; if firmware entries are missing, there is nothing to display.

---

## 9. Summary

Once you’ve followed this guide, you’ll have:

- A self-contained `boot-switch.exe` built with **pkg**.
- A user-friendly installer `boot-switch-setup.exe` built with **Inno Setup**.
- A Windows system where **EFI Boot Switch**:
  - Runs automatically in the background at startup (scheduled task as SYSTEM).
  - Offers a clean web UI at `http://localhost:8088/`.
  - Lets you rename/hide firmware entries and pick which one to boot next, without going into BIOS/UEFI menus.
