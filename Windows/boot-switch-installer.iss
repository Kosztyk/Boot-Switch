; boot-switch-installer.iss
; Inno Setup script to install EFI Boot Switch for Windows

[Setup]
AppName=EFI Boot Switch
AppVersion=1.0.0
DefaultDirName={commonpf}\boot-switch
DefaultGroupName=EFI Boot Switch
OutputDir=.
OutputBaseFilename=boot-switch-setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
DisableDirPage=no
; Icon for the installer EXE itself
SetupIconFile=public\favicon.ico

[Files]
; Main executable
Source: "boot-switch.exe"; DestDir: "{app}"; Flags: ignoreversion
; Web favicon served by the app at /favicon.ico
Source: "public\favicon.ico"; DestDir: "{app}\public"; Flags: ignoreversion

[Icons]
; Start Menu shortcut: open web UI, use same favicon as icon
Name: "{group}\EFI Boot Switch"; \
  Filename: "{win}\explorer.exe"; \
  Parameters: "http://localhost:8088/"; \
  IconFilename: "{app}\public\favicon.ico"

; Optional desktop shortcut: same icon
Name: "{userdesktop}\EFI Boot Switch"; \
  Filename: "{win}\explorer.exe"; \
  Parameters: "http://localhost:8088/"; \
  IconFilename: "{app}\public\favicon.ico"; \
  Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
; Create a scheduled task "BootSwitch" that runs boot-switch.exe at SYSTEM startup.
Filename: "{sys}\schtasks.exe"; \
    Parameters: "/Create /TN ""BootSwitch"" /SC ONSTART /RU ""SYSTEM"" /RL HIGHEST /TR ""\""{app}\boot-switch.exe\"""" /F"

; Run the task once immediately so you don't need to reboot to test
Filename: "{sys}\schtasks.exe"; Parameters: "/Run /TN ""BootSwitch"""
