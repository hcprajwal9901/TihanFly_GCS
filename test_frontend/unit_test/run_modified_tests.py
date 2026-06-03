#!/usr/bin/env python3
"""
run_modified_tests.py
=====================
ONE command to:
  1. Detect git-modified JS source files
  2. Run Jest ONLY for those test files
  3. Merge results into test-results.json
  4. Write individual evidence .txt files
  5. Regenerate the Excel report

Usage
-----
  Auto (detect from git):
      python test_frontend/unit_test/run_modified_tests.py

  Or via npm:
      npm run test:modified

  Explicit files (no git needed):
      python test_frontend/unit_test/run_modified_tests.py camera-controls.js tmap.js

  Run ALL tests and rebuild report:
      python test_frontend/unit_test/run_modified_tests.py --all
"""

import os
import sys
import json
import shutil
import subprocess
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────────────────────────
TEST_DIR        = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR        = os.path.dirname(os.path.dirname(TEST_DIR))
RESULTS_FILE    = os.path.join(TEST_DIR, 'test-results.json')
TEMP_RESULTS    = os.path.join(TEST_DIR, '.temp-results.json')
GENERATE_SCRIPT = os.path.join(TEST_DIR, 'generate_test_cases_excel.py')

SEP = "=" * 60

# ── Step 1 — Detect modified files ────────────────────────────────────────────

def get_git_modified_source_files():
    """Return basenames of JS source files modified/staged in the working tree."""
    changed = set()
    for cmd in [
        ['git', 'diff', '--name-only'],            # unstaged
        ['git', 'diff', '--name-only', '--cached'], # staged
    ]:
        try:
            out = subprocess.check_output(cmd, cwd=ROOT_DIR,
                                          stderr=subprocess.DEVNULL).decode()
            for line in out.strip().splitlines():
                line = line.strip().replace('\\', '/')
                if line.endswith('.js') and (
                    line.startswith('js/') or
                    line.startswith('plan-flight-modules/')
                ):
                    changed.add(os.path.basename(line))
        except Exception:
            pass
    return sorted(changed)


def find_test_file(source_basename):
    """Map 'camera-controls.js' → full path of 'camera-controls.test.js'."""
    test_name = source_basename.replace('.js', '.test.js')
    path = os.path.join(TEST_DIR, test_name)
    return path if os.path.exists(path) else None


def all_test_files():
    """Return every *.test.js in TEST_DIR."""
    return sorted(
        os.path.join(TEST_DIR, f)
        for f in os.listdir(TEST_DIR)
        if f.endswith('.test.js')
    )

# ── Step 2 — Run Jest ──────────────────────────────────────────────────────────

def run_jest(test_files):
    """
    Run Jest for the given test file paths.
    Writes JSON output to TEMP_RESULTS.
    Returns (returncode, success).
    """
    # Convert test file paths to be relative to the root directory
    rel_files = [os.path.relpath(p, ROOT_DIR) for p in test_files]

    cmd = [
        'npx', 'jest',
        '--json',
        f'--outputFile={TEMP_RESULTS}',
        '--forceExit',
    ] + rel_files

    print(f"\n>  Target files : {len(test_files)} test file(s)")
    print()

    result = subprocess.run(cmd, cwd=ROOT_DIR, shell=True)
    ok = os.path.exists(TEMP_RESULTS)
    print()
    status = "[OK] PASSED" if result.returncode == 0 else "[ERROR] FAILED (some tests did not pass)"
    print(f"   Jest result  : {status}")
    return result.returncode, ok

# ── Step 3 — Merge results ─────────────────────────────────────────────────────

def recalculate_totals(data):
    passed_tests = failed_tests = passed_suites = failed_suites = 0
    for suite in data.get('testResults', []):
        suite_ok = True
        for t in suite.get('assertionResults', []):
            if t.get('status') == 'passed':
                passed_tests += 1
            elif t.get('status') == 'failed':
                failed_tests += 1
                suite_ok = False
        if suite_ok:
            passed_suites += 1
        else:
            failed_suites += 1
    data.update({
        'numPassedTests':      passed_tests,
        'numFailedTests':      failed_tests,
        'numTotalTests':       passed_tests + failed_tests,
        'numPassedTestSuites': passed_suites,
        'numFailedTestSuites': failed_suites,
        'numTotalTestSuites':  passed_suites + failed_suites,
        'success':             failed_tests == 0,
        'startTime':           int(datetime.now().timestamp() * 1000),
    })
    return data


