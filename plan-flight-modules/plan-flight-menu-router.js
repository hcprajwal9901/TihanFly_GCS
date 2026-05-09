/**
 * Plan Flight Mode - Menu Action Router
 * Routes menu actions to the appropriate handler module
 */

PlanFlightMode.prototype.handleMenuAction = function(action) {
    console.log(`🎯 Menu action: ${action}`);

    // Determine which category the action belongs to
    const fileActions = ['new-mission', 'open-mission', 'save-mission'];
    const takeoffActions = ['takeoff-here', 'set-home-position', 'clear-home'];
    const waypointActions = [
        'add-waypoint',
        'insert-waypoint',
        'delete-waypoint',
        'clear-all'
        // NOTE: 'send-markers' removed from here — now handled by missionActions below
    ];

    // Mission send actions → handleMissionSendActions() (plan-flight-mission-send.js)
    const missionActions = [
        'send-markers',
        'send-mission',
        'write-to-drone',
        'start-mission'
    ];

    const polygonActions = ['draw-polygon', 'survey-pattern', 'survey-settings', 'clear-polygon'];
    const returnActions = ['return-to-launch', 'land-here'];
    const centerActions = ['center-mission', 'center-vehicle', 'center-home'];

    // Route to appropriate handler
    if (fileActions.includes(action)) {
        this.handleFileActions(action);
    } else if (takeoffActions.includes(action)) {
        this.handleTakeoffActions(action);
    } else if (waypointActions.includes(action)) {
        this.handleWaypointActions(action);
    } else if (missionActions.includes(action)) {
        // Routes send-markers → sendMarkersToDrone() via plan-flight-mission-send.js
        this.handleMissionSendActions(action);
    } else if (polygonActions.includes(action)) {
        this.handlePolygonActions(action);
    } else if (returnActions.includes(action)) {
        this.handleReturnActions(action);
    } else if (centerActions.includes(action)) {
        this.handleCenterActions(action);
    } else {
        console.log(`⚠️ Action not implemented: ${action}`);
        if (window.MsgConsole) {
            window.MsgConsole.warning(`Action not yet implemented: ${action.replace(/-/g, ' ')}`);
        }
    }
};

console.log('✅ Plan Flight Menu Action Router Loaded');