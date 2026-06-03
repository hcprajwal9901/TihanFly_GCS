const fs = require('fs');
const path = require('path');

// 1. Bulletproof DOM and Selectors Guards
const originalGetElementById = document.getElementById.bind(document);
document.getElementById = (id) => {
  let el = originalGetElementById(id);
  if (!el) {
    if (id.toLowerCase().includes('canvas')) {
      el = document.createElement('canvas');
    } else {
      el = document.createElement('div');
    }
    el.id = id;
    // Add stub features for common DOM elements to prevent GCS script crashes
    if (id.endsWith('-sel') || id.endsWith('Sel')) {
      el = document.createElement('select');
      el.id = id;
      el.options = [];
      el.selectedIndex = 0;
    } else if (id.endsWith('-btn') || id.endsWith('Btn')) {
      el = document.createElement('button');
      el.id = id;
    } else if (id.endsWith('Input') || id.endsWith('Port') || id.endsWith('Ip')) {
      el = document.createElement('input');
      el.id = id;
      el.value = '';
    }
    document.body.appendChild(el);
  }
  return el;
};

const originalQuerySelector = document.querySelector.bind(document);
document.querySelector = (selector) => {
  let el = originalQuerySelector(selector);
  if (!el) {
    if (selector.toLowerCase().includes('canvas')) {
      el = document.createElement('canvas');
    } else {
      el = document.createElement('div');
    }
    if (selector.startsWith('.')) {
      el.className = selector.slice(1);
    } else if (selector.startsWith('#')) {
      el.id = selector.slice(1);
    }
    document.body.appendChild(el);
  }
  return el;
};

document.querySelectorAll = (selector) => {
  const elements = document.body.querySelectorAll(selector);
  if (elements.length === 0) {
    // Return array containing a dynamic element to ensure loops run and don't fail
    const dummy = document.querySelector(selector);
    return [dummy];
  }
  return Array.from(elements);
};

// 2. Mock Global Browser Features
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn()
};

// Mock localStorage
const localStorageStore = {};
const localStorageMock = {
  getItem: jest.fn(key => localStorageStore[key] || null),
  setItem: jest.fn((key, value) => {
    localStorageStore[key] = String(value);
  }),
  clear: jest.fn(() => {
    Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]);
  }),
  removeItem: jest.fn(key => {
    delete localStorageStore[key];
  })
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock });
}

// Mock WebSocket
class WebSocketMock {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    WebSocketMock.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }
  send(data) {
    if (this.onsend) this.onsend(data);
  }
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}
WebSocketMock.instances = [];
global.WebSocket = WebSocketMock;
if (typeof window !== 'undefined') {
  window.WebSocket = WebSocketMock;
}

// 3. Mock jQuery ($ / jQuery) to bulletproof older libraries
const jQueryMock = jest.fn().mockImplementation((selector) => {
  return {
    on: jest.fn().mockReturnThis(),
    click: jest.fn().mockReturnThis(),
    val: jest.fn().mockReturnValue(''),
    html: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    show: jest.fn().mockReturnThis(),
    hide: jest.fn().mockReturnThis(),
    addClass: jest.fn().mockReturnThis(),
    removeClass: jest.fn().mockReturnThis(),
    append: jest.fn().mockReturnThis(),
    each: jest.fn(cb => cb(0, document.createElement('div')))
  };
});
jQueryMock.ajax = jest.fn().mockResolvedValue({});
global.$ = global.jQuery = jQueryMock;
if (typeof window !== 'undefined') {
  window.$ = window.jQuery = jQueryMock;
}

// 4. Comprehensive Leaflet Map API (L) Mocks
const LeafletMock = {
  map: jest.fn().mockReturnValue({
    setView: jest.fn(),
    eachLayer: jest.fn(cb => cb({ redraw: jest.fn() })),
    invalidateSize: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    getCenter: jest.fn().mockReturnValue({ lat: 17.601, lng: 78.126 }),
    getZoom: jest.fn().mockReturnValue(18),
    fitBounds: jest.fn(),
    clearRoute: jest.fn()
  }),
  marker: jest.fn().mockReturnValue({
    addTo: jest.fn().mockReturnThis(),
    setIcon: jest.fn().mockReturnThis(),
    bindTooltip: jest.fn().mockReturnThis(),
    bindPopup: jest.fn().mockReturnThis(),
    on: jest.fn(),
    setLatLng: jest.fn().mockReturnThis(),
    setRotationAngle: jest.fn().mockReturnThis()
  }),
  icon: jest.fn().mockReturnValue({}),
  divIcon: jest.fn().mockReturnValue({}),
  latLng: jest.fn((lat, lng) => ({ lat, lng })),
  LatLng: jest.fn((lat, lng) => ({ lat, lng })),
  polyline: jest.fn().mockReturnValue({
    addTo: jest.fn().mockReturnThis(),
    setLatLngs: jest.fn().mockReturnThis(),
    remove: jest.fn()
  }),
  polygon: jest.fn().mockReturnValue({
    addTo: jest.fn().mockReturnThis(),
    setLatLngs: jest.fn().mockReturnThis(),
    remove: jest.fn()
  }),
  circle: jest.fn().mockReturnValue({
    addTo: jest.fn().mockReturnThis(),
    setLatLng: jest.fn().mockReturnThis(),
    setRadius: jest.fn().mockReturnThis(),
    remove: jest.fn()
  })
};

