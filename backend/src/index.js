// server.js
const express = require('express');
const fetch = require('node-fetch'); // npm i node-fetch@2
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Simple request logger to diagnose timeouts: logs each incoming request early
app.use((req, res, next) => {
  try {
    console.log('[REQ]', new Date().toISOString(), req.method, req.originalUrl);
  } catch (e) {}
  next();
});

// Campus bounding box (south, west, north, east) used as default for Overpass queries
const CAMPUS_BBOX = {
  south: 17.978217,
  west: 79.526662,
  north: 17.989356,
  east: 79.534066,
};

// Simple in-memory cache for Overpass results to reduce query load
const osmCache = { bboxKey: null, ts: 0, ttl: 1000 * 60 * 60 * 6, data: null };

async function fetchOverpassPOIs(bbox = CAMPUS_BBOX) {
  const bboxKey = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const now = Date.now();
  if (osmCache.data && osmCache.bboxKey === bboxKey && (now - osmCache.ts) < osmCache.ttl) {
    return osmCache.data;
  }

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const keys = ['amenity','tourism','shop','leisure','historic','natural','office'];
  let clauses = keys.map(k => `node["${k}"](${bboxStr});way["${k}"](${bboxStr});relation["${k}"](${bboxStr});`).join('\n');
  const query = `[out:json][timeout:25];(\n${clauses}\n);out center;`;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query, headers: { 'Content-Type': 'text/plain' } });
    if (!resp.ok) throw new Error('Overpass error ' + resp.status);
    const json = await resp.json();
    const elements = Array.isArray(json.elements) ? json.elements : [];
    const pois = elements.map((el) => {
      let lat = null, lon = null;
      if (el.type === 'node') { lat = el.lat; lon = el.lon; }
      else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
      else if (el.lat && el.lon) { lat = el.lat; lon = el.lon; }
      const name = el.tags && (el.tags.name || el.tags['name:en'] || el.tags.ref || el.tags['addr:housename']);
      return (lat && lon) ? { id: `${el.type}/${el.id}`, name: name || (el.tags && Object.values(el.tags)[0]) || null, latitude: lat, longitude: lon } : null;
    }).filter(Boolean);

    osmCache.bboxKey = bboxKey; osmCache.ts = now; osmCache.data = pois;
    return pois;
  } catch (e) {
    console.warn('Overpass fetch failed', e.message);
    // Return cached data if available even if stale
    if (osmCache.data) return osmCache.data;
    return [];
  }
}

// routing
const routing = require('./routing');
// locations API (places/POIs)
// Only mount the DB-backed locations router if mongoose is connected; otherwise use the resilient fallback below.
let _mongoose;
try { _mongoose = require('mongoose'); } catch (e) { _mongoose = null; }
if (_mongoose && _mongoose.connection && _mongoose.connection.readyState === 1) {
  try {
    const locationsRouter = require('./routes/locations');
    app.use('/api', locationsRouter);
  } catch (e) {
    console.warn('locations router failed to mount:', e.message);
  }
} else {
  console.warn('Skipping mounting DB-backed locations router; mongoose not connected. Using fallback /api/locations');
}

