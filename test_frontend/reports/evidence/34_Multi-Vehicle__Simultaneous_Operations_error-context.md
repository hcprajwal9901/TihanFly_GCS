# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi_vehicle_validation.spec.js >> GCS Multi-Vehicle End-to-End Validation (Phase 5) >> Multi-Vehicle: Simultaneous Operations
- Location: test_frontend\integration_test\multi_vehicle_validation.spec.js:453:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.mv-drone-tab[data-sysid="1"] .mv-arm-badge')
Expected: "DSRM"
Received: "ARMED"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.mv-drone-tab[data-sysid="1"] .mv-arm-badge')
    13 × locator resolved to <span class="mv-arm-badge mv-armed">ARMED</span>
       - unexpected value "ARMED"

```

```yaml
- text: ARMED
```