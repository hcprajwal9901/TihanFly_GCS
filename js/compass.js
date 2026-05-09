/**
 * Professional Drone GCS Compass Module - UPDATED WITH IITH COLORS
 * Yellow/Golden accent for headings and active values
 */

class CompassEnhanced {
    constructor(containerId = 'map') {
        this.container = document.getElementById(containerId);
        this.heading = 0;
        this.telemetry = {
            latitude: 0,
            longitude: 0,
            altitude: 0,
            speed: 0,
            distance: 0,
            satellites: 0
        };
        this.compassElement = null;
        this.needleElement = null;
        this.init();
    }

    init() {
        this.createCompassHTML();
        this.injectStyles();
    }

    createCompassHTML() {
        const mainContainer = document.createElement('div');
        mainContainer.className = 'compass-telemetry-container';
        mainContainer.innerHTML = `
            <div class="gcs-compass-panel">
                
                <!-- Left Side Telemetry Group -->
                <div class="telemetry-group left-group">
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">ALT</div>
                        <div class="telemetry-value">
                            <span id="altValue">0.0</span>
                            <span class="telemetry-unit">m</span>
                        </div>
                    </div>
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">SPD</div>
                        <div class="telemetry-value">
                            <span id="spdValue">0.0</span>
                            <span class="telemetry-unit">m/s</span>
                        </div>
                    </div>
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">LAT</div>
                        <div class="telemetry-value telemetry-value-small" id="latValue">0.000000</div>
                    </div>
                </div>

                <!-- Center Compass Widget with SVG -->
                <div class="compass-widget">
                    <div class="compass-svg-container">
                        <!-- Static compass dial background -->
                        <img src="resources/compassInstrumentDial.svg" 
                             class="compass-dial-static" 
                             alt="Compass Dial">
                        
                        <!-- Rotating compass needle/arrow -->
                        <img src="resources/compassInstrumentArrow.svg" 
                             class="compass-arrow-rotating" 
                             id="compassArrow"
                             alt="Compass Arrow">
                        
                        <!-- Heading display - Golden yellow color -->
                        <div class="compass-center-simple">
                            <div class="heading-value" id="headingValue">0°</div>
                        </div>
                    </div>
                </div>

                <!-- Right Side Telemetry Group -->
                <div class="telemetry-group right-group">
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">DIST</div>
                        <div class="telemetry-value">
                            <span id="distValue">0</span>
                            <span class="telemetry-unit">m</span>
                        </div>
                    </div>
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">SAT</div>
                        <div class="telemetry-value" id="satValue">0</div>
                    </div>
                    <div class="telemetry-value-item">
                        <div class="telemetry-label">LON</div>
                        <div class="telemetry-value telemetry-value-small" id="lonValue">0.000000</div>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(mainContainer);
        this.compassElement = document.getElementById('compassArrow');
        this.needleElement = mainContainer.querySelector('.compass-arrow-rotating');
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .compass-telemetry-container {
                position: absolute;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000;
                pointer-events: none;
            }

            .gcs-compass-panel {
                position: relative;
                width: 560px;
                height: 160px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 35px;
            }

            /* Telemetry Groups Layout */
            .telemetry-group {
                display: flex;
                flex-direction: column;
                gap: 15px;
                justify-content: center;
            }

            .left-group {
                align-items: flex-end;
                text-align: right;
            }

            .right-group {
                align-items: flex-start;
                text-align: left;
            }

            .compass-widget {
                flex-shrink: 0;
            }

.compass-svg-container {
    width: 150px;
    height: 150px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(236, 236, 243, 0.95);  /* This is the dark background */
    border-radius: 50%;
    border: 2px solid rgba(239, 239, 241, 0.8);
    box-shadow: 0 3px 15px rgba(255, 255, 255, 0.9),
                inset 0 2px 6px rgba(254, 249, 249, 0.6);
}

            /* Compass Dial (Static Background) */
            .compass-dial-static {
             width: 100%;
             height: 100%;
             position: absolute;
             top: 0;
             left: 0;
             filter: drop-shadow(0 4px 12px rgba(255, 255, 255, 0.6)) invert(1);
}

            /* Compass Arrow/Needle (Rotating) */
            .compass-arrow-rotating {
                width: 65%;
                height: 65%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                pointer-events: none;
                z-index: 5;
                transition: transform 0.3s ease-out;
                transform-origin: center center;
                filter: drop-shadow(0 2px 8px rgba(255, 204, 0, 0.4));
            }

            /* Center heading display - GOLDEN YELLOW COLOR */
            .compass-center-simple {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
                pointer-events: none;
            }

            .heading-value {
                color: #FFCC00;
                font-size: 16px;
                font-weight: bold;
                font-family: 'Arial', monospace;
                text-shadow: 0 0 12px rgba(255, 204, 0, 1),
                             0 0 16px rgba(255, 204, 0, 0.8),
                             0 2px 6px rgba(0, 0, 0, 1);
            }

            /* Telemetry Value Items - NO BACKGROUND */
            .telemetry-value-item {
                display: flex;
                flex-direction: column;
                gap: 2px;
                background: transparent;
                padding: 0;
                border-radius: 0;
                border: none;
                box-shadow: none;
                min-width: 100px;
            }

            .telemetry-label {
                font-size: 10px;
                font-weight: bold;
                color: rgba(255, 204, 0, 0.8);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                font-family: 'Arial', sans-serif;
                text-shadow: 0 2px 5px rgba(0, 0, 0, 1);
            }

            .telemetry-value {
                font-size: 19px;
                font-weight: bold;
                color: #ffffff;
                font-family: 'Courier New', monospace;
                text-shadow: 0 0 12px rgba(255, 204, 0, 0.6),
                             0 0 20px rgba(255, 204, 0, 0.4),
                             0 3px 6px rgba(7, 7, 7, 1);
                white-space: nowrap;
            }

            .telemetry-value-small {
                font-size: 15px;
            }

            .telemetry-unit {
                font-size: 13px;
                color: rgba(255, 253, 253, 0.8);
                margin-left: 3px;
            }

            /* Responsive Design */
            @media (max-width: 768px) {
                .gcs-compass-panel {
                    width: 500px;
                    height: 180px;
                    gap: 25px;
                }
                
                .compass-svg-container {
                    width: 160px;
                    height: 160px;
                }

                .heading-value {
                    font-size: 14px;
                }
                
                .telemetry-value {
                    font-size: 18px;
                }

                .telemetry-value-item {
                    min-width: 80px;
                }
            }

            @media (max-width: 600px) {
                .gcs-compass-panel {
                    width: 400px;
                    height: 160px;
                    gap: 15px;
                }
                
                .compass-svg-container {
                    width: 140px;
                    height: 140px;
                }

                .telemetry-value {
                    font-size: 16px;
                }

                .telemetry-value-item {
                    min-width: 70px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    setHeading(degrees) {
        this.heading = degrees % 360;
        if (this.heading < 0) this.heading += 360;
        
        if (this.compassElement) {
            this.compassElement.style.transform = `translate(-50%, -50%) rotate(${this.heading}deg)`;
        }
        
        const headingValue = document.getElementById('headingValue');
        if (headingValue) {
            headingValue.textContent = Math.round(this.heading) + '°';
        }
    }

    updateTelemetry(data) {
        if (data.latitude !== undefined) {
            this.telemetry.latitude = data.latitude;
            const latElement = document.getElementById('latValue');
            if (latElement) latElement.textContent = data.latitude.toFixed(6);
        }

        if (data.longitude !== undefined) {
            this.telemetry.longitude = data.longitude;
            const lonElement = document.getElementById('lonValue');
            if (lonElement) lonElement.textContent = data.longitude.toFixed(6);
        }

        if (data.altitude !== undefined) {
            this.telemetry.altitude = data.altitude;
            const altElement = document.getElementById('altValue');
            if (altElement) altElement.textContent = data.altitude.toFixed(1);
        }

        if (data.speed !== undefined) {
            this.telemetry.speed = data.speed;
            const spdElement = document.getElementById('spdValue');
            if (spdElement) spdElement.textContent = data.speed.toFixed(1);
        }

        if (data.distance !== undefined) {
            this.telemetry.distance = data.distance;
            const distElement = document.getElementById('distValue');
            if (distElement) {
                if (data.distance >= 1000) {
                    distElement.textContent = (data.distance / 1000).toFixed(2);
                    distElement.nextElementSibling.textContent = 'km';
                } else {
                    distElement.textContent = Math.round(data.distance);
                    distElement.nextElementSibling.textContent = 'm';
                }
            }
        }

        if (data.satellites !== undefined) {
            this.telemetry.satellites = data.satellites;
            const satElement = document.getElementById('satValue');
            if (satElement) satElement.textContent = data.satellites;
        }
    }

    getHeading() {
        return this.heading;
    }

    getTelemetry() {
        return { ...this.telemetry };
    }

    startRotation(speed = 1) {
        this.rotationInterval = setInterval(() => {
            this.setHeading(this.heading + speed);
        }, 50);
    }

    stopRotation() {
        if (this.rotationInterval) {
            clearInterval(this.rotationInterval);
        }
    }

    show() {
        const container = document.querySelector('.compass-telemetry-container');
        if (container) {
            container.style.display = 'block';
        }
    }

    hide() {
        const container = document.querySelector('.compass-telemetry-container');
        if (container) {
            container.style.display = 'none';
        }
    }

    destroy() {
        this.stopRotation();
        const container = document.querySelector('.compass-telemetry-container');
        if (container) {
            container.remove();
        }
    }
}