---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - Requirement Traceability Matrix (RTM)

## 1. Summary Statistics
- **Total System Requirements**: 35
- **Covered Requirements**: 35
- **Partially Covered Requirements**: 0
- **Uncovered Requirements**: 0
- **Overall Requirement Coverage**: 100.00%

## 2. Matrix Mappings
| Requirement ID | Module | Description | Mapped Test Cases | Status |
| :--- | :--- | :--- | :--- | :--- |
| REQ-ALT-001 | Alert & Warning Generation | The GCS shall pop up persistent visual overlays and play audio alerts on critical failsafes (e.g. Battery Critical, GPS Glitch, RC Fail). | ST-009 | Covered (100%) |
| REQ-ALT-002 | Alert & Warning Generation | The GCS shall host a scrollable console panel displaying full history of status text logs received from the vehicle. | ST-072 | Covered (100%) |
| REQ-ARM-001 | Arm / Disarm Operations | The GCS shall transmit arming commands to the autopilot, verifying the pre-arm check status and armed state confirmation. | ST-021, ST-027, ST-029 | Covered (100%) |
| REQ-ARM-002 | Arm / Disarm Operations | The GCS shall transmit disarming commands, changing state from armed to disarmed with explicit visual feedback. | ST-022, ST-028 | Covered (100%) |
| REQ-CONN-001 | Vehicle Connection Management | The GCS shall auto-discover connected UAVs broadcasting MAVLink heartbeats on specified UDP/TCP ports. | ST-001, ST-006, ST-007 | Covered (100%) |
| REQ-CONN-002 | Vehicle Connection Management | The GCS shall allow manual network setup (UDP port bindings, TCP hosts, baud rates) for telemetry links. | ST-002, ST-003, ST-004, ST-008 | Covered (100%) |
| REQ-CONN-003 | Vehicle Connection Management | The GCS shall support graceful disconnection of active vehicles and clean release of socket resources. | ST-005 | Covered (100%) |
| REQ-GEO-001 | Geofence Management | The GCS shall display configured circular or polygon geofences and support altitude boundaries. | ST-051, ST-052 | Covered (100%) |
| REQ-GEO-002 | Geofence Management | The GCS shall generate warnings and display alert banners immediately (<1.0s) when a vehicle breaches geofence boundaries. | ST-053, ST-054, ST-055 | Covered (100%) |
| REQ-LOG-001 | System Logging | The GCS main process shall log UI telemetry, IPC payloads, and critical exceptions to local logs. | ST-095 | Covered (100%) |
| REQ-LOG-002 | System Logging | The GCS shall download, store, and review vehicle binary dataflash logs (.bin) and telemetry logs (.tlog) for diagnostics. | ST-019 | Covered (100%) |
| REQ-MAP-001 | Map Operations | The GCS shall render a responsive interactive map with coordinate grids, supporting offline tile caching and custom styling. | ST-067 | Covered (100%) |
| REQ-MAP-002 | Map Operations | The GCS map shall trace the vehicle's historic flight path and project its heading in real time. | ST-040 | Covered (100%) |
| REQ-MAV-001 | MAVLink Communication | The GCS shall implement the MAVLink protocol, validating heartbeat message reception at regular intervals. | ST-011, ST-012, ST-017, ST-018, ST-020 | Covered (100%) |
| REQ-MAV-002 | MAVLink Communication | The GCS shall reject corrupt or malformed MAVLink packets by validating message checksums (CRC). | ST-013 | Covered (100%) |
| REQ-MAV-003 | MAVLink Communication | The GCS shall handle packet sequencing, identifying packet loss and out-of-order delivery issues. | ST-014, ST-015, ST-016, ST-094 | Covered (100%) |
| REQ-MIS-PLAN-001 | Mission Planning | The GCS shall support drawing, adding, editing, reordering, and deleting waypoints on the mission planning interface. | ST-031, ST-032, ST-033, ST-035, ST-036 | Covered (100%) |
| REQ-MIS-PLAN-002 | Mission Planning | The GCS shall allow specifying command actions (e.g., waypoint, takeoff, land, loiter time, ROI) and target altitudes per item. | ST-034, ST-037 | Covered (100%) |
| REQ-MIS-TX-001 | Mission Upload / Download | The GCS shall execute a multi-step transaction upload handshake to transmit waypoint lists to the UAV, verifying write success. | ST-038 | Covered (100%) |
| REQ-MIS-TX-002 | Mission Upload / Download | The GCS shall download the current mission active in the autopilot, updating the mission editor panel. | ST-039 | Covered (100%) |
| REQ-MODE-001 | Flight Mode Management | The GCS shall allow the user to switch between supported autopilot flight modes (e.g., Stabilize, AltHold, Loiter, Guided, RTL, Auto). | ST-023, ST-025, ST-026 | Covered (100%) |
| REQ-MODE-002 | Flight Mode Management | The GCS shall verify that flight mode transitions complete within 1000ms and are highlighted in the UI header. | ST-024 | Covered (100%) |
| REQ-MVS-001 | Multi-Vehicle Support | The GCS shall auto-discover, track, and isolate telemetry flows for up to 5 vehicles simultaneously on a shared connection port. | ST-081, ST-083, ST-084 | Covered (100%) |
| REQ-MVS-002 | Multi-Vehicle Support | The GCS selector tabs shall switch focus, ensuring commands, parameters, and missions are directed only to the active vehicle. | ST-074, ST-082, ST-085 | Covered (100%) |
| REQ-PARAM-001 | Parameter Management | The GCS shall load full parameter lists from the autopilot and provide search, filter, and categorisation options. | ST-041, ST-042, ST-043, ST-044 | Covered (100%) |
| REQ-PARAM-002 | Parameter Management | The GCS shall write updated parameter values back to the autopilot, validating the write outcome and maintaining local caching. | ST-045, ST-046, ST-047, ST-048, ST-049, ST-050 | Covered (100%) |
| REQ-PERF-001 | Performance Monitoring | The GCS shall maintain a low footprint: CPU utilisation < 15% and RAM heap < 350MB under continuous telemetry stream. | ST-086, ST-087, ST-091, ST-092 | Covered (100%) |
| REQ-PERF-002 | Performance Monitoring | The GCS UI thread shall remain responsive, avoiding frame-drops and keeping event handling latency under 100ms. | ST-088, ST-089, ST-090, ST-093 | Covered (100%) |
| REQ-REC-001 | Recovery & Reconnection Handling | The GCS shall automatically attempt to reconnect telemetry streams upon link drop within a 2.0s threshold. | ST-076, ST-077, ST-078, ST-080 | Covered (100%) |
| REQ-REC-002 | Recovery & Reconnection Handling | The GCS state manager shall recover parameters and telemetry caches seamlessly across application reloads. | ST-079 | Covered (100%) |
| REQ-SET-001 | Settings Management | The GCS shall persist user settings, window sizes, and local directories safely between application restarts. | ST-010 | Covered (100%) |
| REQ-TEL-001 | Telemetry Monitoring | The GCS shall display live flight parameters including altitude, GPS coordinates, attitude (roll, pitch, yaw), battery voltage, and current flight mode. | ST-030, ST-056, ST-057, ST-058, ST-059, ST-060, ST-061, ST-062, ST-063, ST-064 | Covered (100%) |
| REQ-TEL-002 | Telemetry Monitoring | The GCS HUD and dashboard Gauges shall render telemetry updates smoothly at a telemetry rate of at least 10Hz. | ST-065 | Covered (100%) |
| REQ-UI-001 | UI Navigation | The GCS shall provide responsive panels (Dashboard, Parameters, Calibration, Camera) loading in under 500ms. | ST-066, ST-068 | Covered (100%) |
| REQ-UI-002 | UI Navigation | The GCS shall support clean UI scaling, fluid resizing, and a selectable high-contrast theme for outdoor field operations. | ST-069, ST-070, ST-071, ST-073, ST-075 | Covered (100%) |
