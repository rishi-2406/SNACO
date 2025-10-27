// src/App.js

import './App.css';
import { useState, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationDot, faRoute } from '@fortawesome/free-solid-svg-icons';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-defaulticon-compatibility';
import { Polyline } from 'react-leaflet';


import RoutingMachine from './RoutingMachine';

function App() {
  const [locationMarkers, setLocationMarkers] = useState([]);
  const [waypoints, setWaypoints] = useState();
  const [showRoutingForm, setFormView] = useState(false);
  const [route, setRoute] = useState([]);


  // Campus bounds (southWest, northEast)
  const nitWarangalBounds = useMemo(() => (
    [
      [17.978217, 79.526662],
      [17.989356, 79.534066],
    ]
  ), []);

  // LatLngBounds instance for fast containment checks
  const campusBounds = useMemo(() => L.latLngBounds(nitWarangalBounds), [nitWarangalBounds]);

  // Red map pin icon (memoized)
  const redPinIcon = useMemo(() => L.icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl:
      'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }), []);

  // Handle single-location search
  const handleMarkerSubmit = useCallback(async (event) => {
    event.preventDefault();
    //console.log("checking");
    const formData = new FormData(event.target);
    const inputLocation = formData.get('location');
    
    const res = await fetch(
      '/api/geocode?' +
        new URLSearchParams({ location: inputLocation }).toString()
    );
    if (!res.ok) {
      const err = await res.text();
      alert(`Something went wrong.\n${err}`);
    } else {
      const data = await res.json();
      let newLocation = {
        address: data.location,
        lat: data.coordinates.latitude,
        long: data.coordinates.longitude,
      };
      // Only allow markers inside campus bounds
      const isInside = campusBounds.contains(L.latLng(newLocation.lat, newLocation.long));
      if (!isInside) {
        alert('Location is out of campus');
        return;
      }
      setLocationMarkers(() => [newLocation]);
    }
  }, [campusBounds]);

  // Handle route between two inputs
  const handleRouteSubmit = useCallback(async (event) => {
    event.preventDefault();
    // Reset previous waypoints
    setWaypoints();
    // Hide the form
    setFormView(false);
    // Clear any single search marker while routing between two points
    setLocationMarkers([]);
    //console.log("checking");
    const formData = new FormData(event.target);
    const locations = formData.getAll('location');
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({ locations }),
    });
    //console.log("checking");
    if (!res.ok) {
      const err = await res.text();
      alert(`Something went wrong.\n${err}`);
    } else {
      const data = await res.json();
      //console.log("Route data:", data);
      // Draw route polyline on map
      //const map = document.getElementById('mapId')._leaflet_map;
     if (data.waypoints) {
      setRoute(data.waypoints.map(wp => [wp.lat, wp.lon]));
      setWaypoints(data.waypoints); // optional
    }

      // Verify waypoints are inside campus bounds
      const allInside = (data.waypoints || []).every((wp) =>
        campusBounds.contains(L.latLng(wp.lat, wp.lon))
      );
      if (!allInside) {
        alert('One or more waypoints are out of campus');
        return;
      }
      //setWaypoints(data.waypoints);
    }
  }, [campusBounds]);

  return (
    <div className="App">
      <nav className="fixed top-0 left-0 right-0 z-[1000] backdrop-blur bg-white/70 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-3">
          <div className="font-semibold text-slate-800 mr-2">SNACO</div>
          <form onSubmit={handleMarkerSubmit} className="flex-1 flex items-center gap-2">
            <input
              type="text"
              id="location"
              name="location"
              required
              placeholder="Enter location"
              className="w-full rounded-md border border-slate-300 bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
            />
            <button type="submit" className="inline-flex items-center justify-center rounded-md bg-teal-500 px-3 py-2 text-white hover:bg-teal-600 active:bg-teal-700">
              <FontAwesomeIcon icon={faLocationDot} />
            </button>
          </form>
          <button
            aria-label="Toggle route form"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white/80 px-3 py-2 text-slate-800 hover:bg-slate-100 active:bg-slate-200"
            onClick={() => {
              setFormView((showRoutingForm) => !showRoutingForm);
            }}
          >
            <FontAwesomeIcon icon={faRoute} className="text-teal-500" />
          </button>
        </div>
      </nav>
      {showRoutingForm && (
        <div className="fixed top-14 right-4 z-[900] w-[min(90vw,420px)] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md">
          <form onSubmit={handleRouteSubmit} className="space-y-2">
            <input
              type="text"
              name="location"
              required
              placeholder="Starting point"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
            />
            <input
              type="text"
              name="location"
              required
              placeholder="End point"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
            />
            <button className="w-full rounded-md bg-teal-500 py-2 text-white hover:bg-teal-600 active:bg-teal-700">Find Path</button>
          </form>
        </div>
      )}
      <MapContainer
        center={[17.983787, 79.530364]}
        id="mapId"
        zoom={17}
        minZoom={16}
        zoomSnap={1}
        zoomDelta={1}
        zoomAnimation={true}
        zoomAnimationThreshold={4}
        scrollWheelZoom={true}
        wheelDebounceTime={20}
        wheelPxPerZoomLevel={80}
        maxBounds={nitWarangalBounds}
        maxBoundsViscosity={1.0}
        zoomControl={false}
      >
        {locationMarkers.map((loc, key) => {
          return (
            <Marker key={key} position={[loc.lat, loc.long]} icon={redPinIcon}>
              <Popup>{loc.address}</Popup>
            </Marker>
          );
        })}
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ZoomControl position="topright" />
        {/* {waypoints ? <RoutingMachine waypoints={waypoints} /> : ''} */}
        {route.length > 0 && (
          <Polyline positions={route} color="blue" weight={4} />
        )}

      </MapContainer>
    </div>
  );
}

export default App;