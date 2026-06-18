const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const reportsDir = path.join(__dirname, 'reports');
const evidenceDir = path.join(reportsDir, 'evidence');

// Ensure reports and evidence directories exist
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

const logFile = path.join(evidenceDir, 'playwright_execution.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

function logBoth(message) {
  console.log(message);
  logStream.write(message + '\n');
}

logBoth('[Runner] Starting frontend integration test runner...');
logBoth(`[Runner] Storing terminal execution output in: ${logFile}`);

// Run Playwright
const playwright = spawn('npx', ['playwright', 'test'], {
  shell: true,
  cwd: path.join(__dirname, '..')
});

playwright.stdout.on('data', (data) => {
  process.stdout.write(data);
  logStream.write(data);
});

playwright.stderr.on('data', (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

playwright.on('close', (code) => {
  logBoth(`[Runner] Playwright execution finished with exit code ${code}`);
  logBoth('[Runner] Launching Python Excel report compiler...');

  const pythonReport = spawn('python', [`"${path.join(__dirname, 'generate_excel_report.py')}"`], {
    shell: true,
    cwd: path.join(__dirname, '..')
  });

  pythonReport.stdout.on('data', (data) => {
    process.stdout.write(data);
    logStream.write(data);
  });

  pythonReport.stderr.on('data', (data) => {
    process.stderr.write(data);
    logStream.write(data);
  });

  pythonReport.on('close', (pyCode) => {
    logBoth(`[Runner] Excel report generation completed (exit code ${pyCode})`);
    
    logStream.end();
    process.exit(code);
  });
});
