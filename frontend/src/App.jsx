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
import "leaflet-draw";
import L from "leaflet";

// Turf
import {
  point as turfPoint,
  lineString as turfLine,
  nearestPointOnLine,
  lineSplit,
  booleanPointOnLine,
} from "@turf/turf";

// Minimal base network
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

// Extract unique vertices from LineStrings
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
  let best = null, bestD = Infinity;
  for (const v of vertices) {
    const d = haversine(point, v);
    if (d < bestD) { bestD = d; best = v; }
  }
  return { snapped: best, distance: bestD };
}

// Insert a coordinate as a vertex by splitting the nearest LineString (≤ maxSnapMeters)
function injectVertexIntoNetwork(network, coord, maxSnapMeters = 25) {
  const p = turfPoint(coord);
  let best = { dist: Infinity, idx: -1, snapped: null };

  (network.features || []).forEach((f, i) => {
    if (f?.geometry?.type !== "LineString") return;
    const snapped = nearestPointOnLine(turfLine(f.geometry.coordinates), p, { units: "meters" });
    const dist = snapped.properties.dist || 0;
    if (dist < best.dist) best = { dist, idx: i, snapped };
  });

  if (best.idx === -1 || best.dist > maxSnapMeters) return { network, vertex: null };

  const original = network.features[best.idx];
  const snappedCoord = best.snapped.geometry.coordinates;

  // Already a vertex?
  const isOnVertex = original.geometry.coordinates.some(
    ([lng, lat]) => Math.abs(lng - snappedCoord[0]) < 1e-12 && Math.abs(lat - snappedCoord[1]) < 1e-12
  );
  if (isOnVertex) return { network, vertex: snappedCoord };

  // Ensure on line and split
  const onLine = booleanPointOnLine(turfPoint(snappedCoord), turfLine(original.geometry.coordinates), { ignoreEndVertices: false });
  if (!onLine) return { network, vertex: null };

  const split = lineSplit(turfLine(original.geometry.coordinates), turfPoint(snappedCoord));
  const parts = split.features.filter((f) => f.geometry?.type === "LineString");

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

  return { network: { type: "FeatureCollection", features: newFeatures }, vertex: snappedCoord };
}

// Nearest POI helper
function nearestPOI(point, poiList) {
  let best = null, bestD = Infinity;
  for (const p of poiList || []) {
    if (p.longitude == null || p.latitude == null) continue;
    const coord = [p.longitude, p.latitude];
    const d = haversine(point, coord);
    if (d < bestD) { bestD = d; best = { coord, poi: p }; }
  }
  return best ? { coord: best.coord, poi: best.poi, distance: bestD } : { coord: null, poi: null, distance: Infinity };
}

// Snap to nearest point on any line segment
function snapToLine(point, networkFc) {
  let best = { coord: null, distance: Infinity, featureIndex: -1 };
  const pt = turfPoint(point);
  (networkFc.features || []).forEach((f, i) => {
    if (!f || f.geometry?.type !== "LineString") return;
    const snapped = nearestPointOnLine(turfLine(f.geometry.coordinates), pt, { units: "meters" });
    const dist = snapped.properties?.dist ?? Infinity;
    if (dist < best.distance) best = { coord: snapped.geometry.coordinates, distance: dist, featureIndex: i };
  });
  return best;
}

// Composite snap: vertex | poi | line-projection
function compositeSnap(candidate, { vertices, poiList, networkFc }) {
  const { snapped: vtx, distance: dv } = snapToNearestVertex(candidate, vertices || []);
  const { coord: poiCoord, poi, distance: dp } = nearestPOI(candidate, poiList || []);
  const { coord: lineCoord, distance: dl } = snapToLine(candidate, networkFc || { features: [] });
  const POI_STRONG_PREF_METERS = 15;
  let bestCoord = vtx, bestType = "vertex", bestDist = dv, bestPoi = null;
  if (dp <= POI_STRONG_PREF_METERS) {
    bestCoord = poiCoord; bestType = "poi"; bestDist = dp; bestPoi = poi;
  } else {
    if (dp < bestDist) { bestCoord = poiCoord; bestType = "poi"; bestDist = dp; bestPoi = poi; }
    if (dl < bestDist) { bestCoord = lineCoord; bestType = "line"; bestDist = dl; bestPoi = null; }
  }
  return { coord: bestCoord, type: bestType, distance: bestDist, poi: bestPoi };
}

// Click capture
function ClickCapture({ mode, onSetPoint, vertices, bounds, poiList, networkFc }) {
  useMapEvents({
    click(e) {
      if (!mode) return;
      const ll = e.latlng;
      if (!L.latLngBounds(bounds).contains(ll)) return;

      const candidate = [ll.lng, ll.lat];
      const snap = compositeSnap(candidate, { vertices, poiList, networkFc });
      if (process.env.NODE_ENV !== "production") {
        console.log("[ClickCapture]", { candidate, snap });
      }
      if (!snap?.coord) return;

      onSetPoint({
        raw: candidate,
        snapped: snap.coord,
        snapDistanceM: Math.round(snap.distance),
        via: snap.type,
        poi: snap.poi || null,
        at: Date.now(),
        mode,
      });
    },
  });
  return null;
}

