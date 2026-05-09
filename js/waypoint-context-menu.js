/**
 * Waypoint Context Menu
 * Right-click context menu for waypoint operations
 * Mimics the functionality shown in the reference image
 */

class WaypointContextMenu {
    constructor() {
        console.log('🎯 WaypointContextMenu constructor called');
        
        this.menu = null;
        this.currentWaypoint = null;
        this.waypointManager = null;
        
        this.initialize();
    }

    initialize() {
        console.log('📋 Initializing Waypoint Context Menu...');
        
        // Create menu element
        this.createMenuElement();
        
        // Add event listeners
        this.attachEventListeners();
        
        // Wait for WaypointManager
        this.connectToWaypointManager();
        
        console.log('✅ Waypoint Context Menu initialized');
    }

    connectToWaypointManager() {
        // Check if WaypointManager is available
        const checkInterval = setInterval(() => {
            if (window.WaypointManager) {
                this.waypointManager = window.WaypointManager;
                console.log('✅ Connected to WaypointManager');
                clearInterval(checkInterval);
            }
        }, 100);
        
        // Stop checking after 5 seconds
        setTimeout(() => clearInterval(checkInterval), 5000);
    }

    createMenuElement() {
        // Create menu container
        this.menu = document.createElement('div');
        this.menu.id = 'waypointContextMenu';
        this.menu.className = 'waypoint-context-menu';
        this.menu.style.display = 'none';
        
        // Menu items based on the reference image
        const menuItems = [
            { action: 'delete-wp', label: 'Delete WP', icon: '🗑️' },
            { action: 'insert-wp', label: 'Insert Wp', icon: '➕', hasSubmenu: true },
            { action: 'insert-spline-wp', label: 'Insert Spline WP', icon: '〰️', hasSubmenu: true },
            { action: 'loiter', label: 'Loiter', icon: '⭕', hasSubmenu: true },
            { action: 'jump', label: 'Jump', icon: '🔄', hasSubmenu: true },
            { type: 'separator' },
            { action: 'rtl', label: 'RTL', icon: '🏠' },
            { action: 'land', label: 'Land', icon: '🛬' },
            { action: 'takeoff', label: 'Takeoff', icon: '🛫' },
            { action: 'do-set-roi', label: 'DO_SET_ROI', icon: '🎯' },
            { action: 'clear-mission', label: 'Clear Mission', icon: '🧹' },
            { type: 'separator' },
            { action: 'polygon', label: 'Polygon', icon: '⬡', hasSubmenu: true },
            { action: 'geo-fence', label: 'Geo-Fence', icon: '🚧', hasSubmenu: true },
            { action: 'rally-points', label: 'Rally Points', icon: '📍', hasSubmenu: true },
            { action: 'auto-wp', label: 'Auto WP', icon: '🤖', hasSubmenu: true },
            { action: 'map-tool', label: 'Map Tool', icon: '🗺️', hasSubmenu: true },
            { action: 'file-load-save', label: 'File Load/Save', icon: '💾', hasSubmenu: true },
            { action: 'poi', label: 'POI', icon: '📌', hasSubmenu: true },
            { action: 'tracker-home', label: 'Tracker Home', icon: '🏡' },
            { action: 'modify-alt', label: 'Modify Alt', icon: '↕️' },
            { action: 'enter-utm-coord', label: 'Enter UTM Coord', icon: '🌐' },
            { action: 'switch-docking', label: 'Switch Docking', icon: '🔌' },
            { action: 'set-home-here', label: 'Set Home Here', icon: '🏠' }
        ];
        
        // Build menu HTML
        let menuHTML = '<div class="context-menu-items">';
        
        menuItems.forEach(item => {
            if (item.type === 'separator') {
                menuHTML += '<div class="context-menu-separator"></div>';
            } else {
                menuHTML += `
                    <div class="context-menu-item" data-action="${item.action}">
                        <span class="context-menu-icon">${item.icon}</span>
                        <span class="context-menu-label">${item.label}</span>
                        ${item.hasSubmenu ? '<span class="context-menu-arrow">▶</span>' : ''}
                    </div>
                `;
            }
        });
        
        menuHTML += '</div>';
        
        this.menu.innerHTML = menuHTML;
        
        // Add to body
        document.body.appendChild(this.menu);
        
        console.log('✅ Context menu element created');
    }

