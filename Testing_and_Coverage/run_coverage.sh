#!/bin/bash
set -e

# 1. Install lcov if it's missing (requires sudo, so we prompt if not found)
if ! command -v lcov &> /dev/null
then
    echo "lcov could not be found. Installing it now..."
    sudo apt update
    sudo apt install -y lcov
fi

echo "--- Building with Coverage ---"
# 2. Setup build directory
rm -rf build_coverage
mkdir build_coverage
cd build_coverage

# 3. Configure with coverage enabled
cmake -DENABLE_COVERAGE=ON ../../TihanFlyCC-main

# 4. Build tests
make -j$(nproc) tihanfly_tests

# 5. Run tests to generate coverage data
echo "--- Running Tests ---"
ctest --output-on-failure

# 6. Capture coverage data using lcov
echo "--- Capturing Coverage Data ---"
# Base capture (captures all gcda files in the build directory and source directories)
lcov --capture --directory . --output-file coverage.info

# 7. Filter the report to ONLY show the Transport and Link modules
echo "--- Filtering Coverage Data ---"
lcov --extract coverage.info '*/Transport/*' '*/Link/*' '*/Inspector/*' '*/Parser/*' '*/Vehicle/*' --output-file coverage.info
lcov --remove coverage.info '*.h' --output-file coverage.info

# 8. Generate HTML report
echo "--- Generating HTML Report ---"
genhtml coverage.info --output-directory ../coverage_report

echo "=========================================================="
echo "Coverage generation complete!"
echo "Open coverage_report/index.html in your browser to view."
echo "=========================================================="
