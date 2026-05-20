/**
 * flight-hud.js
 * Implements a Mission Planner style Head-Up Display (HUD) using HTML5 Canvas.
 * Uses window.TelemetryStore for state.
 */

(function () {
    let canvas, ctx;
    let width, height;
    let isHudVisible = false;
    let animationFrameId;

    // We'll smooth out the telemetry to avoid jitter
    const smoothedTelem = {
        roll: 0,
        pitch: 0,
        yaw: 0,
        altitude: 0,
        speed: 0
    };

    // Smoothing factor must be between 0.0 and 1.0. 
    // 0.45 gives a very fast response time (settles in ~40ms) while still providing 
    // enough interpolation to avoid the "stuck" jumpiness of higher values.
    const SMOOTH_FACTOR = 0.78;

    function init() {
        const hudContainer = document.getElementById('hudContainer');
        const hudToggle = document.getElementById('toggleHud');
        canvas = document.getElementById('hudCanvas');

        const closeBtn = document.getElementById('hudCloseBtn');

        if (!canvas || !hudContainer || !hudToggle) {
            console.error('[Flight HUD] Initialization failed: Missing elements');
            return;
        }

        ctx = canvas.getContext('2d');

        const titleBar = document.getElementById('hudTitleBar');

        // Custom drag logic tied ONLY to the title bar so it doesn't break CSS resize
        if (titleBar) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

            titleBar.onmousedown = (e) => {
                if (e.target.tagName.toLowerCase() === 'button') return;
                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;

                const rect = hudContainer.getBoundingClientRect();
                hudContainer.style.transition = 'none';
                hudContainer.style.top = rect.top + 'px';
                hudContainer.style.left = rect.left + 'px';
                hudContainer.style.bottom = 'auto';
                hudContainer.style.right = 'auto';

                document.onmouseup = closeDragElement;
                document.onmousemove = elementDrag;
            };

            function elementDrag(e) {
                e.preventDefault();
                pos1 = pos3 - e.clientX;
                pos2 = pos4 - e.clientY;
                pos3 = e.clientX;
                pos4 = e.clientY;
                hudContainer.style.top = (hudContainer.offsetTop - pos2) + "px";
                hudContainer.style.left = (hudContainer.offsetLeft - pos1) + "px";
            }

            function closeDragElement() {
                document.onmouseup = null;
                document.onmousemove = null;
                hudContainer.style.transition = '';
            }
        }

        // Add ResizeObserver to handle native resize
        const resizeObserver = new ResizeObserver(() => {
            if (isHudVisible) resize();
        });
        resizeObserver.observe(hudContainer);

        // Toggle logic
        hudToggle.addEventListener('change', (e) => {
            isHudVisible = e.target.checked;
            if (isHudVisible) {
                hudContainer.classList.add('hud-visible');
                resize();
                startAnimation();
            } else {
                hudContainer.classList.remove('hud-visible');
                stopAnimation();
            }
        });

        // Close button logic
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                hudToggle.checked = false;
                hudToggle.dispatchEvent(new Event('change')); // Trigger toggle logic
            });
        }

        // Initialize state based on toggle
        isHudVisible = hudToggle.checked;
        if (isHudVisible) {
            hudContainer.classList.add('hud-visible');
            startAnimation();
        }

        window.addEventListener('resize', () => {
            if (isHudVisible) resize();
        });
    }

    function resize() {
        if (!canvas) return;
        const container = canvas.parentElement;

        // Ensure canvas width matches its client area
        width = container.clientWidth;
        // height should be container height MINUS the title bar (which is 30px plus border)
        // Let's just use the canvas's own clientHeight since flex: 1 1 0 will size it.
        height = canvas.clientHeight;

        if (width === 0 || height === 0) return; // not visible yet

        canvas.width = width;
        canvas.height = height;
    }

    function startAnimation() {
        if (!animationFrameId) {
            updateAndDraw();
        }
    }

    function stopAnimation() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    function updateAndDraw() {
        if (!isHudVisible) {
            animationFrameId = null;
            return;
        }

        updateSmoothedTelemetry();
        drawHUD();

        animationFrameId = requestAnimationFrame(updateAndDraw);
    }

    function updateSmoothedTelemetry() {
        const ts = window.TelemetryStore;

        // Circular interpolation for yaw (to prevent spinning when wrapping 0-360)
        let targetYaw = (ts.yaw !== undefined) ? (ts.yaw * 180 / Math.PI) : 0;
        if (targetYaw < 0) targetYaw += 360;

        let diffYaw = targetYaw - smoothedTelem.yaw;
        if (diffYaw > 180) diffYaw -= 360;
        if (diffYaw < -180) diffYaw += 360;

        smoothedTelem.yaw += diffYaw * SMOOTH_FACTOR;
        if (smoothedTelem.yaw < 0) smoothedTelem.yaw += 360;
        if (smoothedTelem.yaw >= 360) smoothedTelem.yaw -= 360;

        let sourceAlt = ts.altitude || 0;
        let sourceSpeed = ts.speed || 0;

        // Use compass telemetry endpoint as requested, if available
        if (window.compass && window.compass.telemetry) {
            if (window.compass.telemetry.altitude !== undefined) {
                sourceAlt = window.compass.telemetry.altitude;
            }
            if (window.compass.telemetry.speed !== undefined) {
                sourceSpeed = window.compass.telemetry.speed;
            }
        }

        smoothedTelem.roll += ((ts.roll || 0) - smoothedTelem.roll) * SMOOTH_FACTOR;
        smoothedTelem.pitch += ((ts.pitch || 0) - smoothedTelem.pitch) * SMOOTH_FACTOR;
        smoothedTelem.altitude += (sourceAlt - smoothedTelem.altitude) * SMOOTH_FACTOR;
        smoothedTelem.speed += (sourceSpeed - smoothedTelem.speed) * SMOOTH_FACTOR;
    }

    function drawHUD() {
        ctx.clearRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;

        // Artificial Horizon
        drawArtificialHorizon(cx, cy);

        // Pitch Ladder
        drawPitchLadder(cx, cy);

        // Center Crosshair
        drawCrosshair(cx, cy);

        // Roll Indicator
        drawRollIndicator(cx, cy);

        // Tapes - draw heading tape at the very top (y=0)
        drawHeadingTape(cx, 0);
        drawAltitudeTape(width - 70, cy);
        drawSpeedTape(70, cy);

        // Info Text
        drawTelemetryText();
    }

    function drawArtificialHorizon(cx, cy) {
        ctx.save();

        // No clipping - let the horizon fill the entire HUD background
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();

        // Translate to center, rotate by roll
        ctx.translate(cx, cy);
        ctx.rotate(smoothedTelem.roll);

        // Pitch translation: pixels per radian
        const pixelsPerRadian = 400; // Adjust for sensitivity
        const pitchOffset = smoothedTelem.pitch * pixelsPerRadian;
        ctx.translate(0, pitchOffset);

        // We draw two large rectangles: blue for sky, brown for ground
        const extent = Math.max(width, height) * 2;

        // Sky
        ctx.fillStyle = 'rgba(41, 128, 185, 0.4)'; // semi-transparent blue
        ctx.fillRect(-extent, -extent, extent * 2, extent);

        // Ground
        ctx.fillStyle = 'rgba(139, 69, 19, 0.4)'; // semi-transparent brown
        ctx.fillRect(-extent, 0, extent * 2, extent);

        // Horizon line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-extent, 0);
        ctx.lineTo(extent, 0);
        ctx.stroke();

        ctx.restore();
    }

    function drawPitchLadder(cx, cy) {
        ctx.save();

        // Clip to screen bounds to prevent spilling over (if any)
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();

        ctx.translate(cx, cy);
        ctx.rotate(smoothedTelem.roll);

        const pixelsPerRadian = 400;
        const pitchOffset = smoothedTelem.pitch * pixelsPerRadian;
        ctx.translate(0, pitchOffset);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw pitch lines every 5 degrees
        const stepDeg = 5;
        const stepRad = stepDeg * Math.PI / 180;
        const stepPx = stepRad * pixelsPerRadian;

        for (let i = -18; i <= 18; i++) {
            if (i === 0) continue; // Skip 0, drawn by horizon

            const p = -i * stepPx;
            const w = (i % 2 === 0) ? 60 : 30; // wider lines every 10 deg

            ctx.beginPath();
            if (i > 0) {
                // Positive pitch (sky) - solid lines
                ctx.moveTo(-w, p);
                ctx.lineTo(-20, p);
                ctx.moveTo(20, p);
                ctx.lineTo(w, p);
                // Down ticks at edges
                ctx.moveTo(-w, p); ctx.lineTo(-w, p + 5);
                ctx.moveTo(w, p); ctx.lineTo(w, p + 5);
            } else {
                // Negative pitch (ground) - dashed lines
                ctx.setLineDash([5, 5]);
                ctx.moveTo(-w, p);
                ctx.lineTo(-20, p);
                ctx.moveTo(20, p);
                ctx.lineTo(w, p);
                ctx.setLineDash([]);
                // Up ticks at edges
                ctx.moveTo(-w, p); ctx.lineTo(-w, p - 5);
                ctx.moveTo(w, p); ctx.lineTo(w, p - 5);
            }
            ctx.stroke();

            // Text
            if (i % 2 === 0) {
                ctx.fillText(Math.abs(i * 5), -w - 15, p);
                ctx.fillText(Math.abs(i * 5), w + 15, p);
            }
        }

        ctx.restore();
    }

    function drawCrosshair(cx, cy) {
        ctx.save();
        ctx.translate(cx, cy);

        ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)'; // yellow crosshair
        ctx.lineWidth = 3;

        // Draw an aircraft symbol
        ctx.beginPath();
        // Left wing
        ctx.moveTo(-40, 0);
        ctx.lineTo(-10, 0);
        ctx.lineTo(-10, 10);
        // Right wing
        ctx.moveTo(40, 0);
        ctx.lineTo(10, 0);
        ctx.lineTo(10, 10);
        // Center dot
        ctx.moveTo(0, -2);
        ctx.lineTo(0, 2);

        ctx.stroke();

        ctx.restore();
    }

    function drawRollIndicator(cx, cy) {
        ctx.save();
        ctx.translate(cx, cy);

        // Scale roll indicator based on canvas size, leave room for top tape
        const r = Math.min(width, height) / 2 * 0.70;

        // Draw fixed arc and ticks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2 - Math.PI / 3, -Math.PI / 2 + Math.PI / 3);
        ctx.stroke();

        // Roll ticks
        const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
        ticks.forEach(angle => {
            const rad = angle * Math.PI / 180 - Math.PI / 2;
            const inner = (angle === 0 || Math.abs(angle) === 30 || Math.abs(angle) === 60) ? r - 15 : r - 8;
            ctx.beginPath();
            ctx.moveTo(Math.cos(rad) * r, Math.sin(rad) * r);
            ctx.lineTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
            ctx.stroke();
        });

        // Moving pointer (triangle)
        ctx.rotate(smoothedTelem.roll);
        ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(-8, -r + 15);
        ctx.lineTo(8, -r + 15);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function drawHeadingTape(cx, y) {
        ctx.save();

        const tapeWidth = Math.min(width * 0.7, 400); // 70% of width up to 400px
        const tapeHeight = 30;
        const pxPerDeg = tapeWidth / 90; // show 90 degrees field of view

        ctx.translate(cx, y);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(-tapeWidth / 2, 0, tapeWidth, tapeHeight);

        // Clipping
        ctx.beginPath();
        ctx.rect(-tapeWidth / 2, 0, tapeWidth, tapeHeight);
        ctx.clip();

        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", "Segoe UI", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const centerHeading = smoothedTelem.yaw;
        const startDeg = Math.floor(centerHeading - 45);
        const endDeg = Math.ceil(centerHeading + 45);

        for (let i = startDeg; i <= endDeg; i++) {
            if (i % 5 === 0) {
                const x = (i - centerHeading) * pxPerDeg;
                let displayDeg = i % 360;
                if (displayDeg < 0) displayDeg += 360;

                ctx.beginPath();
                if (i % 15 === 0) {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, 10);
                    let text = displayDeg.toString();
                    if (displayDeg === 0) text = "N";
                    else if (displayDeg === 90) text = "E";
                    else if (displayDeg === 180) text = "S";
                    else if (displayDeg === 270) text = "W";

                    ctx.fillText(text, x, 12);
                } else {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, 5);
                }
                ctx.stroke();
            }
        }

        ctx.restore();

        // Center Marker (fixed)
        ctx.save();
        ctx.translate(cx, y);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.moveTo(0, tapeHeight);
        ctx.lineTo(-6, tapeHeight + 8);
        ctx.lineTo(6, tapeHeight + 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawAltitudeTape(x, cy) {
        ctx.save();

        // Dynamic width/height based on canvas size
        const tapeWidth = 55;
        const tapeHeight = height * 0.7;
        const pxPerMeter = 10;

        // Position tape on the right edge: x is the LEFT edge of the tape
        x = width - tapeWidth - 5;

        ctx.translate(x, cy);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, -tapeHeight / 2, tapeWidth, tapeHeight);

        // Clipping
        ctx.beginPath();
        ctx.rect(0, -tapeHeight / 2, tapeWidth, tapeHeight);
        ctx.clip();

        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", "Segoe UI", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const centerAlt = smoothedTelem.altitude;
        const startAlt = Math.floor(centerAlt - (tapeHeight / 2) / pxPerMeter);
        const endAlt = Math.ceil(centerAlt + (tapeHeight / 2) / pxPerMeter);

        for (let i = startAlt; i <= endAlt; i++) {
            if (i % 1 === 0) { // ticks every meter
                // NOTE: Altitude goes UP visually as value increases, so y is inverted
                const y = -(i - centerAlt) * pxPerMeter;

                ctx.beginPath();
                if (i % 5 === 0) {
                    ctx.moveTo(0, y);
                    ctx.lineTo(10, y);
                    ctx.fillText(i.toString(), 15, y);
                } else {
                    ctx.moveTo(0, y);
                    ctx.lineTo(5, y);
                }
                ctx.stroke();
            }
        }

        ctx.restore();

        // Readout Box (fixed in center)
        ctx.save();
        ctx.translate(x, cy);
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.fillRect(-10, -15, tapeWidth + 10, 30);
        ctx.strokeRect(-10, -15, tapeWidth + 10, 30);

        ctx.fillStyle = '#4fc3f7';
        ctx.font = 'bold 14px "JetBrains Mono", "Segoe UI", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(smoothedTelem.altitude.toFixed(1), tapeWidth / 2 - 5, 0);
        ctx.restore();
    }

    function drawSpeedTape(x, cy) {
        ctx.save();

        const tapeWidth = 55;
        const tapeHeight = height * 0.7;
        const pxPerUnit = 10;

        // Position tape on the left edge: x is the RIGHT edge of the tape
        x = tapeWidth + 5;

        ctx.translate(x, cy);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(-tapeWidth, -tapeHeight / 2, tapeWidth, tapeHeight);

        // Clipping
        ctx.beginPath();
        ctx.rect(-tapeWidth, -tapeHeight / 2, tapeWidth, tapeHeight);
        ctx.clip();

        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", "Segoe UI", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const centerSpeed = smoothedTelem.speed;
        let startSpd = Math.floor(centerSpeed - (tapeHeight / 2) / pxPerUnit);
        if (startSpd < 0) startSpd = 0; // Don't draw negative speed usually
        const endSpd = Math.ceil(centerSpeed + (tapeHeight / 2) / pxPerUnit);

        for (let i = startSpd; i <= endSpd; i++) {
            if (i % 1 === 0) {
                const y = -(i - centerSpeed) * pxPerUnit;

                ctx.beginPath();
                if (i % 5 === 0) {
                    ctx.moveTo(0, y);
                    ctx.lineTo(-10, y);
                    ctx.fillText(i.toString(), -15, y);
                } else {
                    ctx.moveTo(0, y);
                    ctx.lineTo(-5, y);
                }
                ctx.stroke();
            }
        }

        ctx.restore();

        // Readout Box
        ctx.save();
        ctx.translate(x, cy);
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
        ctx.strokeStyle = '#81c784';
        ctx.lineWidth = 2;
        ctx.fillRect(-tapeWidth, -15, tapeWidth + 10, 30);
        ctx.strokeRect(-tapeWidth, -15, tapeWidth + 10, 30);

        ctx.fillStyle = '#81c784';
        ctx.font = 'bold 14px "JetBrains Mono", "Segoe UI", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(smoothedTelem.speed.toFixed(1), -tapeWidth / 2 + 5, 0);
        ctx.restore();
    }

    function drawTelemetryText() {
        ctx.save();
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        // Bottom Left Corner
        const textX = 15;
        const textY = height - 15;

        // Adding strong text shadow for readability against horizon/tapes
        ctx.shadowColor = "rgba(0, 0, 0, 1)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        ctx.fillStyle = '#4fc3f7';
        ctx.fillText(window.TelemetryStore.mode || "UNKNOWN", textX, textY - 40);

        ctx.fillStyle = '#fff';
        const batteryStr = `BATT: ${(window.TelemetryStore.batteryVoltage || 0).toFixed(1)}V / ${(window.TelemetryStore.batteryPercent || 0)}%`;
        ctx.fillText(batteryStr, textX, textY - 20);

        const gpsStr = `GPS: ${(window.TelemetryStore.satellites || 0)} Sats`;
        ctx.fillText(gpsStr, textX, textY);

        // Remove the hardcoded units that overlap tapes
        ctx.restore();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
