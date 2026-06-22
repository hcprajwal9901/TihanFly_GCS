---
Document Reference: TiHAN-GCS-SYS-TEST
Build: v1.1.0-RC3
Commit: 34cf857
Date: 2026-06-22
Tester: H C Prajwal
Environment: Windows 11 Pro (build 22631)
Status: APPROVED
---

# TiHANFly Ground Control Station - Excel Workbook Structure

This document details the configuration of the Excel spreadsheet output (`reports/system_testing_report.xlsx`).

## Sheet Configurations & Layouts
1. **Summary_Dashboard**: Contains stats widgets for test cases, requirement coverage %, and open defects. Features two embedded openpyxl charts (Pie Chart of test statuses and Bar Chart of module distributions) along with a KPI compliance list.
2. **System_Test_Cases**: Holds the full list of 95 designed system test cases (TC ID, Module, Scenario, Preconditions, Steps, Expected Result).
3. **Test_Execution**: Documents execution results (TC ID, Actual Result, Status, Date, Tester, Remarks, Evidence ID, Evidence Path link).
4. **Defect_Log**: Lists open defect records (Defect ID, TestCase ID, Req ID, Severity, Priority, Status, Root Cause, Fix Version).
5. **RTM**: Maps system requirements to mapped test cases with coverage indicators.
6. **Performance_Report**: Shows performance and reliability measured values versus target values.
7. **Execution_History**: Logs history trend of passes across builds (v1.0.0, v1.0.1, v1.1.0-RC3).