global.L = LeafletMock;
if (typeof window !== 'undefined') {
  window.L = LeafletMock;
}

// Mock Custom GCS Classes (TMap, Compass, HUD, etc.)
global.TMap = class TMap {
  constructor(elementId, center, zoom, options) {
    this.elementId = elementId;
    this.center = center;
    this.zoom = zoom;
    this.options = options;
    this.map = LeafletMock.map();
    this.clickEnabled = false;
    this.clickCallback = null;
    this.droneAutoPan = false;
  }
  enableClick() { this.clickEnabled = true; }
  onClick(cb) { this.clickCallback = cb; }
  addRotatingHomeMarker(lat, lng) { return { lat, lng }; }
  addStaticLocation(lat, lng) { return { lat, lng }; }
  clearDroneMarkers() {}
  getMarkerCount() { return 1; }
  updateDronePosition() {}
  updateDronePositionForSysid() {}
  clearRoute() {}
  addMarker() { return {}; }
  removeMarker() {}
  updateRoute() {}
};
if (typeof window !== 'undefined') {
  window.TMap = global.TMap;
}

global.CompassEnhanced = class CompassEnhanced {
  constructor() {
    this.heading = 0;
    this.telemetry = {};
  }
  setHeading(deg) { this.heading = deg; }
  getHeading() { return this.heading; }
  updateTelemetry(data) { this.telemetry = { ...this.telemetry, ...data }; }
  getTelemetry() { return this.telemetry; }
  show() {}
  hide() {}
};
if (typeof window !== 'undefined') {
  window.CompassEnhanced = global.CompassEnhanced;
}

// 5. Mock Electron and IPC APIs
const ipcRendererMock = {
  send: jest.fn(),
  on: jest.fn(),
  invoke: jest.fn().mockResolvedValue(true)
};
global.ipcRenderer = ipcRendererMock;
if (typeof window !== 'undefined') {
  window.ipcRenderer = ipcRendererMock;
}

// 6. Common GCS global managers
global.MsgConsole = {
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  takeoff: jest.fn(),
  land: jest.fn(),
  rtl: jest.fn()
};
global.SwUtil = {
  toast: jest.fn()
};
global.TelemetryStore = {
  roll: 0,
  pitch: 0,
  yaw: 0
};
if (typeof window !== 'undefined') {
  window.MsgConsole = global.MsgConsole;
  window.SwUtil = global.SwUtil;
  window.TelemetryStore = global.TelemetryStore;
}

// Mock PlanFlightMode and planFlightMode stubs to prevent ReferenceErrors during plan-flight load stages
global.PlanFlightMode = class PlanFlightMode {
  constructor() {}
  static init() {}
};
global.planFlightMode = {
  init: jest.fn(),
  enter: jest.fn(),
  isActive: jest.fn().mockReturnValue(false)
};
global.PlanFlight = {
  enter: jest.fn(),
  isActive: jest.fn().mockReturnValue(false)
};
global.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (typeof window !== 'undefined') {
  window.PlanFlightMode = global.PlanFlightMode;
  window.planFlightMode = global.planFlightMode;
  window.PlanFlight = global.PlanFlight;
  window.ResizeObserver = global.ResizeObserver;
}

// 6.5. Canvas and Crypt stubs to bypass JSDOM runtime limitations
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    fillText: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    drawImage: jest.fn(),
    createLinearGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
    closePath: jest.fn()
  });
}
global.b = jest.fn().mockReturnValue({});
if (typeof window !== 'undefined') {
  window.b = global.b;
}

// 7. Dynamic loadScript utility
global.loadScript = (relativePath) => {
  const absolutePath = path.resolve(__dirname, '../../', relativePath);
  jest.isolateModules(() => {
    try {
      delete require.cache[absolutePath];
    } catch (e) {}
    require(absolutePath);
  });
};