// Resilient endpoint for frontend POIs: prefer DB-backed locations if available,
// otherwise derive a small set of POI-like entries from the canonical network vertices.
app.get('/api/locations', async (req, res) => {
  try {
    // If a locations router/model exists it will normally handle this; try to require the model quietly.
    let Location;
    try {
      Location = require('./models/Location');
    } catch (e) {
      Location = null;
    }

    // Only query Mongo if mongoose is connected (readyState === 1). Otherwise fallback quickly.
    let mongoose;
    try { mongoose = require('mongoose'); } catch (e) { mongoose = null; }
    if (Location && Location.find && mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const docs = await Location.find().sort({ createdAt: -1 }).limit(500).lean();
      return res.json(docs.map(d => ({ _id: d._id, name: d.name, latitude: d.latitude, longitude: d.longitude, address: d.address })));
    }

    // Fallback: derive vertices from canonical network
    const verts = [];
    const seen = new Set();
    (routing.canonicalNetwork.features || []).forEach((f) => {
      if (!f || f.geometry?.type !== 'LineString') return;
      (f.geometry.coordinates || []).forEach(([lng, lat]) => {
        const k = `${lng.toFixed(7)},${lat.toFixed(7)}`;
        if (!seen.has(k)) {
          seen.add(k);
          verts.push({ _id: k, name: 'vertex', latitude: lat, longitude: lng });
        }
      });
    });
    return res.json(verts);
  } catch (e) {
    console.error('Failed to return /api/locations', e);
    return res.json([]);
  }
});

// Geocoding with bounding box limited to NIT Warangal campus
async function geocodeLocation(location) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  // viewbox=x1,y1,x2,y2  (x=lon, y=lat); any two corners forming a real box are accepted
  // Using left,top,right,bottom for readability
  const left = 79.526662, right = 79.534066, top = 17.989356, bottom = 17.978217;
  url.searchParams.set('q', location);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');        // ask a few, pick the best
  url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`);
  url.searchParams.set('bounded', '1');      // restrict to the viewbox
  url.searchParams.set('countrycodes', 'in'); // optional

  const res = await fetch(url.toString(), {
    headers: {
      // Identify your app; include contact for policy compliance
      'User-Agent': 'SNACO Campus Navigator (contact: team@example.com)',
      'Accept-Language': 'en-IN'
    }
  });

  if (!res.ok) {
    throw new Error(`Nominatim error ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Location not found');
  }

  // Pick first result inside the box (Nominatim already bounded, but double-check)
  const result = data[0];
  return {
    display_name: result.display_name,
    latitude: parseFloat(result.lat),
    longitude: parseFloat(result.lon),
  };
}

