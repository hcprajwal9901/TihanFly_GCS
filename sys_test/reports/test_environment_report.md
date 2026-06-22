---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - Test Environment Report

## 1. Hardware & System Configuration
- **Operating System**: Windows 11 Pro 64-bit (build 22631)
- **CPU**: Intel Core i7-13700H @ 2.4GHz
- **RAM**: 16GB LPDDR5 RAM
- **Storage**: 512GB NVMe SSD
- **Network Interface**: Local loopback (127.0.0.1) & WSL2 Virtual Ethernet Adapter

## 2. Software & Tooling Versions
- **Electron.js Framework**: v29.0.0
- **Node.js Runtime**: v20.11.0
- **Compiler Version**: MSVC 2022 (C++17) for backend DLL build
- **ArduPilot SITL Simulator**: ArduPilot Copter v4.5.1
- **MAVProxy Telemetry Bridge**: v1.8.64
- **Playwright Test Runner**: v1.61.0

## 3. Reference Quality Metrics (Unit/Integration Test Summaries)
To establish trace boundaries, the following unit and integration test outputs are recorded:
- **Frontend Unit Test Cases**: 1018 test cases (100% Pass)
- **Backend Unit Test Cases**: 276 test cases (100% Pass)
- **E2E Integration Validation Files**: 4 suites (main_window, sub_panels, sitl_validation, multi_vehicle_validation)
- **E2E Integration Test Cases**: 12 test cases (100% Pass)
