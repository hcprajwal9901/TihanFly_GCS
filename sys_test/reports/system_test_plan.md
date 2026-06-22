---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - System Test Plan
**Standard Compliance: IEEE 829 / ISO 29119**

## 1. Introduction
This document defines the system-level testing scope, approach, environment, resource planning, and quality gates for the TiHANFly Ground Control Station (GCS).

## 2. Test Scope
### 2.1 Features to be Tested
System testing covers all 17 primary functional modules, including:
- Vehicle Connection & MAVLink Ingestion
- Real-time HUD and dashboard telemetry updates
- Flight operations commands (Arm, Disarm, Flight Modes, Takeoff, Landing)
- Interactive Waypoint Mission Planning and upload/download handshakes
- Geofence warning borders and automatic RTL failsafes
- Full parameter management, search filters, and cache persistence
- Multi-Vehicle Discovery (isolation boundaries and selector tabs)
- Stability (4-hour runs), performance bounds (CPU/RAM), and recovery.

### 2.2 Features Not to be Tested
- Physical drone flight operations (validated via WSL SITL and Mock telemetry sockets).
- Video camera hardware sensor calibration (tested under isolated mock streams).

## 3. Test Methodology
A Hybrid testing methodology is used:
1. **Automated E2E Testing**: Running Playwright E2E suites for validation of workflows.
2. **SITL Simulations**: Running WSL-based ArduPilot instances for flight command verification.
3. **Manual Verification**: Reviewing edge configurations (e.g. UI scaling, window resizes).

## 4. Pass/Exit Criteria
System Testing is considered complete and approved when:
- Requirement Coverage is $\ge 95\%$ (Actual: 100%).
- Test Case Pass Rate is $\ge 95\%$ (Actual: 100.00%).
- Critical and High severity defects: 0 open.
- All Performance KPIs meet target boundaries.
- Multi-vehicle validation passes.