app.get('/api/geocode', async (req, res) => {
  try {
    const location = req.query.location;
    if (!location) {
      return res.status(400).json({ error: 'Location query parameter is required' });
    }
    const coordinates = await geocodeLocation(location);
    res.json({ location, coordinates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy Overpass OSM POIs for the campus bounding box. Returns [{id,name,latitude,longitude}, ...]
app.get('/api/osm-pois', async (req, res) => {
  try {
    // allow optional bbox overrides via query (south,west,north,east)
    const { south, west, north, east } = req.query;
    const bbox = (south && west && north && east) ? { south: parseFloat(south), west: parseFloat(west), north: parseFloat(north), east: parseFloat(east) } : CAMPUS_BBOX;
    const pois = await fetchOverpassPOIs(bbox);
    res.json(pois);
  } catch (e) {
    console.error('/api/osm-pois failed', e.message);
    res.status(500).json({ error: 'Failed to fetch OSM POIs' });
  }
});

// --- Attach POIs to canonical network at startup and build canonical graph ---
let attachedNetwork = JSON.parse(JSON.stringify(routing.canonicalNetwork));
let canonicalGraph = { nodes: new Map(), adj: new Map() };
try {
  // Allow a slightly larger snap radius for POIs so campus POIs a few dozen meters off the nearest way still attach
  const { working, poiFc } = routing.attachPoisToNetwork(routing.canonicalNetwork, routing.canonicalPOIs || { type: 'FeatureCollection', features: [] }, 60);
  attachedNetwork = working;
  // build graph once for the canonical network with attached POIs
  canonicalGraph = routing.buildGraph(attachedNetwork);
  // resolve POIs to nearest node ids
  const idByKey = new Map();
  for (const v of canonicalGraph.nodes.values()) idByKey.set(routingKey(v.coord), v.id);
  (poiFc.features || []).forEach((p) => {
    if (!p || p.geometry?.type !== 'Point') return;
    const attached = p.properties && p.properties._attached ? p.properties._attached : p.geometry.coordinates;
    const k = routingKey(attached);
    const nodeId = idByKey.get(k);
    if (nodeId != null) routing.poiToVertex.set(p.properties?.id || k, nodeId);
  });
  console.log('Attached POIs and built canonical graph; POI->node count:', routing.poiToVertex.size);
} catch (e) {
  console.warn('Failed to attach POIs at startup', e.message);
}

app.post('/api/route', async (req, res) => {
  try {
    // Body shape supported:
    // { start: [lng,lat] | { placeId }, end: [lng,lat] | { placeId }, pois?: [{ id, name, coordinates: [lng,lat] }] }
    let { start, end, pois } = req.body || {};
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });

    // Process network - combine canonical network with client-provided network
    let working;
    try {
      // Start with canonical network as base
      working = JSON.parse(JSON.stringify(routing.canonicalNetwork || { type: 'FeatureCollection', features: [] }));

      // If client provided a network, validate and merge it
      if (req.body.network) {
        if (req.body.network.type !== 'FeatureCollection' || !Array.isArray(req.body.network.features)) {
          return res.status(400).json({ error: 'Invalid network format - expected GeoJSON FeatureCollection' });
        }

        // Validate each feature is a LineString and has valid coordinates
        const validFeatures = req.body.network.features.filter(f => {
          return f && f.geometry?.type === 'LineString' && 
                 Array.isArray(f.geometry.coordinates) &&
                 f.geometry.coordinates.every(coord => 
                   Array.isArray(coord) && coord.length === 2 &&
                   !isNaN(coord[0]) && !isNaN(coord[1])
                 );
        });

        // Merge valid client features with canonical network
        working.features = [...working.features, ...validFeatures];
      }
    } catch (e) {
      console.error('Failed to process network:', e);
      return res.status(400).json({ error: 'Invalid network data structure' });
    }

    // If the client supplied POIs (e.g. from Leaflet), attach them into the working network
    let usedPoiFc = null;
    if (Array.isArray(pois) && pois.length > 0) {
      const poiFc = { type: 'FeatureCollection', features: pois.filter(p=>p && Array.isArray(p.coordinates)).map(p => ({ type: 'Feature', properties: { id: p.id, name: p.name }, geometry: { type: 'Point', coordinates: p.coordinates } })) };
      const out = routing.attachPoisToNetwork(working, poiFc, 60);
      working = out.working;
      usedPoiFc = out.poiFc || poiFc;
    }

    // If start/end reference a placeId and we have the POI FC, resolve to attached coord
    const resolvePlaceToCoord = (obj) => {
      if (!obj) return null;
      if (Array.isArray(obj)) return obj;
      if (obj.placeId && usedPoiFc) {
        const f = (usedPoiFc.features || []).find(ff => ff.properties && ff.properties.id === obj.placeId);
        if (f) return (f.properties && f.properties._attached) ? f.properties._attached : f.geometry.coordinates;
      }
      return null;
    };

    // Resolve placeId to coordinates by checking (in order): DB Location model, in-memory poiToVertex mapping, Overpass POIs
    async function resolvePlaceIdGlobal(placeId) {
      if (!placeId) return null;
      // 1) DB-backed Location model (if available)
      try {
        let Location = null;
        try { Location = require('./models/Location'); } catch (e) { Location = null; }
        if (Location && Location.findOne) {
          const doc = await Location.findOne({ $or: [{ _id: placeId }, { id: placeId }, { name: placeId }] }).lean().exec().catch(()=>null);
          if (doc && doc.latitude != null && doc.longitude != null) return [doc.longitude, doc.latitude];
        }
      } catch (e) {}

      // 2) poiToVertex mapping (attached POIs at startup) -> map to node coord if present in canonicalGraph
      try {
        if (routing.poiToVertex && routing.poiToVertex.has(placeId)) {
          const nodeId = routing.poiToVertex.get(placeId);
          for (const v of canonicalGraph.nodes.values()) if (v.id === nodeId) return v.coord;
        }
      } catch (e) {}

      // 3) Overpass OSM POIs
      try {
        const overpassPois = await fetchOverpassPOIs();
        const found = overpassPois.find(p => p.id === placeId || p.name === placeId || `${p.latitude},${p.longitude}` === placeId);
        if (found) return [found.longitude, found.latitude];
      } catch (e) {}

      return null;
    }

    // If no POIs provided, inject start/end into the network so they become vertices
    let startCoord = resolvePlaceToCoord(start);
    let endCoord = resolvePlaceToCoord(end);

    // If not resolved yet and placeId provided, try global resolution (DB/poiToVertex/Overpass)
    if (!startCoord && start && typeof start === 'object' && start.placeId) {
      startCoord = await resolvePlaceIdGlobal(start.placeId);
    }
    if (!endCoord && end && typeof end === 'object' && end.placeId) {
      endCoord = await resolvePlaceIdGlobal(end.placeId);
    }

    if (!startCoord && Array.isArray(start)) {
      const ins = routing.injectVertex(working, start, 30);
      working = ins.fc;
      startCoord = ins.used || start;
    }
    if (!endCoord && Array.isArray(end)) {
      const ins = routing.injectVertex(working, end, 30);
      working = ins.fc;
      endCoord = ins.used || end;
    }

    // Validate coordinates format
    if (!startCoord || !endCoord) return res.status(400).json({ error: 'Could not resolve start or end coordinates' });
    if (!Array.isArray(startCoord) || startCoord.length !== 2 || !Array.isArray(endCoord) || endCoord.length !== 2) {
      return res.status(400).json({ error: 'Invalid coordinate format - expected [longitude, latitude] array' });
    }

    const { nodes, adj } = routing.buildGraph(working);

    const idByKey = new Map();
    for (const v of nodes.values()) idByKey.set(routingKey(v.coord), v.id);

    const getNearestId = (coord) => {
      const k = routingKey(coord);
      if (idByKey.has(k)) return idByKey.get(k);
      let best = { id: null, d: Infinity };
      for (const v of nodes.values()) {
        const d = turfDistance(coord, v.coord);
        if (d < best.d) best = { id: v.id, d };
      }
      return best.id;
    };

    const startId = getNearestId(startCoord);
    const endId = getNearestId(endCoord);

    const result = routing.dijkstra(adj, startId, endId);
    if (!result) return res.status(404).json({ error: 'No path found' });

    // Get path coordinates from graph nodes
    const routeCoords = result.path.map((id) => {
      const v = [...nodes.values()].find(x => x.id === id);
      return v ? v.coord : null;
    }).filter(Boolean);

    // Validate route - must include endpoints and have valid path
    if (routeCoords.length === 0) return res.status(404).json({ error: 'No route coordinates found' });
    if (routeCoords.length === 1) return res.status(400).json({ error: 'Start and end points are the same or too close' });

    // Ensure route includes start and end points (within reasonable tolerance)
    const turf = require('@turf/turf');
    const startDist = turfDistance(routeCoords[0], startCoord);
    const endDist = turfDistance(routeCoords[routeCoords.length - 1], endCoord);
    const MAX_ENDPOINT_DIST = 30; // meters
    
    if (startDist > MAX_ENDPOINT_DIST || endDist > MAX_ENDPOINT_DIST) {
      return res.status(400).json({ error: 'Route does not properly connect start and end points' });
    }

    // Create route feature with metadata
    const feature = turf.lineString(routeCoords, { 
      distance_m: result.distance,
      start_dist_m: startDist,
      end_dist_m: endDist 
    });
    return res.json({ route: feature });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Routing failed' });
  }
});

// helpers local to this file
function routingKey(coord) {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}
function turfDistance(a, b) {
  const turf = require('@turf/turf');
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
