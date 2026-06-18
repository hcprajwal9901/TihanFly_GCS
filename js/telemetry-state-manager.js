/**
 * telemetry-state-manager.js — TiHANFly GCS
 * Telemetry State Manager for sequence tracking, timestamp tracking,
 * duplicate filtering, out-of-order filtering, and state reconciliation.
 */

(function () {
    'use strict';

    class TelemetryStateManager {
        constructor() {
            this.lastTimestamps = {}; // key: "sysid:type" -> timestamp
            this.lastSequences = {};  // key: "sysid:type" -> sequence
        }

        reset() {
            this.lastTimestamps = {};
            this.lastSequences = {};
            console.log('[TelemetryManager] Reset state filters');
        }

        process(message) {
            if (!message || !message.type) return true;

            const sysid = message.sysid !== undefined ? message.sysid : 1;
            const type = message.type;
            const key = `${sysid}:${type}`;

            // Extract sequence and timestamp fields
            const seq = message.seq !== undefined ? message.seq : null;
            const ts = message.timestamp !== undefined ? message.timestamp : (message.ts !== undefined ? message.ts : null);

            // 1. Sequence-based filtering
            if (seq !== null) {
                const lastSeq = this.lastSequences[key];
                if (lastSeq !== undefined) {
                    if (seq < lastSeq) {
                        console.warn(`[TelemetryManager] Ignored out-of-order packet (seq: ${seq} < ${lastSeq}) for ${key}`);
                        return false; // ignore/reject
                    }
                    if (seq === lastSeq) {
                        console.warn(`[TelemetryManager] Ignored duplicate packet (seq: ${seq}) for ${key}`);
                        return false; // ignore/reject
                    }
                }
                this.lastSequences[key] = seq;
            }

            // 2. Timestamp-based filtering
            if (ts !== null) {
                const lastTs = this.lastTimestamps[key];
                if (lastTs !== undefined) {
                    if (ts < lastTs) {
                        console.warn(`[TelemetryManager] Ignored out-of-order packet (ts: ${ts} < ${lastTs}) for ${key}`);
                        return false; // ignore/reject
                    }
                    if (ts === lastTs) {
                        console.warn(`[TelemetryManager] Ignored duplicate packet (ts: ${ts}) for ${key}`);
                        return false; // ignore/reject
                    }
                }
                this.lastTimestamps[key] = ts;
            }

            return true; // accept
        }
    }

    // Expose globally
    window.telemetryManager = new TelemetryStateManager();
    console.log('✅ Telemetry State Manager loaded');
})();
