const { spawn, execSync } = require('child_process');

class SITLOrchestrator {
  constructor() {
    this.sitlProcess = null;
    this.sitlProcesses = [];
    this.proxyProcess = null;
  }

  getHostIp() {
    let hostIp = '127.0.0.1';
    try {
      const route = execSync('wsl ip route').toString();
      const match = route.match(/default via (\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        hostIp = match[1];
      }
    } catch (e) {
      console.warn('[Orchestrator] Failed to determine host IP via wsl ip route, defaulting to 127.0.0.1');
    }
    return hostIp;
  }

  async start(options = { numVehicles: 1 }) {
    const numVehicles = options.numVehicles || 1;
    
    // 1. First stop any existing SITL/MAVProxy instances
    this.stop();

    const hostIp = this.getHostIp();
    console.log(`[Orchestrator] Found host IP from WSL: ${hostIp}`);

    // 2. Start MAVLink Packet Proxy inside WSL
    console.log('[Orchestrator] Starting MAVLink Proxy inside WSL...');
    
    let proxyCmd;
    if (numVehicles === 1) {
      proxyCmd = `wsl bash -c "python3 /mnt/e/TiHAN/TflyGCS\\\\ \\\\(1\\\\)/TflyGCS/test_frontend/simulators/mavlink_proxy.py"`;
    } else {
      const ports = [];
      for (let i = 0; i < numVehicles; i++) {
        ports.push(14590 + i);
      }
      proxyCmd = `wsl bash -c "python3 /mnt/e/TiHAN/TflyGCS\\\\ \\\\(1\\\\)/TflyGCS/test_frontend/simulators/mavlink_proxy.py --sitl-ports ${ports.join(',')} --gcs-port 14550 --http-port 14599"`;
    }
    
    console.log(`[Orchestrator] Executing proxy command: ${proxyCmd}`);
    this.proxyProcess = spawn(proxyCmd, {
      stdio: 'pipe',
      shell: true
    });

    this.proxyProcess.stdout.on('data', (data) => {
      console.log(`[Proxy] ${data.toString().trim()}`);
    });
    this.proxyProcess.stderr.on('data', (data) => {
      console.error(`[Proxy Error] ${data.toString().trim()}`);
    });

    // Wait 2 seconds for the proxy to start and bind ports
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`[Orchestrator] Starting WSL ArduCopter SITL with ${numVehicles} vehicle(s)...`);

    this.sitlProcesses = [];

    for (let i = 0; i < numVehicles; i++) {
      const instanceId = i;
      const sitlPort = 14590 + i;
      const paramFile = `/mnt/e/TiHAN/TflyGCS (1)/TflyGCS/test_frontend/simulators/sysid${i+1}.param`;
      
      // 1. Spawn ArduCopter SITL process directly
      const copterCmd = `wsl bash -c "source ~/venv-ardupilot/bin/activate && cd ~/ardupilot/ArduCopter && ( : ; /home/hcprajwal/ardupilot/build/sitl/bin/arducopter --model + --speedup 1 --slave 0 --sysid ${i+1} --wipe --defaults ../Tools/autotest/default_params/copter.parm,'${paramFile}' --sim-address=127.0.0.1 -I${instanceId} )"`;
      console.log(`[Orchestrator] Spawning ArduCopter vehicle ${i+1}: ${copterCmd}`);
      
      const copterProc = spawn(copterCmd, {
        stdio: 'pipe',
        shell: true
      });
      
      copterProc.stdout.on('data', (data) => {
        process.stdout.write(`[SITL-${i+1}] ${data.toString()}`);
      });
      
      copterProc.stderr.on('data', (data) => {
        process.stderr.write(`[SITL-${i+1} Error] ${data.toString()}`);
      });
      
      this.sitlProcesses.push(copterProc);

      // 2. Spawn MAVProxy directly to bridge SITL and GCS proxy
      const masterPort = 5760 + 10 * i;
      const sitlInPort = 5501 + 10 * i;
      const mavproxyCmd = `wsl bash -c "source ~/venv-ardupilot/bin/activate && /home/hcprajwal/venv-ardupilot/bin/mavproxy.py --daemon --retries 5 --streamrate=10 --master tcp:127.0.0.1:${masterPort} --sitl 127.0.0.1:${sitlInPort} --out 127.0.0.1:${sitlPort}"`;
      console.log(`[Orchestrator] Spawning MAVProxy vehicle ${i+1}: ${mavproxyCmd}`);
      
      const proxyProc = spawn(mavproxyCmd, {
        stdio: 'pipe',
        shell: true
      });
      
      proxyProc.stdout.on('data', (data) => {
        process.stdout.write(`[MAVProxy-${i+1}] ${data.toString()}`);
      });
      
      proxyProc.stderr.on('data', (data) => {
        process.stderr.write(`[MAVProxy-${i+1} Error] ${data.toString()}`);
      });
      
      this.sitlProcesses.push(proxyProc);
    }

    this.sitlProcess = this.sitlProcesses[0] || null;

    // Wait 30 seconds for SITL bootloader, parameters sync, and telemetry stream to stabilize
    console.log('[Orchestrator] Waiting 30 seconds for simulation to stabilize...');
    await new Promise((resolve) => setTimeout(resolve, 30000));
    console.log('[Orchestrator] Simulation initialization delay completed.');
  }

  stop() {
    console.log('[Orchestrator] Cleaning up SITL processes inside WSL...');
    try {
      execSync('wsl bash -c "killall -9 arducopter python python3 sim_vehicle.py MAVProxy MAVProxy.py mavproxy.py mavproxy 2>/dev/null || true"');
      console.log('[Orchestrator] Cleanup completed successfully.');
    } catch (e) {
      // Ignored if clean
    }

    if (this.sitlProcesses && this.sitlProcesses.length > 0) {
      for (const proc of this.sitlProcesses) {
        try {
          proc.kill();
        } catch (e) {}
      }
      this.sitlProcesses = [];
    }

    if (this.sitlProcess) {
      try {
        this.sitlProcess.kill();
      } catch (e) {}
      this.sitlProcess = null;
    }

    if (this.proxyProcess) {
      try {
        this.proxyProcess.kill();
      } catch (e) {}
      this.proxyProcess = null;
    }
  }
}

module.exports = SITLOrchestrator;
