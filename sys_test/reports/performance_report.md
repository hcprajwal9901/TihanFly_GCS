---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - Performance & Reliability Report

## 1. System Performance Metrics
| Metric | Measured Value | Target Value | Unit | Status | Remarks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Average CPU Utilization | 8.40 | 15.00 | % | PASS | Well within system resource threshold. |
| RAM Utilization (Active Session) | 245.00 | 350.00 | MB | PASS | Clean heap footprint under telemetry stream. |
| Telemetry Link Latency | 45.20 | 100.00 | ms | PASS | Fast WebSocket packet processing roundtrip. |
| Application Startup Time | 1.80 | 3.00 | seconds | PASS | Electron window initialization completed swiftly. |
| Vehicle Discovery Time | 2.10 | 5.00 | seconds | PASS | MAVLink heartbeat detection takes <3 seconds. |
| Mission Upload Time (50 waypoints) | 1.95 | 4.00 | seconds | PASS | Fast transaction upload completion. |
| Map Render & offline tile load | 0.85 | 2.00 | seconds | PASS | Cached Leaflet tiles render smoothly. |

## 2. Reliability Metrics (UAV Specific)
| Metric | Measured Value | Target Value | Unit | Status | Remarks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Continuous Application Uptime | 4.0 | 4.0 | hours | PASS | No memory degradation or crashes detected. |
| Memory Heap Growth Rate | 0.15 | 2.00 | MB/hour | PASS | Flat heap line validates absence of memory leaks. |
| Reconnection Success Rate | 100.00 | 100.00 | % | PASS | Autopilot recovered in 10 consecutive drop tests. |
| MAVLink Packet Loss Rate | 0.87 | 1.00 | % | PASS | Clean transmission through loopback / WSL2 link. |
| Telemetry Heartbeat Drops | 0 | 0 | drops | PASS | No unexpected link drops occurred during run. |
| Application Process Crashes | 0 | 0 | crashes | PASS | GCS backend and frontend processes remained stable. |
