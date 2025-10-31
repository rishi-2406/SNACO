// src/App.js
import "./App.css";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  ZoomControl,
  GeoJSON,
  FeatureGroup,
  useMapEvents,
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css";
import "leaflet-defaulticon-compatibility";
import "leaflet-draw/dist/leaflet.draw.css";
import L from "leaflet";

import PathFinder, { pathToGeoJSON } from "geojson-path-finder"; // default import

// Turf for precise snapping/splitting at mid-segment
import {
  point as turfPoint,
  lineString as turfLine,
  nearestPointOnLine,
  lineSplit,
  booleanPointOnLine,
} from "@turf/turf";

// Base network (keep minimal sample or your real data)
const baseNetwork = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "existing-1" },
      geometry: {
        type: "LineString",
        coordinates: [
          [79.529, 17.983],
          [79.53, 17.984],
        ],
      },
    },
  ],
};

const nitWarangalBounds = [
  [17.978217, 79.526662],
  [17.989356, 79.534066],
];

const makeIcon = (url) =>
  L.icon({
    iconUrl: url,
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

const redPinIcon = makeIcon(
  "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png"
);
const greenPinIcon = makeIcon(
  "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png"
);
const bluePinIcon = makeIcon(
  "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png"
);

// Extract unique vertices from a FeatureCollection of LineStrings
function extractVertices(geojson) {
  const set = new Set();
  const out = [];
  (geojson.features || []).forEach((f) => {
    if (f?.geometry?.type !== "LineString") return;
    (f.geometry.coordinates || []).forEach(([lng, lat]) => {
      const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
      if (!set.has(key)) {
        set.add(key);
        out.push([lng, lat]);
      }
    });
  });
  return out;
}

// Haversine distance (meters)
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

// Snap [lng,lat] to nearest vertex in list
function snapToNearestVertex(point, vertices) {
  let best = null;
  let bestD = Infinity;
  for (const v of vertices) {
    const d = haversine(point, v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return { snapped: best, distance: bestD };
}

// Insert a coordinate as a vertex by splitting the nearest LineString (≤ maxSnapMeters)
// Returns { network, vertex } where vertex is the exact [lng,lat] inserted/used
function injectVertexIntoNetwork(network, coord, maxSnapMeters = 25) {
  const p = turfPoint(coord);
  let best = { dist: Infinity, idx: -1, snapped: null };
  const lines = [];

  (network.features || []).forEach((f, i) => {
    if (f?.geometry?.type !== "LineString") return;
    const snapped = nearestPointOnLine(turfLine(f.geometry.coordinates), p, {
      units: "meters",
    });
    const dist = snapped.properties.dist || 0;
    if (dist < best.dist) best = { dist, idx: i, snapped };
  });

  if (best.idx === -1 || best.dist > maxSnapMeters) {
    // too far from the network; return as-is
    return { network, vertex: null };
  }

  const original = network.features[best.idx];
  const snappedCoord = best.snapped.geometry.coordinates;

  // If point already sits exactly on a vertex, no split required
  const isOnVertex = original.geometry.coordinates.some(
    ([lng, lat]) =>
      Math.abs(lng - snappedCoord[0]) < 1e-12 &&
      Math.abs(lat - snappedCoord[1]) < 1e-12
  );
  if (isOnVertex) {
    return { network, vertex: snappedCoord };
  }

  // Ensure the point lies on the line for splitting
  const onLine = booleanPointOnLine(
    turfPoint(snappedCoord),
    turfLine(original.geometry.coordinates),
    { ignoreEndVertices: false }
  );
  if (!onLine) {
    // Fallback: no safe split
    return { network, vertex: null };
  }

  // Split the line at the snapped point
  const split = lineSplit(
    turfLine(original.geometry.coordinates),
    turfPoint(snappedCoord)
  );
  const parts = split.features.filter((f) => f.geometry?.type === "LineString");

  // Replace original with parts (keep properties)
  const newFeatures = network.features.slice();
  newFeatures.splice(
    best.idx,
    1,
    ...parts.map((ls) => ({
      type: "Feature",
      properties: { ...(original.properties || {}) },
      geometry: { type: "LineString", coordinates: ls.geometry.coordinates },
    }))
  );

  return {
    network: { type: "FeatureCollection", features: newFeatures },
    vertex: snappedCoord,
  };
}

// Component to capture map clicks and set start/end by snapping to network vertices
function ClickCapture({ mode, onSetPoint, vertices, bounds }) {
  useMapEvents({
    click(e) {
      if (!mode) return;
      const ll = e.latlng;
      const within = L.latLngBounds(bounds).contains(ll);
      if (!within) return;

      const candidate = [ll.lng, ll.lat];
      const { snapped, distance } = snapToNearestVertex(
        candidate,
        vertices || []
      );
      if (!snapped) return;
      onSetPoint({
        raw: [ll.lng, ll.lat],
        snapped,
        snapDistanceM: distance,
        at: Date.now(),
        mode,
      });
    },
  });
  return null;
}

function App() {
  const [drawnGeoJSON, setDrawnGeoJSON] = useState({
    type: "FeatureCollection",
    features: [],
  });
  const [networkGeoJSON, setNetworkGeoJSON] = useState(baseNetwork);
  const [startPt, setStartPt] = useState(null);
  const [endPt, setEndPt] = useState(null);
  const [routeGeoJson, setRouteGeoJson] = useState(null);
  const [selectMode, setSelectMode] = useState(null);

  const featureGroupRef = useRef(null);
  const campusBounds = useMemo(() => L.latLngBounds(nitWarangalBounds), []);
  const center = useMemo(() => [17.983787, 79.530364], []);

  // Merge base + drawn
  const combinedNetwork = useMemo(() => {
    const drawnLines = (drawnGeoJSON.features || []).filter(
      (f) => f?.geometry?.type === "LineString"
    );
    return {
      type: "FeatureCollection",
      features: [...(baseNetwork.features || []), ...drawnLines],
    };
  }, [drawnGeoJSON]);

  useEffect(() => {
    setNetworkGeoJSON(combinedNetwork);
  }, [combinedNetwork]);

  // Build PathFinder with small degree tolerance (~5-6 m)
  const pathFinderBase = useMemo(() => {
    try {
      return new PathFinder(networkGeoJSON, { tolerance: 0.00005 }); // ~5.5 m
    } catch (e) {
      console.error("PathFinder init failed", e);
      return null;
    }
  }, [networkGeoJSON]);

  const vertices = useMemo(
    () => extractVertices(networkGeoJSON),
    [networkGeoJSON]
  );

  // Sync drawn edits
  const syncDrawn = useCallback(() => {
    const fg = featureGroupRef.current;
    if (!fg) return;
    const gj = fg.toGeoJSON();
    const lines = (gj.features || []).filter(
      (f) => f?.geometry?.type === "LineString"
    );
    setDrawnGeoJSON({ type: "FeatureCollection", features: lines });
  }, []);

  const onCreated = useCallback(() => syncDrawn(), [syncDrawn]);
  const onEdited = useCallback(() => syncDrawn(), [syncDrawn]);
  const onDeleted = useCallback(() => syncDrawn(), [syncDrawn]);

  // Compare [lng,lat] within a small epsilon
  function sameCoord(a, b, eps = 1e-8) {
    return a && b && Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
  }

  // Remove consecutive duplicate coordinates
  function dedupeConsecutive(coords) {
    const out = [];
    for (let i = 0; i < coords.length; i++) {
      if (i === 0 || !sameCoord(coords[i], coords[i - 1])) out.push(coords[i]);
    }
    return out;
  }

  // Safe converter: builds a Feature without throwing on short paths
  function toLineFeature(result) {
    if (!result || !Array.isArray(result.path)) return null;
    const coords = dedupeConsecutive(result.path);
    if (coords.length < 2) return null; // not a valid LineString
    return {
      type: "Feature",
      properties: { weight: result.weight },
      geometry: { type: "LineString", coordinates: coords },
    };
  }

  // Compute route: ensure start/end are vertices by injecting them if needed
  const computeRoute = useCallback(() => {
    setRouteGeoJson(null);
    if (!startPt?.snapped || !endPt?.snapped) return;

    // If start and end are effectively the same vertex, skip
    if (sameCoord(startPt.snapped, endPt.snapped)) {
      alert("Start and End are the same point — no route to draw.");
      return;
    }

    // Ensure endpoints are vertices by injecting (as in your current code)...
    let working = networkGeoJSON;
    const insStart = injectVertexIntoNetwork(working, startPt.snapped, 25);
    working = insStart.network;
    const startCoord = insStart.vertex || startPt.snapped;

    const insEnd = injectVertexIntoNetwork(working, endPt.snapped, 25);
    working = insEnd.network;
    const endCoord = insEnd.vertex || endPt.snapped;

    let pf;
    try {
      pf = new PathFinder(working, { tolerance: 0.00005 });
    } catch {
      alert("Routing network build failed");
      return;
    }

    const start = {
      type: "Feature",
      geometry: { type: "Point", coordinates: startCoord },
    };
    const end = {
      type: "Feature",
      geometry: { type: "Point", coordinates: endCoord },
    };
    const result = pf.findPath(start, end);

    // Guard before pathToGeoJSON to avoid the LineString error
    const feature = toLineFeature(result);
    if (!feature) {
      alert(
        "Route is too short or invalid (fewer than 2 points). Adjust points or add connecting lines."
      );
      return;
    }

    // If you prefer, you can still use pathToGeoJSON when safe:
    // const gj = pathToGeoJSON(result); // only if feature would be non-null

    setRouteGeoJson(feature);
  }, [networkGeoJSON, startPt, endPt]);

  // Clear the rendered route and selection state
  const clearRoute = useCallback(() => {
    setRouteGeoJson(null);
    setStartPt(null);
    setEndPt(null);
    setSelectMode(null);
  }, []);

  // Export currently drawn polylines as GeoJSON
  const exportDrawn = useCallback(() => {
    const data = drawnGeoJSON;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campus-paths.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }, [drawnGeoJSON]);

  return (
    <div className="App">
      <nav className="fixed top-0 left-0 right-0 z-[1000] backdrop-blur bg-white/70 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between">
          <div className="font-semibold text-slate-800">SNACO</div>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-md px-3 py-1.5 text-sm ${
                selectMode === "start"
                  ? "bg-green-600 text-white"
                  : "bg-white border border-slate-300 text-slate-800"
              }`}
              onClick={() =>
                setSelectMode((m) => (m === "start" ? null : "start"))
              }
            >
              Set Start
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm ${
                selectMode === "end"
                  ? "bg-red-600 text-white"
                  : "bg-white border border-slate-300 text-slate-800"
              }`}
              onClick={() => setSelectMode((m) => (m === "end" ? null : "end"))}
            >
              Set End
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-sm bg-teal-500 text-white hover:bg-teal-600"
              onClick={computeRoute}
            >
              Compute Route
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-800"
              onClick={clearRoute}
            >
              Clear Route
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-800"
              onClick={exportDrawn}
            >
              Export GeoJSON
            </button>
          </div>
        </div>
      </nav>

      <div className="fixed top-14 right-4 z-[900] w-[min(90vw,360px)] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md space-y-2">
        <div className="text-xs text-slate-600">
          Draw polylines to add campus paths, then set Start/End by clicking;
          routing injects those points into the network if they fall
          mid‑segment.
        </div>
        <div className="text-xs">
          <div>
            Start:{" "}
            {startPt?.snapped
              ? `${startPt.snapped[1].toFixed(6)}, ${startPt.snapped[0].toFixed(
                  6
                )} (snap ${Math.round(startPt.snapDistanceM)} m)`
              : "—"}
          </div>
          <div>
            End:{" "}
            {endPt?.snapped
              ? `${endPt.snapped[1].toFixed(6)}, ${endPt.snapped[0].toFixed(
                  6
                )} (snap ${Math.round(endPt.snapDistanceM)} m)`
              : "—"}
          </div>
        </div>
      </div>

      <MapContainer
        center={[17.983787, 79.530364]}
        id="mapId"
        zoom={17}
        minZoom={16}
        maxBounds={nitWarangalBounds}
        maxBoundsViscosity={1.0}
        zoomControl={false}
        scrollWheelZoom
        style={{ height: "100vh" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ZoomControl position="topright" />

        <FeatureGroup ref={featureGroupRef}>
          <EditControl
            position="topleft"
            onCreated={onCreated}
            onEdited={onEdited}
            onDeleted={onDeleted}
            draw={{
              polyline: { shapeOptions: { color: "#2563eb", weight: 4 } },
              polygon: false,
              rectangle: false,
              circle: false,
              circlemarker: false,
              marker: false,
            }}
            edit={{
              remove: true,
              selectedPathOptions: { maintainColor: true, opacity: 0.3 },
            }}
          />
        </FeatureGroup>

        <GeoJSON
          data={baseNetwork}
          style={{ color: "#64748b", weight: 2, dashArray: "4 4" }}
        />

        {routeGeoJson && (
          <GeoJSON data={routeGeoJson} style={{ color: "green", weight: 5 }} />
        )}

        {startPt?.snapped && (
          <Marker
            position={[startPt.snapped[1], startPt.snapped[0]]}
            icon={greenPinIcon}
          >
            <Popup>Start</Popup>
          </Marker>
        )}
        {endPt?.snapped && (
          <Marker
            position={[endPt.snapped[1], endPt.snapped[0]]}
            icon={redPinIcon}
          >
            <Popup>End</Popup>
          </Marker>
        )}

        {startPt?.raw && (
          <Marker
            position={[startPt.raw[1], startPt.raw[0]]}
            icon={bluePinIcon}
          >
            <Popup>Clicked (pre-snap)</Popup>
          </Marker>
        )}
        {endPt?.raw && (
          <Marker position={[endPt.raw[1], endPt.raw[0]]} icon={bluePinIcon}>
            <Popup>Clicked (pre-snap)</Popup>
          </Marker>
        )}

        <ClickCapture
          mode={selectMode}
          vertices={vertices}
          bounds={nitWarangalBounds}
          onSetPoint={(p) => {
            if (p.mode === "start") setStartPt(p);
            if (p.mode === "end") setEndPt(p);
            setSelectMode(null);
          }}
        />
      </MapContainer>
    </div>
  );
}

export default App;
