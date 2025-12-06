<img width="64" height="64" alt="favicon_converted" src="https://github.com/user-attachments/assets/23a0a10c-e21f-402a-bb89-75b38b601bc0" />

# EFI Boot Switch Web UI

A tiny Node.js web app that lets you pick **which UEFI boot entry should be used on the next reboot**, directly from your browser.

Typical use case:  
You have a small box (HP M700, NUC, etc.) with multiple OSes installed on different disks (e.g. **Proxmox** on one drive and **ZimaOS / Ubuntu / another OS** on another drive).  
Instead of spamming **F12** at boot to choose what to start, you open a web page on the host and click:

- **“Boot Proxmox next”**
- **“Boot ZimaOS next”**
- …or any other EFI entry you have.

The app uses `efibootmgr -v` to:

- Detect all `BootXXXX` entries
- Show them in a clean UI (`Proxmox HD2`, `ZimaOS HD1`, `USB`, etc.)
- Let you **rename entries**, **hide entries** you don’t care about, and **unhide** them later
- When you click a button, it runs:  
  `efibootmgr -n <BootNum> && reboot`

> ⚠️ **Important**
> - This must run on the host in **UEFI mode**.
> - The service must have sufficient privileges (normally **root**) to call `efibootmgr` and `reboot`.
> - Use at your own risk – changing boot entries can make your system unbootable if misused.
>
> <img width="792" height="695" alt="image" src="https://github.com/user-attachments/assets/e4cafd8b-1b7d-412a-8b6a-62402b753df0" />


---

## Features

- Auto-detects all `BootXXXX` entries via `efibootmgr -v`
- Nicely formatted cards for each entry, with:
  - Simple name (e.g. `Proxmox HD2`, `UEFI OS HD1`)
  - `BootNum` and “Currently booted” indicator
- **Right-click context menu** on an entry:
  - **Rename…** – change display name, stored in `config.json`
  - **Hide** – hides the entry from the main list
- **Hidden entries section** with an **Unhide** button per entry
- Uses a **favicon** from `/opt/boot-switch/public/favicon.ico`
- Clean dark UI, responsive, minimal dependencies (only `express`)

---

## Requirements

On the host where you run this (e.g. Proxmox server):

- UEFI firmware (not Legacy BIOS)
- `efibootmgr` installed
- Node.js + npm
- Network access to the host from your browser

You can verify UEFI mode with:

```bash
[ -d /sys/firmware/efi ] && echo "UEFI mode" || echo "Legacy/BIOS mode"
```

---

## Installation (Proxmox host / generic Debian)

### 1. Create app directory structure

```bash
sudo mkdir -p /opt/boot-switch/public
sudo touch /opt/boot-switch/config.json
```

Copy your favicon into the public folder:

```bash
sudo cp /path/to/your/favicon.ico /opt/boot-switch/public/favicon.ico
```

Then put the app code in place (this repo’s `app.js`, plus `package.json` if you use it) under `/opt/boot-switch`:

```bash
cd /opt/boot-switch
# place app.js here
```

> `config.json` is used internally to store:
> - renamed labels per `BootNum`
> - hidden/unhidden state per entry

---

### 2. Install dependencies

On a Debian/Proxmox-like host:

```bash
sudo apt update
sudo apt install -y efibootmgr nodejs npm
```

Inside `/opt/boot-switch`:

```bash
cd /opt/boot-switch

npm init -y
npm install express
```

You should now have:

```text
/opt/boot-switch/
  app.js
  package.json
  package-lock.json
  config.json
  public/
    favicon.ico
```

---

### 3. Test run

Start the app manually:

```bash
cd /opt/boot-switch
sudo node app.js
```

If everything’s OK, you’ll see something like:

```text
Boot switch listening on http://0.0.0.0:8088
```

Now open in your browser:

```text
http://<host-ip>:8088/
```

You should see:

- A “Boot Switch” card
- Buttons for each detected EFI boot entry (`Boot0000`, `Boot0001`, …)
- Right-click context menu on each button (Rename / Hide)

Pressing a button should:

1. Call `efibootmgr -n <BootNum>`
2. Reboot the host

---

## 4. Run as a systemd service (autostart)

Create a service unit file:

```bash
sudo nano /etc/systemd/system/boot-switch.service
```

Add:

```ini
[Unit]
Description=Simple web boot switch (EFI OS selector)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/boot-switch
ExecStart=/usr/bin/node /opt/boot-switch/app.js
Restart=always
User=root
Group=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Reload systemd and enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now boot-switch.service
sudo systemctl status boot-switch.service
```

If it’s running, you’ll see `active (running)`.

Now the app will:

- Start automatically on boot
- Be reachable at `http://<host-ip>:8088/` as long as the host is up

---

## Usage

1. Open `http://<host-ip>:8088/` in your browser.
2. Review the list of detected boot entries.
3. Optional:
   - **Right-click → Rename** to give something a friendly name like “Proxmox HD2” or “ZimaOS NVMe”.
   - **Right-click → Hide** for entries you don’t care about (e.g. network boot, DVD).
   - Use the **Hidden entries** section at the bottom to **Unhide** anything later.
4. Click a button to set that entry as **BootNext** and immediately reboot to it.

---
## For Windows:

just download the boot-switch-setup.exe from windows folder and install it.

## Notes & Caveats

- The service must have enough privileges to run `efibootmgr` and `reboot` –
  that’s why the systemd service is configured as `User=root`.
- Misconfiguring UEFI entries with `efibootmgr` can make your system unbootable.
  Only hide/rename entries and use BootNext on entries you understand.
- This app **does not** modify `BootOrder` permanently; it uses `efibootmgr -n`
  to set the **next** boot target only.
- `config.json` is purely for UI preferences (names + hidden state); if you remove it,
  the app will fall back to the raw EFI labels and show everything.

---


