---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - System Defect & Issue Log

## 1. Resolved Defect & Issue Log
All system defects and environment-blocked issues have been successfully resolved and verified.

| Defect / Issue ID | Test Case ID | Requirement ID | Severity | Priority | Status | Resolution Detail |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DF-ST-004** | ST-004 | REQ-CONN-002 | Medium | Medium | Closed | Implemented regex-based input validation and range sanitization in `comm-link.js` for UDP/TCP custom ports. |
| **DF-ST-050** | ST-050 | REQ-PARAM-002 | Low | Low | Closed | Implemented parameter bounds checks matching `param_metadata.json` in `param-full.js` to block invalid negative/out-of-range local cached values. |
| **DF-ST-070** | ST-070 | REQ-UI-002 | Medium | Medium | Closed | Added network connectivity checker (`navigator.onLine` and `useOffline` state checks) to fall back gracefully to local map tiles in `tmap.js`. |
| **ISS-ST-078** | ST-078 | REQ-REC-001 | Low | Low | Closed | Validated clean telemetry recovery and GCS state preservation using simulated network dropouts and websocket reconnect streams. |
| **ISS-ST-084** | ST-084 | REQ-MVS-001 | Low | Low | Closed | Verified multi-vehicle selector tab telemetry parsing and rendering isolation by utilizing multi-vehicle simulation streams. |
