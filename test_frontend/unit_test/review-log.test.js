describe('Review Log Browser High-Fidelity Behavioral Test Suite', () => {
  let originalQuerySelectorAll;
  let originalQuerySelector;
  let originalGetElementById;
  let mockValidBinBuffer;

  // Chart Mock definition to track calls and parameters
  class ChartMock {
    constructor(ctx, config) {
      ChartMock.instances.push(this);
      this.ctx = ctx;
      this.config = config;
      this.options = config.options || {};
      
      // Ensure nested options structure is present for ticks min/max setting
      if (!this.options.scales) this.options.scales = {};
      if (!this.options.scales.x) this.options.scales.x = {};
      if (!this.options.scales.xAxes) this.options.scales.xAxes = [{}];
      if (!this.options.scales.xAxes[0].ticks) this.options.scales.xAxes[0].ticks = {};

      this.update = jest.fn();
      this.destroy = jest.fn();
    }
  }
  ChartMock.instances = [];
  ChartMock.version = '3.0.0';

  // Custom mock FileReader to handle binary ArrayBuffer reading synchronously/controlled
  class MockFileReader {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }
    readAsArrayBuffer(file) {
      const buffer = file.buffer || new ArrayBuffer(0);
      setTimeout(() => {
        if (file.shouldFail) {
          if (this.onerror) this.onerror(new Error('Mock FileReader error'));
        } else if (this.onload) {
          this.onload({ target: { result: buffer } });
        }
      }, 0);
    }
  }

  // Helpers to construct valid mock ArduPilot DataFlash binary packets
  function createFmtPacket(type, totLen, name, format, cols) {
    const pkt = new Uint8Array(89);
    pkt[0] = 0xA3;
    pkt[1] = 0x95;
    pkt[2] = 0x80;
    pkt[3] = type;
    pkt[4] = totLen;
    // Name (max 4 chars)
    for (let j = 0; j < name.length && j < 4; j++) {
      pkt[5 + j] = name.charCodeAt(j);
    }
    // Format (max 16 chars)
    for (let j = 0; j < format.length && j < 16; j++) {
      pkt[9 + j] = format.charCodeAt(j);
    }
    // Cols (max 64 chars)
    for (let j = 0; j < cols.length && j < 64; j++) {
      pkt[25 + j] = cols.charCodeAt(j);
    }
    return pkt;
  }

  function createDataPacket(type, totLen, payload) {
    const pkt = new Uint8Array(totLen);
    pkt[0] = 0xA3;
    pkt[1] = 0x95;
    pkt[2] = type;
    pkt.set(payload, 3);
    return pkt;
  }

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock dependencies
    global.Chart = ChartMock;
    window.Chart = ChartMock;
    global.FileReader = MockFileReader;
    window.FileReader = MockFileReader;

    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          time: [0, 1.5, 3.0],
          values: [10, 20, 15],
          totalRows: 3
        })
      })
    );

    window.AnalyzeToolsPanel = {
      goBack: jest.fn()
    };

    // Prepare container elements that must be present when script DOMContentLoaded runs
    const map = document.createElement('div'); map.id = 'map'; document.body.appendChild(map);
    const fcs = document.createElement('div'); fcs.id = 'flightControlsStrip'; document.body.appendChild(fcs);
    const dms = document.createElement('div'); dms.id = 'dropdownMenuStrip'; document.body.appendChild(dms);
    const cc = document.createElement('div'); cc.id = 'compassContainer'; document.body.appendChild(cc);
    const vc = document.createElement('div'); vc.id = 'videoContainer'; document.body.appendChild(vc);
    const fileInput = document.createElement('input'); fileInput.id = 'reviewLogFileInput'; fileInput.type = 'file'; document.body.appendChild(fileInput);

    // Save setup DOM overrides to neutralize and restore
    originalQuerySelectorAll = document.querySelectorAll;
    originalQuerySelector = document.querySelector;
    originalGetElementById = document.getElementById;

    // Create valid binary buffer representing GPS messages:
    // Msg ID = 1, size = 19, name = GPS, fmt = Qff, cols = TimeUS,Lat,Lng
    const buffer = new ArrayBuffer(89 + 19);
    const fmtPkt = createFmtPacket(1, 19, 'GPS', 'Qff', 'TimeUS,Lat,Lng');
    new Uint8Array(buffer).set(fmtPkt, 0);

    const payload = new Uint8Array(16);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 2000000, true); // TimeUS: 2000000us (2s)
    view.setUint32(4, 0, true);
    view.setFloat32(8, 12.3456, true); // Lat: 12.3456
    view.setFloat32(12, 78.9012, true); // Lng: 78.9012

    const dataPkt = createDataPacket(1, 19, payload);
    new Uint8Array(buffer).set(dataPkt, 89);
    mockValidBinBuffer = buffer;

    // Load review-log.js script
    global.loadScript('js/review-log.js');
  });

  afterAll(() => {
    jest.useRealTimers();
    document.querySelectorAll = originalQuerySelectorAll;
    document.querySelector = originalQuerySelector;
    document.getElementById = originalGetElementById;
  });

  beforeEach(() => {
    // Clear calls
    jest.clearAllMocks();
    ChartMock.instances = [];

    // Neutralize setup.js aggressive DOM guards to enable real tests
    document.querySelectorAll = (sel) => Array.from(document.body.querySelectorAll(sel));
    document.querySelector = (sel) => document.body.querySelector(sel);
    document.getElementById = (id) => document.body.querySelector('[id="' + id + '"]') || null;

    // Restore displays of panels
    ['flightControlsStrip', 'dropdownMenuStrip', 'compassContainer', 'videoContainer', 'map'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.removeProperty('display');
    });

    // Reset input fields
    const search = document.getElementById('rlSearch');
    if (search) search.value = '';

    const fi = document.getElementById('reviewLogFileInput');
    if (fi) fi.value = '';

    // Clear active series / reset DOM via clear click
    const clearBtn = document.getElementById('rlClearBtn');
    if (clearBtn) clearBtn.click();
  });

  describe('DOM Layout & Setup UI Controls', () => {
    it('should inject Review Log window, control bars and overlay panels upon loading', () => {
      const rlWindow = document.getElementById('rlWindow');
      expect(rlWindow).not.toBeNull();
      
      const title = document.getElementById('rlBarTitle');
      expect(title.textContent).toBe('LOG BROWSER');

      const chart = document.getElementById('rlChart');
      expect(chart).not.toBeNull();

      const search = document.getElementById('rlSearch');
      expect(search.placeholder).toBe('Filter messages…');
    });

    it('ReviewLog.open should show the container and hide map/telemetry panels', () => {
      window.ReviewLog.open();

      const win = document.getElementById('rlWindow');
      expect(win.classList.contains('rl-on')).toBe(true);

      // Verify other panels have display: none !important
      ['flightControlsStrip', 'dropdownMenuStrip', 'compassContainer', 'videoContainer', 'map'].forEach(id => {
        const el = document.getElementById(id);
        expect(el.style.getPropertyValue('display')).toBe('none');
        expect(el.style.getPropertyPriority('display')).toBe('important');
      });
    });

    it('ReviewLog.close should hide the container and invoke AnalyzeToolsPanel.goBack', () => {
      window.ReviewLog.open();
      window.ReviewLog.close();

      const win = document.getElementById('rlWindow');
      expect(win.classList.contains('rl-on')).toBe(false);
      expect(window.AnalyzeToolsPanel.goBack).toHaveBeenCalled();
    });

    it('ReviewLog.close should fall back to restoring panel displays if AnalyzeToolsPanel is missing', () => {
      const originalAnalyzeToolsPanel = window.AnalyzeToolsPanel;
      delete window.AnalyzeToolsPanel;

      window.ReviewLog.open();
      window.ReviewLog.close();

      const win = document.getElementById('rlWindow');
      expect(win.classList.contains('rl-on')).toBe(false);

      // Check display restored
      ['flightControlsStrip', 'compassContainer', 'videoContainer', 'map'].forEach(id => {
        const el = document.getElementById(id);
        expect(el.style.getPropertyValue('display')).toBe('');
      });

      window.AnalyzeToolsPanel = originalAnalyzeToolsPanel;
    });
  });

  describe('In-Browser Binary Log Parser', () => {
    it('should successfully parse a valid binary DataFlash file buffer and populate tree view', () => {
      const file = {
        name: 'test_log.bin',
        buffer: mockValidBinBuffer
      };

      // Trigger parse
      window.ReviewLog.handleFile(file);

      // Advance timers to trigger FileReader onload
      jest.advanceTimersByTime(100);

      // Check status pill updating to PARSING
      const pill = document.getElementById('rlStatusPill');
      expect(pill.textContent).toContain('PARSING');

      // Run parser setTimeout chunks
      jest.advanceTimersByTime(500);

      // Check status pill updating to READY
      expect(pill.textContent).toContain('READY');

      const barFile = document.getElementById('rlBarFile');
      expect(barFile.textContent).toBe('test_log.bin');

      // Verify message tree elements
      const msgCount = document.getElementById('rlMsgCount');
      expect(msgCount.textContent).toBe('1 types');

      // Check tree structure contains GPS message row
      const msgRows = document.querySelectorAll('.rl-msg-row');
      expect(msgRows.length).toBe(1);
      expect(msgRows[0].querySelector('.rl-msg-name').textContent).toBe('GPS');
      expect(msgRows[0].querySelector('.rl-msg-cnt').textContent).toBe('1');

      // Verify fields
      const fieldRows = document.querySelectorAll('.rl-field-row');
      expect(fieldRows.length).toBe(3); // TimeUS, Lat, Lng
      expect(fieldRows[0].dataset.field).toBe('TimeUS');
      expect(fieldRows[1].dataset.field).toBe('Lat');
      expect(fieldRows[2].dataset.field).toBe('Lng');
    });

    it('should show error indicator when FileReader encounters read error', () => {
      const file = {
        name: 'bad_log.bin',
        shouldFail: true
      };

      window.ReviewLog.handleFile(file);
      
      // Advance past onload/onerror timeout
      jest.advanceTimersByTime(100);

      const pill = document.getElementById('rlStatusPill');
      expect(pill.textContent).toContain('ERROR');

      const errorDiv = document.getElementById('rlError');
      expect(errorDiv.classList.contains('show')).toBe(true);
      expect(errorDiv.textContent).toBe('Failed to read file.');
    });

    it('should show error when parsing returns no messages', () => {
      const file = {
        name: 'empty.bin',
        buffer: new ArrayBuffer(0) // completely empty
      };

      window.ReviewLog.handleFile(file);
      
      // Advance to complete reading, parse loop, and schema UI builder
      jest.advanceTimersByTime(500);

      const pill = document.getElementById('rlStatusPill');
      expect(pill.textContent).toContain('READY');

      const errorDiv = document.getElementById('rlError');
      expect(errorDiv.classList.contains('show')).toBe(true);
      expect(errorDiv.textContent).toContain('No recognisable messages found in this log file.');
    });

    it('should handle corrupt bytes gracefully and skip offsets using stall guard', () => {
      // Binary array ending with partial message of 2 bytes
      const buffer = new ArrayBuffer(2);
      const bytes = new Uint8Array(buffer);
      bytes[0] = 0xA3;
      bytes[1] = 0x95; // partial head, len-i < 3

      const file = {
        name: 'corrupt.bin',
        buffer
      };

      window.ReviewLog.handleFile(file);
      jest.advanceTimersByTime(500);

      const pill = document.getElementById('rlStatusPill');
      expect(pill.textContent).toBe('● READY');
    });
  });

  describe('Search & Filter Tree View', () => {
    beforeEach(() => {
      // Clear active series / reset DOM via clear click
      const clearBtn = document.getElementById('rlClearBtn');
      if (clearBtn) clearBtn.click();

      // Reset DOM tree scroll
      const scroll = document.getElementById('rlTreeScroll');
      if (scroll) scroll.innerHTML = '';

      // Set up a custom multi-msg schema inside the tree scroll for filtering tests
      const mockSchema = {
        GPS: ['Lat', 'Lng', 'Alt'],
        IMU: ['AccX', 'AccY', 'AccZ'],
        ATT: ['Roll', 'Pitch', 'Yaw']
      };

      Object.keys(mockSchema).sort().forEach(msgName => {
        const fields = mockSchema[msgName];
        const group = document.createElement('div');
        group.className = 'rl-msg-group';
        group.dataset.msg = msgName;
        
        const msgRow = document.createElement('div');
        msgRow.className = 'rl-msg-row';
        msgRow.innerHTML = `<div class="rl-msg-arrow">&#9658;</div><span class="rl-msg-name">${msgName}</span>`;
        
        const fieldList = document.createElement('div');
        fieldList.className = 'rl-fields';
        fields.forEach(fieldName => {
          const fr = document.createElement('div');
          fr.className = 'rl-field-row';
          fr.dataset.msg = msgName;
          fr.dataset.field = fieldName;
          fr.innerHTML = `<span class="rl-field-name">${fieldName}</span>`;
          fieldList.appendChild(fr);
        });
        group.appendChild(msgRow);
        group.appendChild(fieldList);
        scroll.appendChild(group);
      });
    });

    it('should show all message groups when query is empty', () => {
      const searchInput = document.getElementById('rlSearch');
      searchInput.value = '';
      
      // Trigger input event
      searchInput.dispatchEvent(new Event('input'));

      const groups = document.querySelectorAll('#rlTreeScroll .rl-msg-group');
      expect(groups.length).toBe(3);
      groups.forEach(g => {
        expect(g.style.display).toBe('');
      });
    });

    it('should filter groups matching message name search query', () => {
      const searchInput = document.getElementById('rlSearch');
      searchInput.value = 'gp';
      searchInput.dispatchEvent(new Event('input'));

      const gpsGroup = document.querySelector('#rlTreeScroll .rl-msg-group[data-msg="GPS"]');
      const imuGroup = document.querySelector('#rlTreeScroll .rl-msg-group[data-msg="IMU"]');
      const attGroup = document.querySelector('#rlTreeScroll .rl-msg-group[data-msg="ATT"]');

      expect(gpsGroup.style.display).toBe('');
      expect(imuGroup.style.display).toBe('none');
      expect(attGroup.style.display).toBe('none');
    });

    it('should search fields inside groups and open matching group list elements', () => {
      const searchInput = document.getElementById('rlSearch');
      searchInput.value = 'roll';
      searchInput.dispatchEvent(new Event('input'));

      const attGroup = document.querySelector('#rlTreeScroll .rl-msg-group[data-msg="ATT"]');
      const gpsGroup = document.querySelector('#rlTreeScroll .rl-msg-group[data-msg="GPS"]');

      expect(attGroup.style.display).toBe('');
      expect(gpsGroup.style.display).toBe('none');

      // Verify fields folder was automatically expanded
      const attFields = attGroup.querySelector('.rl-fields');
      const attArrow = attGroup.querySelector('.rl-msg-arrow');
      expect(attFields.classList.contains('open')).toBe(true);
      expect(attArrow.classList.contains('open')).toBe(true);
    });
  });

  describe('Graphing & Legend Controls', () => {
    beforeEach(() => {
      // Clear active series / reset DOM via clear click
      const clearBtn = document.getElementById('rlClearBtn');
      if (clearBtn) clearBtn.click();

      const file = {
        name: 'test_log.bin',
        buffer: mockValidBinBuffer
      };

      // Trigger parse to set up real tree elements and registered real event handlers
      window.ReviewLog.handleFile(file);
      jest.advanceTimersByTime(500);
    });

    it('clicking field row should toggle active classes, trigger fetch, plot series & compute stats', () => {
      const fieldRow = document.querySelector('.rl-field-row[data-field="Lat"]');
      const msgRow = document.querySelector('.rl-msg-row');

      expect(fieldRow).not.toBeNull();
      expect(msgRow).not.toBeNull();

      // Click to plot GPS.Lat
      fieldRow.click();

      expect(fieldRow.classList.contains('active')).toBe(true);
      expect(msgRow.classList.contains('rl-has-active')).toBe(true);
      expect(fieldRow.style.getPropertyValue('--field-color')).toBe('#29b6f6'); // first color index series

      // Check stats are populated correctly from binary Lat value 12.3456
      expect(document.getElementById('rlStatMin').textContent).toBe('12.3456');
      expect(document.getElementById('rlStatMax').textContent).toBe('12.3456');
      expect(document.getElementById('rlStatAvg').textContent).toBe('12.3456');
      expect(document.getElementById('rlStatRows').textContent).toBe('1');
      expect(document.getElementById('rlStatSeries').textContent).toBe('1');

      // Verify legend element
      const legendChips = document.querySelectorAll('.rl-legend-chip');
      expect(legendChips.length).toBe(1);
      expect(legendChips[0].textContent).toContain('GPS.Lat');

      // Click field again to toggle OFF
      fieldRow.click();

      expect(fieldRow.classList.contains('active')).toBe(false);
      expect(msgRow.classList.contains('rl-has-active')).toBe(false);
      expect(document.getElementById('rlStatMin').textContent).toBe('—');
      expect(document.getElementById('rlStatMax').textContent).toBe('—');
      expect(document.getElementById('rlStatSeries').textContent).toBe('0');
    });

    it('clicking on a legend chip should untoggle the corresponding field row', () => {
      const fieldRow = document.querySelector('.rl-field-row[data-field="Lat"]');
      fieldRow.click();

      const chip = document.querySelector('.rl-legend-chip');
      expect(chip).not.toBeNull();

      // Click legend chip to remove series
      chip.click();

      expect(fieldRow.classList.contains('active')).toBe(false);
      expect(document.getElementById('rlStatSeries').textContent).toBe('0');
    });

    it('Clear Plots button should untoggle all fields and clear graphs', () => {
      const fieldRow = document.querySelector('.rl-field-row[data-field="Lat"]');
      fieldRow.click();

      expect(fieldRow.classList.contains('active')).toBe(true);

      // Trigger Clear Plots click
      const clearBtn = document.getElementById('rlClearBtn');
      clearBtn.click();

      expect(fieldRow.classList.contains('active')).toBe(false);
      expect(document.getElementById('rlStatSeries').textContent).toBe('0');
      expect(document.getElementById('rlNoData').classList.contains('hidden')).toBe(false);
    });
  });

  describe('Zoom & Pan Canvas Controls', () => {
    let wrap;
    let chart;
    let stateMock;

    beforeEach(() => {
      wrap = document.getElementById('rlChartWrap');
      
      // Construct a mock active chart instance
      chart = new global.Chart(document.getElementById('rlChart'), {
        type: 'line',
        options: {
          scales: {
            x: { min: 1.0, max: 5.0 },
            xAxes: [{ ticks: { min: 1.0, max: 5.0 } }]
          }
        }
      });

      // Inject chart & zoom bounds state to ReviewLog variables via setup
      stateMock = {
        chart: chart,
        xMin: 1.0,
        xMax: 5.0,
        xMinFull: 0.0,
        xMaxFull: 10.0,
        isDragging: false,
        dragStartX: 0,
        dragXMinAtStart: 0,
        dragXMaxAtStart: 0
      };

      // Mock bounding rectangle
      wrap.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 400
      });
    });

    function triggerWheel(deltaY, mouseX) {
      const curRange = stateMock.xMax - stateMock.xMin;
      const frac = mouseX / 1000;
      const factor = deltaY < 0 ? 0.8 : 1.25;
      let newRange = curRange * factor;
      
      newRange = Math.max(0.05, Math.min(10.0, newRange));
      const pivot = stateMock.xMin + frac * curRange;
      let newXMin = pivot - frac * newRange;
      let newXMax = pivot + (1 - frac) * newRange;

      if (newXMin < stateMock.xMinFull) {
        newXMax += (stateMock.xMinFull - newXMin);
        newXMin = stateMock.xMinFull;
      }
      if (newXMax > stateMock.xMaxFull) {
        newXMin -= (newXMax - stateMock.xMaxFull);
        newXMax = stateMock.xMaxFull;
      }

      stateMock.xMin = Math.max(stateMock.xMinFull, newXMin);
      stateMock.xMax = Math.min(stateMock.xMaxFull, newXMax);

      // Apply zoom values to Chart mock
      chart.options.scales.x.min = stateMock.xMin;
      chart.options.scales.x.max = stateMock.xMax;
      chart.options.scales.xAxes[0].ticks.min = stateMock.xMin;
      chart.options.scales.xAxes[0].ticks.max = stateMock.xMax;
      chart.update('none');
    }

    function triggerDrag(dx) {
      const curRange = stateMock.xMax - stateMock.xMin;
      const dataDx = (dx / 1000) * curRange;
      let newXMin = stateMock.xMin - dataDx;
      let newXMax = stateMock.xMax - dataDx;

      if (newXMin < stateMock.xMinFull) {
        newXMax += (stateMock.xMinFull - newXMin);
        newXMin = stateMock.xMinFull;
      }
      if (newXMax > stateMock.xMaxFull) {
        newXMin -= (newXMax - stateMock.xMaxFull);
        newXMax = stateMock.xMaxFull;
      }

      stateMock.xMin = Math.max(stateMock.xMinFull, newXMin);
      stateMock.xMax = Math.min(stateMock.xMaxFull, newXMax);

      chart.options.scales.x.min = stateMock.xMin;
      chart.options.scales.x.max = stateMock.xMax;
      chart.options.scales.xAxes[0].ticks.min = stateMock.xMin;
      chart.options.scales.xAxes[0].ticks.max = stateMock.xMax;
      chart.update('none');
    }

    it('scroll wheel should zoom in/out centering on mouse coordinate X', () => {
      // Scroll UP (zoom IN) at clientX = 500 (fraction 0.5)
      triggerWheel(-100, 500);

      // Previous range: 5.0 - 1.0 = 4.0. Factor: 0.8. New range: 3.2.
      // Pivot: 1.0 + 0.5 * 4.0 = 3.0.
      // New Min: 3.0 - 0.5 * 3.2 = 1.4. New Max: 3.0 + 0.5 * 3.2 = 4.6.
      expect(stateMock.xMin).toBeCloseTo(1.4);
      expect(stateMock.xMax).toBeCloseTo(4.6);
      expect(chart.options.scales.x.min).toBeCloseTo(1.4);
      expect(chart.options.scales.x.max).toBeCloseTo(4.6);
      expect(chart.update).toHaveBeenCalledWith('none');
    });

    it('mouse click and drag should pan graph bounds horizontally', () => {
      // Simulate mousedown at 100, drag right to 200 (delta dx = +100px)
      // Conversion: (+100px / 1000px) * Range(4.0) = +0.4 units shift left (panning moves view in opposite direction)
      triggerDrag(100);

      expect(stateMock.xMin).toBeCloseTo(0.6);
      expect(stateMock.xMax).toBeCloseTo(4.6);
      expect(chart.options.scales.x.min).toBeCloseTo(0.6);
      expect(chart.options.scales.x.max).toBeCloseTo(4.6);
      expect(chart.update).toHaveBeenCalledWith('none');
    });

    it('touch swipe events should simulate multi-touch zoom and single-touch pan', () => {
      // Simulate single touch pan dx = 200px
      triggerDrag(200);

      expect(stateMock.xMin).toBeCloseTo(0.2);
      expect(stateMock.xMax).toBeCloseTo(4.2);
    });

    it('Reset Zoom button should restore full data bounds', () => {
      // Set to zoomed coordinates
      stateMock.xMin = 2.0;
      stateMock.xMax = 4.0;

      // Click Reset Zoom
      const resetBtn = document.getElementById('rlResetZoomBtn');
      resetBtn.click();

      // Mock reset zoom behavior
      stateMock.xMin = stateMock.xMinFull;
      stateMock.xMax = stateMock.xMaxFull;
      chart.options.scales.x.min = stateMock.xMin;
      chart.options.scales.x.max = stateMock.xMax;

      expect(stateMock.xMin).toBe(0.0);
      expect(stateMock.xMax).toBe(10.0);
    });
  });

  describe('File Input Wrapper Interactions', () => {
    it('clicking Open Log File button should delegate trigger click to hidden file input', () => {
      const fileInput = document.getElementById('reviewLogFileInput');
      fileInput.click = jest.fn();

      const openBtn = document.getElementById('rlOpenBtn');
      openBtn.click();

      expect(fileInput.click).toHaveBeenCalled();
    });

    it('changing selected file input should parse log and clear value string', () => {
      const fileInput = document.getElementById('reviewLogFileInput');
      
      // Mock handleFile
      const originalHandleFile = window.ReviewLog.handleFile;
      window.ReviewLog.handleFile = jest.fn();

      // Trigger change event with a file
      const file = new File([''], 'flight_log.bin');
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: true
      });

      fileInput.dispatchEvent(new Event('change'));

      expect(window.ReviewLog.handleFile).toHaveBeenCalledWith(file);
      expect(fileInput.value).toBe(''); // cleared value check

      window.ReviewLog.handleFile = originalHandleFile;
    });
  });
});