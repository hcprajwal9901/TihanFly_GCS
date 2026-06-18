# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sitl_validation.spec.js >> GCS SITL End-to-End Validation (Phase 4) >> SITL E2E: Perform flight mode transitions
- Location: test_frontend\integration_test\sitl_validation.spec.js:325:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('.mode-item[data-mode="Stabilize"]')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.mode-item[data-mode="Stabilize"]')
    13 × locator resolved to <button class="mode-item" data-mode="Stabilize">…</button>
       - unexpected value "hidden"

```

```yaml
- img "Menu"
- text: UDP
- img "Mode"
- text: Guided
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
- text: 1 DRONE ▼
- button "+"
- img "DX4 Logo"
- button "drone D-1":
  - img "drone"
  - text: D-1
- text: ALT -0.0 m SPD 0.1 m/s LAT -35.363262
- img "Compass Dial"
- img "Compass Arrow"
- text: 355° DIST 0 m SAT 10 LON 149.165237
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
- text: "✓ ✅ Mission File Manager ready 12:24:31 ✓ Backend connected 12:24:31 ✓ 🔌 Backend connected 12:24:31 ℹ ⏳ Waiting for drone... 12:24:31 ✓ 🎯 Map locked to drone GPS 12:24:31 ✓ ✅ Waypoint Manager ready 12:24:31 ✓ 🔒 Motors Disarmed 12:24:31 ✓ 🚁 Drone connected via NONE 12:24:31 ✓ 🚁 Drone connected via NONE 12:24:31 ℹ 📋 Requesting all parameters from flight controller… 12:24:31 ✓ 🚁 Drone connected via UDP 12:24:31 ✓ 🚁 Drone connected via UDP 12:24:31 ℹ ArduCopter V4.8.0-dev (6e741784) 12:24:31 ℹ Frame: QUAD/PLUS 12:24:31 ℹ cf1923076b304546a65e9b53f25e36de 12:24:31 ℹ ArduCopter V4.8.0-dev (6e741784) 12:24:31 ℹ cf1923076b304546a65e9b53f25e36de 12:24:31 ℹ Frame: QUAD/PLUS 12:24:31 ✓ 🚁 TiHANFly GCS Ready 12:24:32 ℹ 🏠 Simple home marker active 12:24:32 ℹ Click video to maximize - Click PLAN to enter flight planning 12:24:32 ✓ 💾 Complete system state restored 12:24:32 ✓ ✅ All 1371 parameters loaded in 1757 ms 12:24:33 ✓ Command executed 12:24:33 ℹ Arming motors 12:24:33 ✓ 🔓 Motors Armed 12:24:34 ✓ Command executed 12:24:36 ℹ Disarming motors 12:24:36 ✓ Command executed 12:24:36 ✓ 🔒 Motors Disarmed 12:24:36 ✗ PreArm: Need Position Estimate 12:24:38 Select Serial Port:"
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