    attachEventListeners() {
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.menu.contains(e.target)) {
                this.hideMenu();
            }
        });
        
        // Handle menu item clicks
        this.menu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.context-menu-item');
            if (!menuItem) return;
            
            const action = menuItem.dataset.action;
            this.handleMenuAction(action);
        });
        
        // Prevent context menu on the context menu itself
        this.menu.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        console.log('✅ Event listeners attached');
    }

    showMenu(x, y, waypoint) {
        console.log(`📋 Showing context menu at (${x}, ${y}) for waypoint:`, waypoint);
        
        this.currentWaypoint = waypoint;
        
        // Position menu
        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';
        this.menu.style.display = 'block';
        
        // Adjust if menu goes off screen
        const menuRect = this.menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        if (menuRect.right > windowWidth) {
            this.menu.style.left = (x - menuRect.width) + 'px';
        }
        
        if (menuRect.bottom > windowHeight) {
            this.menu.style.top = (y - menuRect.height) + 'px';
        }
        
        console.log('✅ Context menu shown');
    }

    hideMenu() {
        this.menu.style.display = 'none';
        this.currentWaypoint = null;
        console.log('✅ Context menu hidden');
    }

    handleMenuAction(action) {
        console.log(`🎯 Menu action: ${action}`);
        console.log('Current waypoint:', this.currentWaypoint);
        
        // Handle polygon submenu actions (don't hide menu for these)
        if (action.startsWith('polygon-')) {
            this.handlePolygonAction(action);
            return;
        }
        
        if (!this.waypointManager) {
            console.error('❌ WaypointManager not available');
            if (window.MsgConsole) {
                window.MsgConsole.error('WaypointManager not initialized');
            }
            this.hideMenu();
            return;
        }
        
        // Handle different actions
        switch(action) {
            case 'delete-wp':
                this.deleteWaypoint();
                break;
                
            case 'insert-wp':
                if (window.MsgConsole) {
                    window.MsgConsole.info('Click on map to insert waypoint');
                }
                this.waypointManager.startInsertingWaypoint();
                break;
                
            case 'clear-mission':
                this.clearMission();
                break;
                
            case 'rtl':
                this.returnToLaunch();
                break;
                
            case 'land':
                this.landHere();
                break;
                
            case 'takeoff':
                if (window.MsgConsole) {
                    window.MsgConsole.info('Click on map to set takeoff position');
                }
                this.waypointManager.startSettingHome();
                break;
                
            case 'set-home-here':
                this.setHomeHere();
                break;
                
            case 'modify-alt':
                this.modifyAltitude();
                break;
                
            case 'polygon':
                // Show polygon submenu
                this.showPolygonSubmenu();
                return; // Don't hide menu
                
            default:
                if (window.MsgConsole) {
                    window.MsgConsole.info(`${action} feature coming soon`);
                }
                console.log(`Action ${action} not yet implemented`);
        }
        
        // Hide menu after action
        this.hideMenu();
    }
    
    // ========================================================================
    // POLYGON ACTIONS
    // ========================================================================
    
    showPolygonSubmenu() {
        console.log('🔷 Showing polygon submenu');
        
        // Find the polygon menu item
        const polygonItem = this.menu.querySelector('[data-action="polygon"]');
        if (!polygonItem) return;
        
        // Create or show submenu
        let submenu = this.menu.querySelector('.polygon-submenu');
        
        if (!submenu) {
            submenu = document.createElement('div');
            submenu.className = 'context-menu-submenu polygon-submenu';
            submenu.innerHTML = `
                <div class="context-menu-item" data-action="polygon-draw">
                    <span class="context-menu-label">Draw a Polygon</span>
                </div>
                <div class="context-menu-item" data-action="polygon-clear">
                    <span class="context-menu-label">Clear Polygon</span>
                </div>
                <div class="context-menu-item" data-action="polygon-save">
                    <span class="context-menu-label">Save Polygon</span>
                </div>
                <div class="context-menu-item" data-action="polygon-load">
                    <span class="context-menu-label">Load Polygon</span>
                </div>
                <div class="context-menu-item" data-action="polygon-from-shp">
                    <span class="context-menu-label">From SHP</span>
                </div>
                <div class="context-menu-item" data-action="polygon-from-waypoints">
                    <span class="context-menu-label">From Current Waypoints</span>
                </div>
                <div class="context-menu-item" data-action="polygon-offset">
                    <span class="context-menu-label">Offset Polygon</span>
                </div>
                <div class="context-menu-item" data-action="polygon-area">
                    <span class="context-menu-label">Area</span>
                </div>
            `;
            
            // Position submenu
            const rect = polygonItem.getBoundingClientRect();
            submenu.style.position = 'fixed';
            submenu.style.left = (rect.right + 5) + 'px';
            submenu.style.top = rect.top + 'px';
            
            document.body.appendChild(submenu);
        } else {
            submenu.style.display = 'block';
        }
        
        // Close submenu when clicking outside
        const closeSubmenu = (e) => {
            if (!submenu.contains(e.target) && !polygonItem.contains(e.target)) {
                submenu.style.display = 'none';
                document.removeEventListener('click', closeSubmenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeSubmenu);
        }, 100);
    }
    
    handlePolygonAction(action) {
        console.log(`🔷 Polygon action: ${action}`);
        
        if (!window.PolygonManager) {
            if (window.MsgConsole) {
                window.MsgConsole.error('Polygon Manager not initialized');
            }
            console.error('❌ PolygonManager not available');
            this.hideMenu();
            return;
        }
        
        switch(action) {
            case 'polygon-draw':
                window.PolygonManager.startDrawingPolygon();
                break;
                
            case 'polygon-clear':
                window.PolygonManager.clearAllPolygons();
                break;
                
            case 'polygon-save':
                if (window.PolygonManager.polygons.length > 0) {
                    window.PolygonManager.saveAllPolygons();
                } else {
                    if (window.MsgConsole) {
                        window.MsgConsole.warning('No polygons to save');
                    }
                }
                break;
                
            case 'polygon-load':
                this.showPolygonFileInput();
                break;
                
            case 'polygon-from-shp':
                if (window.MsgConsole) {
                    window.MsgConsole.info('SHP import feature coming soon');
                }
                break;
                
            case 'polygon-from-waypoints':
                window.PolygonManager.fromCurrentWaypoints();
                break;
                
            case 'polygon-offset':
                this.showOffsetDialog();
                break;
                
            case 'polygon-area':
                this.showPolygonAreas();
                break;
        }
        
        // Hide menu and submenu
        this.hideMenu();
        const submenu = document.querySelector('.polygon-submenu');
        if (submenu) {
            submenu.style.display = 'none';
        }
    }
    
    showPolygonFileInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.poly,.json';
        input.onchange = (e) => {
            window.PolygonManager.loadPolygon(input);
        };
        input.click();
    }
    
    showOffsetDialog() {
        const offset = prompt('Enter offset distance in meters:', '10');
        if (offset && !isNaN(offset)) {
            const offsetMeters = parseFloat(offset);
            if (window.PolygonManager.polygons.length > 0) {
                const lastPolygon = window.PolygonManager.polygons[window.PolygonManager.polygons.length - 1];
                window.PolygonManager.offsetPolygon(lastPolygon.id, offsetMeters);
            } else {
                if (window.MsgConsole) {
                    window.MsgConsole.warning('No polygon to offset');
                }
            }
        }
    }
    
    showPolygonAreas() {
        if (window.PolygonManager.polygons.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No polygons available');
            }
            return;
        }
        
        let message = 'Polygon Areas:\n\n';
        window.PolygonManager.polygons.forEach(polygon => {
            const info = window.PolygonManager.getAreaInfo(polygon.id);
            if (info) {
                message += `${info.name}:\n`;
                message += `  - ${info.areaHectares} hectares\n`;
                message += `  - ${info.areaKm2} km²\n`;
                message += `  - ${info.area.toFixed(2)} m²\n\n`;
            }
        });
        
        alert(message);
    }

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================
    
    deleteWaypoint() {
        if (!this.currentWaypoint) return;
        
        const waypointId = this.currentWaypoint.id;
        
        if (this.waypointManager) {
            this.waypointManager.removeWaypoint(waypointId);
            if (window.MsgConsole) {
                window.MsgConsole.success(`Waypoint ${waypointId} deleted`);
            }
        }
        
        console.log(`✅ Waypoint ${waypointId} deleted`);
    }
    
    clearMission() {
        if (!confirm('Are you sure you want to clear the entire mission?')) {
            return;
        }
        
        if (this.waypointManager) {
            this.waypointManager.clearAllWaypoints();
            if (window.MsgConsole) {
                window.MsgConsole.success('Mission cleared');
            }
        }
        
        console.log('✅ Mission cleared');
    }
    
    returnToLaunch() {
        if (window.MsgConsole) {
            window.MsgConsole.info('Click on map to set RTL position');
        }
        
        if (this.waypointManager) {
            this.waypointManager.startAddingReturnPoint();
        }
        
        console.log('🏠 RTL mode activated');
    }
    
    landHere() {
        if (!this.currentWaypoint) {
            if (window.MsgConsole) {
                window.MsgConsole.info('Click on map to set landing position');
            }
            if (this.waypointManager) {
                this.waypointManager.currentMode = 'land';
                this.waypointManager.tmap.enableClick();
            }
            return;
        }
        
        // Add landing point at current waypoint location
        if (this.waypointManager) {
            this.waypointManager.addLandingPoint(
                this.currentWaypoint.lat,
                this.currentWaypoint.lng
            );
            if (window.MsgConsole) {
                window.MsgConsole.success('Landing point added');
            }
        }
        
        console.log('🛬 Landing point set');
    }
    
    setHomeHere() {
        if (!this.currentWaypoint) return;
        
        if (this.waypointManager) {
            this.waypointManager.setHomePosition(
                this.currentWaypoint.lat,
                this.currentWaypoint.lng
            );
            if (window.MsgConsole) {
                window.MsgConsole.success('Home position set');
            }
        }
        
        console.log('🏠 Home position set');
    }
    
    modifyAltitude() {
        if (!this.currentWaypoint) return;
        
        const currentAlt = this.currentWaypoint.altitude || 50;
        const newAlt = prompt(`Enter new altitude for Waypoint ${this.currentWaypoint.id} (meters):`, currentAlt);
        
        if (newAlt !== null && !isNaN(newAlt)) {
            const altitude = parseFloat(newAlt);
            this.currentWaypoint.altitude = altitude;
            
            // Update popup
            if (this.currentWaypoint.marker) {
                const popupContent = `
                    <div style="text-align: center; font-family: Arial, sans-serif;">
                        <strong style="color: #E6007E;">Waypoint ${this.currentWaypoint.id}</strong><br>
                        <small>Lat: ${this.currentWaypoint.lat.toFixed(6)}<br>
                        Lng: ${this.currentWaypoint.lng.toFixed(6)}<br>
                        Alt: ${altitude}m</small>
                    </div>
                `;
                this.currentWaypoint.marker.setPopupContent(popupContent);
            }
            
            if (window.MsgConsole) {
                window.MsgConsole.success(`Altitude updated to ${altitude}m`);
            }
            
            console.log(`✅ Waypoint ${this.currentWaypoint.id} altitude set to ${altitude}m`);
        }
    }

    // ========================================================================
    // ATTACH TO WAYPOINT MARKER
    // ========================================================================
    
    attachToMarker(marker, waypoint) {
        console.log('📍 Attaching context menu to marker for waypoint:', waypoint.id);
        
        // Add right-click event to marker
        marker.on('contextmenu', (e) => {
            console.log('🖱️ Right-click on waypoint marker');
            
            // Prevent default context menu
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            
            // Get click position
            const x = e.originalEvent.clientX;
            const y = e.originalEvent.clientY;
            
            // Show context menu
            this.showMenu(x, y, waypoint);
        });
        
        console.log('✅ Context menu attached to marker');
    }
}

// ============================================================================
// INITIALIZE AND EXPOSE GLOBALLY
// ============================================================================

let waypointContextMenu = null;

function initializeWaypointContextMenu() {
    console.log('🎯 Initializing Waypoint Context Menu...');
    
    if (!waypointContextMenu) {
        waypointContextMenu = new WaypointContextMenu();
        
        // Expose globally
        window.WaypointContextMenu = waypointContextMenu;
        
        console.log('✅ Waypoint Context Menu initialized and exposed globally');
    }
    
    return waypointContextMenu;
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWaypointContextMenu);
} else {
    initializeWaypointContextMenu();
}

console.log('✅ Waypoint Context Menu Script Loaded');