function App() {
  const [drawnGeoJSON, setDrawnGeoJSON] = useState({ type: "FeatureCollection", features: [] });
  const [networkGeoJSON, setNetworkGeoJSON] = useState(baseNetwork);
  const [startPt, setStartPt] = useState(null);
  const [endPt, setEndPt] = useState(null);
  const [routeGeoJson, setRouteGeoJson] = useState(null);
  const [selectMode, setSelectMode] = useState(null);

  // POIs: DB, OSM, and drawn
  const [poisDb, setPoisDb] = useState([]);
  const [poisOsm, setPoisOsm] = useState([]);
  const [poisDrawn, setPoisDrawn] = useState([]);
  const poisAll = useMemo(() => [...(poisDb || []), ...(poisOsm || []), ...(poisDrawn || [])], [poisDb, poisOsm, poisDrawn]);

  const featureGroupPathsRef = useRef(null);
  const featureGroupPoisRef = useRef(null);
  const selectModeRef = useRef(null);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

  const campusBounds = useMemo(() => L.latLngBounds(nitWarangalBounds), []);
  const center = useMemo(() => [17.983787, 79.530364], []);

  // Merge base + drawn paths
  const combinedNetwork = useMemo(() => {
    const drawnLines = (drawnGeoJSON.features || []).filter((f) => f?.geometry?.type === "LineString");
    return { type: "FeatureCollection", features: [...(baseNetwork.features || []), ...drawnLines] };
  }, [drawnGeoJSON]);

  useEffect(() => { setNetworkGeoJSON(combinedNetwork); }, [combinedNetwork]);

  // Load your POIs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/locations");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setPoisDb(Array.isArray(data) ? data : []);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Load OSM POIs via Overpass proxy
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/osm-pois");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setPoisOsm(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to load OSM POIs", e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const vertices = useMemo(() => extractVertices(networkGeoJSON), [networkGeoJSON]);

  // Sync drawn PATHS
  const syncDrawnPaths = useCallback(() => {
    const fg = featureGroupPathsRef.current;
    if (!fg) return;
    const gj = fg.toGeoJSON();
    const lines = (gj.features || []).filter((f) => f?.geometry?.type === "LineString");
    setDrawnGeoJSON({ type: "FeatureCollection", features: lines });
  }, []);
  const onCreatedPath = useCallback(() => syncDrawnPaths(), [syncDrawnPaths]);
  const onEditedPath = useCallback(() => syncDrawnPaths(), [syncDrawnPaths]);
  const onDeletedPath = useCallback(() => syncDrawnPaths(), [syncDrawnPaths]);

  // Sync drawn POIs (from marker group)
  const syncDrawnPoisFromGroup = useCallback(() => {
    const fg = featureGroupPoisRef.current;
    if (!fg) return;
    const gj = fg.toGeoJSON();
    const points = (gj.features || []).filter((f) => f?.geometry?.type === "Point");
    const list = points.map((f, i) => ({
      id: f.properties?.id || f.properties?._id || `drawn-${i}-${Date.now()}`,
      name: f.properties?.name || "Custom place",
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }));
    setPoisDrawn(list);
  }, []);

  const onCreatedPoi = useCallback((e) => {
    if (e.layerType !== "marker") return;
    const ll = e.layer.getLatLng();
    const lng = ll.lng, lat = ll.lat;
    const name = window.prompt("Place name?", "Custom place") || "Custom place";
    const id = `drawn-${Date.now()}`;
    // Persist properties so toGeoJSON keeps them
    e.layer.feature = e.layer.feature || { type: "Feature", properties: {} };
    e.layer.feature.properties.id = id;
    e.layer.feature.properties.name = name;

    // Click handler: set Start/End by clicking the drawn marker
    e.layer.on("click", () => {
      const modeToUse = selectModeRef.current || "start";
      const payload = {
        raw: [lng, lat],
        snapped: [lng, lat],
        snapDistanceM: 0,
        via: "poi",
        poi: { id, name, longitude: lng, latitude: lat },
        at: Date.now(),
        mode: modeToUse,
      };
      if (modeToUse === "start") setStartPt(payload);
      if (modeToUse === "end") setEndPt(payload);
      setSelectMode(null);
    });

    setPoisDrawn((prev) => [...prev, { id, name, longitude: lng, latitude: lat }]);
  }, []);

  const onEditedPoi = useCallback(() => { syncDrawnPoisFromGroup(); }, [syncDrawnPoisFromGroup]);
  const onDeletedPoi = useCallback(() => { syncDrawnPoisFromGroup(); }, [syncDrawnPoisFromGroup]);

  // Compare [lng,lat]
  function sameCoord(a, b, eps = 1e-8) {
    return a && b && Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
  }

  // Compute route (delegated to backend)
  const computeRoute = useCallback(() => {
    setRouteGeoJson(null);
    if (!startPt?.snapped || !endPt?.snapped) return;
    if (sameCoord(startPt.snapped, endPt.snapped)) {
      alert("Start and End are the same point — no route to draw.");
      return;
    }

    const poisPayload = (poisAll || []).map((p) => ({
      id: p._id || p.id || `${p.longitude}-${p.latitude}`,
      name: p.name || p.address || p._id || p.id || "Place",
      coordinates: [p.longitude, p.latitude],
    }));

    const prepareEndpoint = (pt) => {
      if (!pt) return null;
      if (pt.poi && (pt.poi._id || pt.poi.id)) return { placeId: pt.poi._id || pt.poi.id };
      // Ensure we send coordinates as an array
      const coords = pt.snapped || pt.raw;
      if (Array.isArray(coords) && coords.length === 2) return coords;
      return null;
    };

    (async () => {
      try {
        const body = {
          start: prepareEndpoint(startPt),
          end: prepareEndpoint(endPt),
          pois: poisPayload,
          network: networkGeoJSON,
        };
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Server returned ${res.status}`);
        }
        const data = await res.json();
        if (!data?.route) throw new Error("No route returned");
        setRouteGeoJson(data.route);
      } catch (e) {
        console.error("Routing failed", e);
        alert("Routing failed: " + e.message);
      }
    })();
  }, [networkGeoJSON, startPt, endPt, poisAll]);

  const clearRoute = useCallback(() => {
    setRouteGeoJson(null);
    setStartPt(null);
    setEndPt(null);
    setSelectMode(null);
  }, []);

  const exportDrawn = useCallback(() => {
    const data = drawnGeoJSON;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" });
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
              className={`rounded-md px-3 py-1.5 text-sm ${selectMode === "start" ? "bg-green-600 text-white" : "bg-white border border-slate-300 text-slate-800"}`}
              onClick={() => setSelectMode((m) => (m === "start" ? null : "start"))}
              title="Click the map or a POI to set Start"
            >
              Set Start
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm ${selectMode === "end" ? "bg-red-600 text-white" : "bg-white border border-slate-300 text-slate-800"}`}
              onClick={() => setSelectMode((m) => (m === "end" ? null : "end"))}
              title="Click the map or a POI to set End"
            >
              Set End
            </button>
            <button className="rounded-md px-3 py-1.5 text-sm bg-teal-500 text-white hover:bg-teal-600" onClick={computeRoute} title="Compute route on backend">
              Compute Route
            </button>
            <button className="rounded-md px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-800" onClick={clearRoute}>
              Clear Route
            </button>
            <button className="rounded-md px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-800" onClick={exportDrawn}>
              Export Paths GeoJSON
            </button>
          </div>
        </div>
      </nav>

      <div className="fixed top-14 right-4 z-[900] w-[min(90vw,360px)] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md space-y-2">
        <div className="text-xs text-slate-600">
          Draw paths and POIs; clicks snap to vertices, named places, or the nearest line.
        </div>
        <div className="text-xs">
          <div>Start: {startPt?.snapped ? `${startPt.snapped[1].toFixed(6)}, ${startPt.snapped[0].toFixed(6)} (${startPt.via})` : "—"}</div>
          <div>End: {endPt?.snapped ? `${endPt.snapped[1].toFixed(6)}, ${endPt.snapped[0].toFixed(6)} (${endPt.via})` : "—"}</div>
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

        {/* Paths drawing/editing */}
        <FeatureGroup ref={featureGroupPathsRef}>
          <EditControl
            position="topleft"
            onCreated={onCreatedPath}
            onEdited={onEditedPath}
            onDeleted={onDeletedPath}
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

        {/* POI editing removed - POIs used for snapping but not displayed */}

        {/* Visualize base network */}
        <GeoJSON data={baseNetwork} style={{ color: "#64748b", weight: 2, dashArray: "4 4" }} />

        {/* Backend route */}
        {routeGeoJson && <GeoJSON data={routeGeoJson} style={{ color: "green", weight: 5 }} />}

        {/* Start/End markers */}
        {startPt?.snapped && (
          <Marker position={[startPt.snapped[1], startPt.snapped[0]]} icon={greenPinIcon}>
            <Popup>Start</Popup>
          </Marker>
        )}
        {endPt?.snapped && (
          <Marker position={[endPt.snapped[1], endPt.snapped[0]]} icon={redPinIcon}>
            <Popup>End</Popup>
          </Marker>
        )}

        {/* POIs not displayed but available for snapping via ClickCapture */}

        {/* Click handler with composite snap */}
        <ClickCapture
          mode={selectMode}
          vertices={vertices}
          bounds={nitWarangalBounds}
          poiList={poisAll}
          networkFc={networkGeoJSON}
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