def merge_results():
    with open(TEMP_RESULTS, 'r', encoding='utf-8') as f:
        new_data = json.load(f)

    if not os.path.exists(RESULTS_FILE):
        shutil.copyfile(TEMP_RESULTS, RESULTS_FILE)
        n = len(new_data.get('testResults', []))
        print(f"   Created test-results.json with {n} suite(s).")
        return 0, n

    with open(RESULTS_FILE, 'r', encoding='utf-8') as f:
        main_data = json.load(f)

    # Index by suite path name
    index = {s['name']: i for i, s in enumerate(main_data.get('testResults', []))}

    updated = added = 0
    for suite in new_data.get('testResults', []):
        name = suite['name']
        if name in index:
            main_data['testResults'][index[name]] = suite
            updated += 1
        else:
            main_data['testResults'].append(suite)
            added += 1

    main_data = recalculate_totals(main_data)

    with open(RESULTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(main_data, f, separators=(',', ':'))

    return updated, added

# ── Step 4 & 5 — Generate report ──────────────────────────────────────────────

def generate_report():
    print("\n>  Running generate_test_cases_excel.py ...\n")
    subprocess.run([sys.executable, GENERATE_SCRIPT], cwd=TEST_DIR)

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    run_all = '--all' in sys.argv
    explicit_args = [a for a in sys.argv[1:] if not a.startswith('--')]

    print()
    print(SEP)
    print("  TiHAN GCS — UNIT TEST RUNNER + REPORT GENERATOR")
    print(SEP)
    print(f"  Started : {datetime.now().strftime('%Y-%m-%d  %H:%M:%S')}")
    print()

    # ── Determine which test files to run ──────────────────────────────────────
    if run_all:
        print("  Mode     : ALL tests")
        test_files = all_test_files()

    elif explicit_args:
        print("  Mode     : Explicit file(s)")
        source_files = [a if a.endswith('.js') else a + '.js'
                        for a in explicit_args]
        test_files   = []
        for src in source_files:
            tf = find_test_file(os.path.basename(src))
            if tf:
                test_files.append(tf)
                print(f"    * {os.path.basename(tf)}")
            else:
                print(f"    [ERROR] No test file found for: {src}")

    else:
        print("  Mode     : Git-modified files only")
        source_files = get_git_modified_source_files()
        if not source_files:
            print("\n  [OK] No modified JS source files detected.\n"
                  "     Tip: Use --all to run everything, or pass filenames explicitly.\n")
            sys.exit(0)
        test_files = []
        for src in source_files:
            tf = find_test_file(src)
            if tf:
                test_files.append(tf)
                print(f"    * {src} -> {os.path.basename(tf)}")
            else:
                print(f"    [ERROR] {src} -> (no test file)")

    if not test_files:
        print("\n  Nothing to run.\n")
        sys.exit(0)

    print()

    # ── Step 2 : Jest ──────────────────────────────────────────────────────────
    print(SEP)
    print("  STEP 1/3 - Running tests")
    print(SEP)
    jest_code, jest_ok = run_jest(test_files)
    if not jest_ok:
        print("\n  [ERROR] Jest did not produce a results file. Aborting.\n")
        sys.exit(1)

    # ── Step 3 : Merge ─────────────────────────────────────────────────────────
    print()
    print(SEP)
    print("  STEP 2/3 - Merging results into test-results.json")
    print(SEP)
    updated, added = merge_results()
    print(f"   [OK] {updated} suite(s) updated, {added} suite(s) newly added.")

    # Cleanup temp file
    if os.path.exists(TEMP_RESULTS):
        os.remove(TEMP_RESULTS)

    # ── Step 4+5 : Report ──────────────────────────────────────────────────────
    print()
    print(SEP)
    print("  STEP 3/3 - Generating evidence files + Excel report")
    print(SEP)
    generate_report()

    # ── Done ───────────────────────────────────────────────────────────────────
    print()
    print(SEP)
    print("  [SUCCESS] ALL DONE")
    print(f"  Finished : {datetime.now().strftime('%Y-%m-%d  %H:%M:%S')}")
    if jest_code != 0:
        print("  [WARNING] Some tests FAILED - check the report for details.")
    print(SEP)
    print()


if __name__ == '__main__':
    main()
