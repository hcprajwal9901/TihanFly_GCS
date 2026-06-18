const { test: base, expect } = require('@playwright/test');
const net = require('net');
const path = require('path');
const fs = require('fs');
const MockServer = require('../mocks/mock_ws_server');

// Helper to get a free port on host
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Zero-dependency JSON Schema Type checking and contract validation
function validateAgainstSchema(data, schema) {
  if (!schema || typeof schema !== 'object') return true;

  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null) {
      console.warn('[Contract] Data is not an object');
      return false;
    }
    
    // Check required properties
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in data)) {
          console.warn(`[Contract] Missing required property: "${req}"`);
          return false;
        }
      }
    }

    // Check property types
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          if (propSchema.const !== undefined && data[key] !== propSchema.const) {
            console.warn(`[Contract] Property "${key}" does not match const value: ${propSchema.const}`);
            return false;
          }
          
          // Recursively validate sub-objects/arrays
          const isValidSub = validateAgainstSchema(data[key], propSchema);
          if (!isValidSub) {
            return false;
          }

          const expectedType = propSchema.type;
          const actualVal = data[key];
          const actualType = typeof actualVal;
          
          if (expectedType === 'integer') {
            if (!Number.isInteger(actualVal)) {
              console.warn(`[Contract] Property "${key}" is not an integer`);
              return false;
            }
          } else if (expectedType === 'number') {
            if (actualType !== 'number') {
              console.warn(`[Contract] Property "${key}" is not a number`);
              return false;
            }
          } else if (expectedType === 'boolean') {
            if (actualType !== 'boolean') {
              console.warn(`[Contract] Property "${key}" is not a boolean`);
              return false;
            }
          } else if (expectedType === 'string') {
            if (actualType !== 'string') {
              console.warn(`[Contract] Property "${key}" is not a string`);
              return false;
            }
          }
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      console.warn('[Contract] Data is not an array');
      return false;
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const isValidItem = validateAgainstSchema(data[i], schema.items);
        if (!isValidItem) {
          return false;
        }
      }
    }
  }
  return true;
}

// Extends base test with custom telemetry fixtures
const test = base.extend({
  telemetryServer: async ({}, use) => {
    const wsPort = await getFreePort();
    const httpPort = await getFreePort();

    // Export ports into env context so tests and processes can query them
    process.env.MOCK_WS_PORT = wsPort.toString();
    process.env.MOCK_HTTP_PORT = httpPort.toString();

    console.log(`[Fixture] Allocated mock servers: WS_PORT=${wsPort}, HTTP_PORT=${httpPort}`);

    const server = new MockServer(wsPort, httpPort);
    server.start();

    // Load contract schemas
    const schemasDir = path.join(__dirname, '../mocks/schemas');
    const schemas = {
      status: JSON.parse(fs.readFileSync(path.join(schemasDir, 'heartbeat.schema.json'), 'utf8')),
      gps: JSON.parse(fs.readFileSync(path.join(schemasDir, 'gps.schema.json'), 'utf8')),
      telemetry: JSON.parse(fs.readFileSync(path.join(schemasDir, 'battery.schema.json'), 'utf8'))
    };

    // Attach validation helper
    server.validateMessage = (msg) => {
      const type = msg.type;
      const schema = schemas[type];
      if (schema) {
        const isValid = validateAgainstSchema(msg, schema);
        if (!isValid) {
          throw new Error(`Contract validation failed for type "${type}": ${JSON.stringify(msg)}`);
        }
        console.log(`[Contract] Schema verification passed for type: "${type}"`);
        return true;
      }
      return true;
    };

    // Run tests
    await use(server);

    // Stop servers
    server.stop();
  }
});

module.exports = { test, expect, validateAgainstSchema };
