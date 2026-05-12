#!/bin/bash

# Stop any background instances of the app or video server that might lock the files
echo "Stopping any running TiHANFly or Electron processes..."
pkill -i -f "electron|tihanfly|video_server" || true

# Give the system a moment to fully release resources
sleep 2

# Try to clean up all build_dist* folders
echo "Cleaning up old build folders..."
rm -rf build_dist*

# Determine a valid, empty output folder. Try build_dist first.
# (File locking is less of an issue on Linux than Windows, but keeping parity)
outDir="build_dist"
if [ -d "$outDir" ]; then
    timestamp=$(date +"%H%M%S")
    outDir="build_dist_$timestamp"
    echo "Warning: Old build folder could not be deleted. Using fallback directory: $outDir"
fi

# Run the Electron builder with the chosen output directory
# We use AppImage for a "portable" single-file Linux executable, similar to --win portable
echo "Building new portable Linux executable into $outDir..."
npx electron-builder --linux AppImage --config.directories.output="$outDir"

echo "Build complete! Check the $outDir folder for your new Linux executable (.AppImage)"
