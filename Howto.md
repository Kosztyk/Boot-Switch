Step 1. On ProxmoxServer host, do: 

mkdir -p /opt/boot-switch
mkdir -p /opt/boot-switch/public
cp /path/to/your/favicon.ico /opt/boot-switch/public/favicon.ico

cd /opt/boot-switch


apt update
apt install -y efibootmgr nodejs npm
npm init -y
npm install express

Step 2. Then test:

cd /opt/boot-switch

node app.js

Open in browser:

http://<pve-ip>:8088/

Step 3. Make it a systemd service (autostart)

nano /etc/systemd/system/boot-switch.service

paste 

 "[Unit]
Description=Simple web boot switch (Proxmox/ZimaOS)
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
WantedBy=multi-user.target"

then 

systemctl daemon-reload
systemctl enable --now boot-switch.service
systemctl status boot-switch.service
