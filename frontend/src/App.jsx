// src/App.js

import './App.css';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faLocationDot, 
  faRoute, 
  faBookmark,
  faMapMarkerAlt,
  faChevronDown,
  faQuestionCircle,
  faCar,
  faBicycle,
  faWalking,
  faTimes,
  faBars,
  faDirections,
  faArrowRight
} from '@fortawesome/free-solid-svg-icons';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-defaulticon-compatibility';

import RoutingMachine from './RoutingMachine';
import Weather from './Weather';

function App() {
  const [locationMarkers, setLocationMarkers] = useState([]);
  const [waypoints, setWaypoints] = useState();
  const [routingMode, setRoutingMode] = useState('walk'); // 'car', 'cycle', 'walk'
  const [showRoutingForm, setFormView] = useState(false);
  const [showHelpDropdown, setShowHelpDropdown] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showPOI, setShowPOI] = useState(false);
  const [showRouteDirections, setShowRouteDirections] = useState(true);
  const [selectedPOI, setSelectedPOI] = useState(null); // Only one POI can be selected at a time
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const helpDropdownRef = useRef(null);

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

    const formData = new FormData(event.target);
    const locations = formData.getAll('location');
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({ locations, mode: routingMode }),
    });
    if (!res.ok) {
      const err = await res.text();
      alert(`Something went wrong.\n${err}`);
    } else {
      const data = await res.json();
      // Verify waypoints are inside campus bounds
      const allInside = (data.waypoints || []).every((wp) =>
        campusBounds.contains(L.latLng(wp.latitude, wp.longitude))
      );
      if (!allInside) {
        alert('One or more waypoints are out of campus');
        return;
      }
      setWaypoints({ waypoints: data.waypoints, mode: routingMode });
    }
  }, [campusBounds, routingMode]);

  // Close help dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (helpDropdownRef.current && !helpDropdownRef.current.contains(event.target)) {
        setShowHelpDropdown(false);
      }
    }

    if (showHelpDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHelpDropdown]);

  return (
    <div className="App">
      <nav className="fixed top-0 left-0 right-0 z-[1000] backdrop-blur bg-white/70 shadow-sm">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 sm:py-2.5">
          {/* Desktop Layout */}
          <div className="hidden md:flex items-center gap-3">
            {/* SNACO Text */}
            <div className="font-semibold text-slate-800 text-lg mr-1 whitespace-nowrap">SNACO</div>
            {/* Weather (small) */}
            <div className="hidden sm:flex items-center">
              <Weather />
            </div>
            
            {/* Search Bar */}
            <form onSubmit={handleMarkerSubmit} className="flex-1 flex items-center gap-2 min-w-0">
              <input
                type="text"
                id="location"
                name="location"
                required
                placeholder="Enter location"
                className="flex-1 min-w-0 rounded-md border border-slate-300 bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
              />
              <button 
                type="submit" 
                className="inline-flex items-center justify-center rounded-md bg-teal-500 px-3 py-2 text-white hover:bg-teal-600 active:bg-teal-700 whitespace-nowrap"
                aria-label="Search location"
              >
                <FontAwesomeIcon icon={faLocationDot} />
                <span className="ml-2">Search</span>
              </button>
            </form>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
            {/* Routing Button */}
            <button
              aria-label="Toggle route form"
              className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                showRoutingForm 
                  ? "bg-teal-500 text-white" 
                  : "border border-slate-300 bg-white/80 text-slate-800 hover:bg-slate-100 active:bg-slate-200"
              }`}
              onClick={() => {
                const newValue = !showRoutingForm;
                setFormView(newValue);
                // Close other panels when opening this one
                if (newValue) {
                  setShowBookmarks(false);
                  setShowPOI(false);
                }
              }}
            >
              <FontAwesomeIcon icon={faRoute} className={showRoutingForm ? "text-white" : "text-teal-500"} />
              <span className="ml-2 hidden md:inline">Route</span>
            </button>

            {/* Bookmarks Button */}
            <button
              aria-label="Toggle bookmarks"
              className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                showBookmarks 
                  ? "bg-blue-500 text-white" 
                  : "border border-slate-300 bg-white/80 text-slate-800 hover:bg-slate-100 active:bg-slate-200"
              }`}
              onClick={() => {
                const newValue = !showBookmarks;
                setShowBookmarks(newValue);
                // Close other panels when opening this one
                if (newValue) {
                  setFormView(false);
                  setShowPOI(false);
                }
              }}
            >
              <FontAwesomeIcon icon={faBookmark} className={showBookmarks ? "text-white" : "text-blue-500"} />
              <span className="ml-2 hidden md:inline">Bookmarks</span>
            </button>

            {/* Point of Interest Button */}
            <button
              aria-label="Toggle points of interest"
              className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                showPOI 
                  ? "bg-purple-500 text-white" 
                  : "border border-slate-300 bg-white/80 text-slate-800 hover:bg-slate-100 active:bg-slate-200"
              }`}
              onClick={() => {
                const newValue = !showPOI;
                setShowPOI(newValue);
                // Close other panels when opening this one
                if (newValue) {
                  setFormView(false);
                  setShowBookmarks(false);
                }
              }}
            >
              <FontAwesomeIcon icon={faMapMarkerAlt} className={showPOI ? "text-white" : "text-purple-500"} />
              <span className="ml-2 hidden md:inline">POI</span>
            </button>

            {/* Help Dropdown */}
            <div className="relative" ref={helpDropdownRef}>
              <button
                aria-label="Help menu"
                className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  showHelpDropdown 
                    ? "bg-slate-500 text-white" 
                    : "border border-slate-300 bg-white/80 text-slate-800 hover:bg-slate-100 active:bg-slate-200"
                }`}
                onClick={() => {
                  const newValue = !showHelpDropdown;
                  setShowHelpDropdown(newValue);
                  // Close other panels when opening help
                  if (newValue) {
                    setFormView(false);
                    setShowBookmarks(false);
                    setShowPOI(false);
                  }
                }}
              >
                <FontAwesomeIcon icon={faQuestionCircle} className={showHelpDropdown ? "text-white" : "text-slate-600"} />
                <span className="ml-2 hidden md:inline">Help</span>
                <FontAwesomeIcon 
                  icon={faChevronDown} 
                  className={`ml-2 text-xs transition-transform ${showHelpDropdown ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Dropdown Menu */}
              {showHelpDropdown && (
                <div className="absolute right-0 mt-2 w-48 rounded-md border border-slate-200 bg-white shadow-lg z-50">
                  <div className="py-1">
                    <button
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                      onClick={() => {
                        setShowHelpDropdown(false);
                        alert('About Us\n\nSNACO is a campus navigation system for NIT Warangal. Find locations, plan routes, and explore points of interest across the campus.');
                      }}
                    >
                      About Us
                    </button>
                    <button
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                      onClick={() => {
                        setShowHelpDropdown(false);
                        alert('Contact Us\n\nEmail: support@snaco.edu\nPhone: +91 XXX XXX XXXX\nAddress: NIT Warangal, Warangal, Telangana');
                      }}
                    >
                      Contact Us
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
        
        {/* Mobile Layout */}
        <div className="md:hidden">
          {/* Mobile Top Row */}
          <div className="flex items-center gap-2 px-3 pb-2">
            {/* SNACO Text */}
            <div className="font-semibold text-slate-800 text-base whitespace-nowrap">SNACO</div>
            <div className="ml-2">
              <Weather />
            </div>
            
            {/* Search Bar */}
            <form onSubmit={handleMarkerSubmit} className="flex-1 flex items-center gap-2 min-w-0">
              <input
                type="text"
                id="location-mobile"
                name="location"
                required
                placeholder="Search location"
                className="flex-1 min-w-0 rounded-md border border-slate-300 bg-white/80 px-2 py-1.5 text-xs sm:text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
              />
              <button 
                type="submit" 
                className="inline-flex items-center justify-center rounded-md bg-teal-500 px-2.5 py-1.5 text-white hover:bg-teal-600 active:bg-teal-700"
                aria-label="Search location"
              >
                <FontAwesomeIcon icon={faLocationDot} className="text-sm" />
              </button>
            </form>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-md border border-slate-300 bg-white/80 text-slate-800 hover:bg-slate-100"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
              ) : (
                <FontAwesomeIcon icon={faBars} className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Mobile Menu Dropdown */}
          {mobileMenuOpen && (
            <div className="border-t border-slate-200 bg-white/95 backdrop-blur px-3 py-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    showRoutingForm 
                      ? "bg-teal-500 text-white" 
                      : "border border-slate-300 bg-white text-slate-800"
                  }`}
                  onClick={() => {
                    setFormView(!showRoutingForm);
                    setMobileMenuOpen(false);
                    if (!showRoutingForm) {
                      setShowBookmarks(false);
                      setShowPOI(false);
                    }
                  }}
                >
                  <FontAwesomeIcon icon={faRoute} />
                  <span>Route</span>
                </button>
                <button
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    showBookmarks 
                      ? "bg-blue-500 text-white" 
                      : "border border-slate-300 bg-white text-slate-800"
                  }`}
                  onClick={() => {
                    setShowBookmarks(!showBookmarks);
                    setMobileMenuOpen(false);
                    if (!showBookmarks) {
                      setFormView(false);
                      setShowPOI(false);
                    }
                  }}
                >
                  <FontAwesomeIcon icon={faBookmark} />
                  <span>Bookmarks</span>
                </button>
                <button
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    showPOI 
                      ? "bg-purple-500 text-white" 
                      : "border border-slate-300 bg-white text-slate-800"
                  }`}
                  onClick={() => {
                    setShowPOI(!showPOI);
                    setMobileMenuOpen(false);
                    if (!showPOI) {
                      setFormView(false);
                      setShowBookmarks(false);
                    }
                  }}
                >
                  <FontAwesomeIcon icon={faMapMarkerAlt} />
                  <span>POI</span>
                </button>
                <button
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    showHelpDropdown 
                      ? "bg-slate-500 text-white" 
                      : "border border-slate-300 bg-white text-slate-800"
                  }`}
                  onClick={() => {
                    setShowHelpDropdown(!showHelpDropdown);
                    if (!showHelpDropdown) {
                      setFormView(false);
                      setShowBookmarks(false);
                      setShowPOI(false);
                    }
                  }}
                >
                  <FontAwesomeIcon icon={faQuestionCircle} />
                  <span>Help</span>
                </button>
              </div>
              
              {/* Mobile Help Dropdown */}
              {showHelpDropdown && (
                <div className="mt-2 rounded-md border border-slate-200 bg-white shadow-md">
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      setShowHelpDropdown(false);
                      setMobileMenuOpen(false);
                      alert('About Us\n\nSNACO is a campus navigation system for NIT Warangal. Find locations, plan routes, and explore points of interest across the campus.');
                    }}
                  >
                    About Us
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 border-t border-slate-200"
                    onClick={() => {
                      setShowHelpDropdown(false);
                      setMobileMenuOpen(false);
                      alert('Contact Us\n\nEmail: support@snaco.edu\nPhone: +91 XXX XXX XXXX\nAddress: NIT Warangal, Warangal, Telangana');
                    }}
                  >
                    Contact Us
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
      {showRoutingForm && (
        <div className={`fixed ${mobileMenuOpen ? 'top-32' : 'top-14'} sm:top-14 right-2 sm:right-4 z-[900] w-[calc(100vw-1rem)] sm:w-[min(90vw,420px)] rounded-lg border border-slate-200 bg-white/95 shadow-md`}>
          {/* Header with close button */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">Plan Your Route</h3>
            <button
              type="button"
              onClick={() => setFormView(false)}
              className="p-1 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close route form"
            >
              <FontAwesomeIcon icon={faTimes} className="text-sm" />
            </button>
          </div>
          
          <form onSubmit={handleRouteSubmit} className="p-3 space-y-3">
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
            
            {/* Vehicle Mode Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">Transport Mode</label>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setRoutingMode('walk')}
                  className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-md border-2 transition-all ${
                    routingMode === 'walk'
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                  aria-label="Walking mode"
                >
                  <FontAwesomeIcon icon={faWalking} className="text-lg" />
                  <span className="text-xs font-medium">Walk</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRoutingMode('cycle')}
                  className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-md border-2 transition-all ${
                    routingMode === 'cycle'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                  aria-label="Cycling mode"
                >
                  <FontAwesomeIcon icon={faBicycle} className="text-lg" />
                  <span className="text-xs font-medium">Cycle</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRoutingMode('car')}
                  className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-md border-2 transition-all ${
                    routingMode === 'car'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                  aria-label="Car mode"
                >
                  <FontAwesomeIcon icon={faCar} className="text-lg" />
                  <span className="text-xs font-medium">Car</span>
                </button>
              </div>
            </div>
            
            <button className="w-full rounded-md bg-teal-500 py-2 text-white hover:bg-teal-600 active:bg-teal-700 font-medium">
              Find Path
            </button>
          </form>
        </div>
      )}
      
      {/* POI Panel */}
      {showPOI && (
        <div className={`fixed ${mobileMenuOpen ? 'top-32' : 'top-14'} sm:top-14 right-2 sm:right-4 z-[900] w-[calc(100vw-1rem)] sm:w-[min(90vw,320px)] rounded-lg border border-slate-200 bg-white/95 shadow-md`}>
          {/* Header with close button */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">Points of Interest</h3>
            <button
              type="button"
              onClick={() => setShowPOI(false)}
              className="p-1 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close POI panel"
            >
              <FontAwesomeIcon icon={faTimes} className="text-sm" />
            </button>
          </div>
          
          {/* Checkbox list */}
          <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
            {[
              { key: 'drinking-water', label: 'Drinking Water' },
              { key: 'toilets', label: 'Toilets' },
              { key: 'parking', label: 'Parking' },
              { key: 'mess', label: 'Mess' },
              { key: 'shops', label: 'Shops' },
              { key: 'sports-ground', label: 'Sports Ground' },
              { key: 'gym', label: 'Gym' },
            ].map((poi) => (
              <label
                key={poi.key}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedPOI === poi.key}
                  onChange={(e) => {
                    // If clicking the same checkbox that's already checked, uncheck it
                    // Otherwise, set this as the only selected POI
                    if (selectedPOI === poi.key && e.target.checked) {
                      setSelectedPOI(null);
                    } else if (e.target.checked) {
                      setSelectedPOI(poi.key);
                    }
                  }}
                  className="w-4 h-4 text-purple-600 border-slate-300 rounded focus:ring-purple-500 focus:ring-2"
                />
                <span className="text-sm text-slate-700 flex-1">{poi.label}</span>
              </label>
            ))}
          </div>
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
        <TileLayer
          url="https://tile.tracestrack.com/_/{z}/{x}/{y}.webp?key=cd132615983781e6126b4253d3b8712b"
          attribution='&copy; <a href="https://tracestrack.com/">TraceTrack</a>'
        />
        <ZoomControl position="topright" />
        {waypoints ? (
          <RoutingMachine 
            waypoints={waypoints.waypoints || waypoints} 
            mode={waypoints.mode || routingMode}
            onRouteClear={() => setWaypoints(null)}
          />
        ) : ''}
      </MapContainer>
    </div>
  );
}

export default App;