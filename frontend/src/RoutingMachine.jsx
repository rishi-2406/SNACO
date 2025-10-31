// Routing control wrapper with custom red markers
import L from 'leaflet';
import { createControlComponent } from '@react-leaflet/core';
import 'leaflet-routing-machine';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';

const createRoutineMachineLayer = ({ waypoints, mode = 'walk', onRouteClear }) => {
  // Red map pin for route waypoints (singleton)
  const redPinIcon = (createRoutineMachineLayer._icon ||= L.icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl:
      'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }));

  // Configure routing based on mode
  const getRouterOptions = () => {
    const baseUrl = 'https://router.project-osrm.org/route/v1';
    
    switch (mode) {
      case 'car':
        return {
          serviceUrl: baseUrl,
          profile: 'driving',
          timeout: 5000,
        };
      case 'cycle':
        return {
          serviceUrl: baseUrl,
          profile: 'cycling',
          timeout: 5000,
        };
      case 'walk':
      default:
        return {
          serviceUrl: baseUrl,
          profile: 'foot',
          timeout: 5000,
        };
    }
  };

  // Get route color based on mode
  const getRouteColor = () => {
    switch (mode) {
      case 'car':
        return '#f97316'; // Orange
      case 'cycle':
        return '#3b82f6'; // Blue
      case 'walk':
      default:
        return '#14b8a6'; // Teal
    }
  };

  const routerOptions = getRouterOptions();
  const routeColor = getRouteColor();

  const instance = L.Routing.control({
    waypoints: waypoints.map(({ latitude, longitude }) =>
      L.latLng(latitude, longitude)
    ),
    router: L.Routing.osrmv1(routerOptions),
    draggableWaypoints: false,
    addWaypoints: false,
    routeWhileDragging: false,
    showAlternatives: false,
    lineOptions: {
      styles: [
        {
          color: routeColor,
          opacity: 0.8,
          weight: 6,
        },
      ],
    },
    createMarker: (i, wp) =>
      L.marker(wp.latLng, {
        icon: redPinIcon,
      }),
  });

  // Add close button to routing directions panel after it's created
  instance.on('routesfound', function(e) {
    // Wait for DOM to update, then add close button
    setTimeout(() => {
      const altPanel = document.querySelector('.leaflet-routing-alt');
      if (altPanel && !altPanel.querySelector('.routing-close-btn')) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'routing-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
          position: absolute;
          top: 8px;
          right: 8px;
          width: 24px;
          height: 24px;
          border: none;
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
          cursor: pointer;
          font-size: 20px;
          line-height: 1;
          color: #333;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          transition: background 0.2s;
        `;
        closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(0, 0, 0, 0.2)'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(0, 0, 0, 0.1)'; };
        closeBtn.onclick = () => {
          // Clear the route completely
          if (instance) {
            instance.getPlan().setWaypoints([]);
            instance.spliceWaypoints(0, instance.getWaypoints().length);
          }
          // Hide the panel
          if (altPanel) {
            altPanel.style.display = 'none';
          }
          // Call the onRouteClear callback if provided
          if (onRouteClear) {
            onRouteClear();
          }
        };
        
        // Make the panel position relative if it isn't already
        const computedStyle = window.getComputedStyle(altPanel);
        if (computedStyle.position === 'static') {
          altPanel.style.position = 'relative';
        }
        
        altPanel.appendChild(closeBtn);
      }
    }, 100);
  });

  return instance;
};

const RoutingMachine = createControlComponent(createRoutineMachineLayer);

export default RoutingMachine;