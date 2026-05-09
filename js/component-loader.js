/**
 * Component Loader
 * Dynamically loads HTML components into designated containers
 */

(function() {
    'use strict';

    const components = [
        { id: 'header-component', file: 'components/header.html' },
        { id: 'flight-controls-component', file: 'components/flight-controls.html' },
        { id: 'dropdown-menu-component', file: 'components/dropdown-menu.html' },
        { id: 'plan-flight-menu-component', file: 'components/plan-flight-menu.html' },
        { id: 'command-editor-component', file: 'components/command-editor.html' },
        { id: 'message-console-component', file: 'components/message-console.html' },
        { id: 'weather-dashboard-component', file: 'components/weather-dashboard.html' },
        { id: 'takeoff-modal-component', file: 'components/takeoff-modal.html' },
        { id: 'hud-display-component', file: 'components/hud-display.html' }
    ];

    /**
     * Load a single component
     */
    async function loadComponent(component) {
        try {
            const response = await fetch(component.file);
            if (!response.ok) {
                throw new Error(`Failed to load ${component.file}`);
            }
            const html = await response.text();
            const container = document.getElementById(component.id);
            if (container) {
                container.innerHTML = html;
            }
        } catch (error) {
            console.error(`Error loading component ${component.id}:`, error);
        }
    }

    /**
     * Load all components
     */
    async function loadAllComponents() {
        const loadPromises = components.map(component => loadComponent(component));
        await Promise.all(loadPromises);
        
        // Dispatch custom event when all components are loaded
        window.dispatchEvent(new Event('componentsLoaded'));
        console.log('All components loaded successfully');
    }

    // Load components when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAllComponents);
    } else {
        loadAllComponents();
    }
})();