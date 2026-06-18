# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi_vehicle_validation.spec.js >> GCS Multi-Vehicle End-to-End Validation (Phase 5) >> Multi-Vehicle: Auto-discover three vehicles on shared port 14550
- Location: test_frontend\integration_test\multi_vehicle_validation.spec.js:145:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.mv-drone-tab[data-sysid="1"]')
Expected: visible
Timeout: 45000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 45000ms
  - waiting for locator('.mv-drone-tab[data-sysid="1"]')

```

```yaml
- img "Menu"
- text: UDP
- img "Mode"
- text: Stabilize
- img "Signal"
- text: 0% SATS 10
- img "GPS"
- img "Battery"
- text: 12.6 V 100%
- button "English":
  - text: English
  - img
- button "Appearance":
  - text: Appearance
  - img
- text: 2 DRONES ▼
- button "+"
- text: D-3 DSRM ✈ STABILIZE 🔋 100% 12.6V 📡 RTK Fixed · 10 sats D-2 DSRM ✈ STABILIZE 🔋 100% 12.6V 📡 RTK Fixed · 10 sats All Drones FLEET 👥 2 Vehicles Connected ⚡ Broadcast Commands
- img "DX4 Logo"
- button "drone D-2":
  - img "drone"
  - text: D-2
- button "drone D-3":
  - img "drone"
  - text: D-3
- text: ALT -0.0 m SPD 0.0 m/s LAT -35.363262
- img "Compass Dial"
- img "Compass Arrow"
- text: 354° DIST 0 m SAT 10 LON 149.165237
- img
- text: NO SIGNAL NO SIGNAL
- textbox "rtsp://192.168.1.10:554/stream or rtmp://host/app/stream":
  - /placeholder: rtsp://192.168.1.10:554/stream  or  rtmp://host/app/stream
- button "▶ CONNECT"
- button "Toggle Video Fullscreen":
  - img
- button "Capture Photo":
  - img
- button "Start/Stop Recording":
  - img
- text: 📷 Photo saved
- button "ARM":
  - img
  - text: ARM
- button "FORCE ARM":
  - img
  - text: FORCE ARM
- button "Takeoff TAKEOFF":
  - img "Takeoff"
  - text: TAKEOFF
- button "Land LAND":
  - img "Land"
  - text: LAND
- button "RTL RTL":
  - img "RTL"
  - text: RTL
- button "Mode MODE":
  - img "Mode"
  - text: MODE
- text: "✓ ✅ Mission File Manager ready 12:25:20 ✓ Backend connected 12:25:20 ✓ 🔌 Backend connected 12:25:20 ℹ ⏳ Waiting for drone... 12:25:20 ✓ ✅ Waypoint Manager ready 12:25:20 ✓ 🔒 Motors Disarmed 12:25:20 ✓ 🚁 Drone connected via NONE 12:25:20 ✓ 🚁 Drone connected via UDP 12:25:20 ✓ 🔒 Motors Disarmed 12:25:20 ℹ 📋 Requesting all parameters from flight controller… 12:25:20 ✓ 🚁 Drone connected via NONE 12:25:20 ✓ 🚁 Drone connected via UDP 12:25:20 ℹ [D3] ArduCopter V4.8.0-dev (6e741784) 12:25:20 ℹ [D3] ArduCopter V4.8.0-dev (6e741784) 12:25:21 ℹ [D3] ef1923076b304546a65e9b53f25e36de 12:25:21 ℹ [D3] Frame: QUAD/PLUS 12:25:21 ✓ 🚁 TiHANFly GCS Ready 12:25:21 ℹ 🏠 Simple home marker active 12:25:21 ℹ Click video to maximize - Click PLAN to enter flight planning 12:25:21 ✓ 🎯 Map locked to drone GPS 12:25:21 ✓ ✅ All 1371 parameters loaded in 1449 ms 12:25:22 ✓ 💾 Complete system state restored 12:25:22 ℹ [D3] EKF3 IMU0 is using GPS 12:25:32 ℹ [D3] EKF3 IMU1 is using GPS 12:25:32 Select Serial Port:"
- table:
  - rowgroup:
    - row "Port Board ID Manufacturer Brand Description":
      - columnheader "Port"
      - columnheader "Board ID"
      - columnheader "Manufacturer"
      - columnheader "Brand"
      - columnheader "Description"
  - rowgroup:
    - row "/dev/ttyS4 n/a":
      - cell "/dev/ttyS4"
      - cell
      - cell
      - cell
      - cell "n/a"
    - row "/dev/ttyS31 n/a":
      - cell "/dev/ttyS31"
      - cell
      - cell
      - cell
      - cell "n/a"
    - row "/dev/ttyS30 n/a":
      - cell "/dev/ttyS30"
      - cell
      - cell
      - cell
      - cell "n/a"
    - row "/dev/ttyS29 n/a":
      - cell "/dev/ttyS29"
      - cell
      - cell
      - cell
      - cell "n/a"
- button "Refresh Ports"
- text: "Bootloader Baud:"
- combobox "Bootloader Baud":
  - option "115200" [selected]
  - option "57600"
  - option "38400"
  - option "9600"
- text: "Flash Baud:"
- combobox "Flash Baud":
  - option "115200" [selected]
  - option "57600"
  - option "38400"
  - option "9600"
- text: "Flashing Log: → Ready Erase Progress: Write Progress: Select Drone Type"
- img "Ti-Shadow"
- text: Ti-Shadow Surveillance Drone
- button "UNLOCK":
  - img
  - text: UNLOCK
- button "INSTALL":
  - img
  - text: INSTALL
- img "Spider Drone"
- text: Spider Drone Hexacopter Drone
- button "UNLOCK":
  - img
  - text: UNLOCK
- button "INSTALL":
  - img
  - text: INSTALL
- img "Kala Drone"
- text: Kala Drone Payload Dropping Drone
- button "UNLOCK":
  - img
  - text: UNLOCK
- button "INSTALL":
  - img
  - text: INSTALL
- img "Palyanka Drone"
- text: Palyanka Drone Air Taxi
- button "UNLOCK":
  - img
  - text: UNLOCK
- button "INSTALL":
  - img
  - text: INSTALL
- img "Chakravyuh Drone"
- text: Chakrayukhan Drone Heavy Payload Cargo Drone Industrial-grade heavy lifting
- button "UNLOCK":
  - img
  - text: UNLOCK
- button "INSTALL":
  - img
  - text: INSTALL
- text: "🟢 UDP :14550 🟢 Serial: \\\\.\\COM3"
```