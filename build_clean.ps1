# Stop any background instances of the app or video server that might lock the files
Write-Host "Stopping any running TiHANFly or Electron processes..."
Get-Process | Where-Object { $_.Name -match "(?i)electron|tihanfly|video_server" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Give the system a moment to fully release file locks
Start-Sleep -Seconds 2

# Try to clean up all build_dist* folders
Write-Host "Cleaning up old build folders..."
$oldBuilds = Get-ChildItem -Directory -Filter "build_dist*"
foreach ($folder in $oldBuilds) {
    Remove-Item -Recurse -Force $folder.FullName -ErrorAction SilentlyContinue
}

# Determine a valid, empty output folder. Try build_dist first. If locked, use a fallback name.
$outDir = "build_dist"
if (Test-Path "$outDir\win-unpacked\resources\app.asar") {
    # If the file still exists, it means it's locked and Remove-Item failed silently.
    $datestamp = Get-Date -Format "ddMMyyyy"
    $timestamp = Get-Date -Format "HHmmss"
    $outDir = "build_dist_$datestamp_$timestamp"
    Write-Host "Warning: Old build folder is locked. Using fallback directory: $outDir"
}

# Run the Electron builder with the chosen output directory
Write-Host "Building new portable executable into $outDir..."
npx electron-builder --win portable --config.directories.output="$outDir"

Write-Host "Build complete! Check the $outDir folder for your new .exe"
