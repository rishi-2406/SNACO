const turf = require('@turf/turf');
const fs = require('fs');
const path = require('path');

// Load canonical network from disk at startup (could later be from Mongo)
const networkPath = path.join(__dirname, 'network.sample.geojson');
let canonicalNetwork = { type: 'FeatureCollection', features: [] };
try {
  const raw = fs.readFileSync(networkPath, 'utf8');
  canonicalNetwork = JSON.parse(raw);
  console.log('Loaded canonical network with', canonicalNetwork.features.length, 'features');
} catch (e) {
  console.warn('No canonical network found or failed to parse; starting empty');
}

// Load POIs (optional) and attach them to the canonical network at startup
const poiPath = path.join(__dirname, 'pois.sample.geojson');
let canonicalPOIs = { type: 'FeatureCollection', features: [] };
try {
  const raw = fs.readFileSync(poiPath, 'utf8');
  canonicalPOIs = JSON.parse(raw);
  console.log('Loaded POIs with', canonicalPOIs.features.length, 'places');
} catch (e) {
  // optional
}

// Map placeId -> nodeId (filled after graph built)
const poiToVertex = new Map();

function attachPoisToNetwork(networkFc, poiFc, maxSnapMeters = 30) {
  // Operate on a working copy so we can split lines per POI
  let working = JSON.parse(JSON.stringify(networkFc));
  for (const poi of (poiFc.features || [])) {
    if (!poi || poi.geometry?.type !== 'Point') continue;
    const p = poi.geometry.coordinates;

    // Find nearest point on any line
    let best = { i: -1, pt: null, dist: Infinity };
    (working.features || []).forEach((f, i) => {
      if (!f || f.geometry?.type !== 'LineString') return;
      const s = turf.nearestPointOnLine(f, turf.point(p), { units: 'meters' });
      const d = s.properties?.dist ?? Infinity;
      if (d < best.dist) best = { i, pt: s.geometry.coordinates, dist: d };
    });

    if (best.i === -1 || best.dist > maxSnapMeters) continue;

    const line = working.features[best.i];
    const already = line.geometry.coordinates.some(([lng, lat]) => Math.abs(lng - best.pt[0]) < 1e-12 && Math.abs(lat - best.pt[1]) < 1e-12);
    if (!already) {
      const split = turf.lineSplit(line, turf.point(best.pt));
      const parts = split.features.filter(g => g.geometry?.type === 'LineString');
      const features = working.features.slice();
      features.splice(best.i, 1, ...parts.map(ls => ({ type: 'Feature', properties: { ...(line.properties || {}) }, geometry: { type: 'LineString', coordinates: ls.geometry.coordinates } })));
      working = { type: 'FeatureCollection', features };
    }

    // We'll map placeId -> coord for now; actual node id will be resolved after graph build
    poi.properties = poi.properties || {};
    poi.properties._attached = best.pt;
  }
  return { working, poiFc: poiFc };
}

function keyCoord([lng, lat]) {
  return `${lng.toFixed(7)},${lat.toFixed(7)}`;
}

function buildGraph(fc) {
  const nodes = new Map(); // key -> { id, coord }
  const adj = new Map(); // id -> [{ to, weight, geom }]
  let idSeq = 0;

  const getNode = (coord) => {
    const k = keyCoord(coord);
    if (!nodes.has(k)) nodes.set(k, { id: idSeq++, coord });
    return nodes.get(k);
  };

  (fc.features || []).forEach((f) => {
    if (!f || f.geometry?.type !== 'LineString') return;
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = getNode(coords[i]);
      const b = getNode(coords[i + 1]);
      const seg = turf.lineString([a.coord, b.coord]);
      const w = turf.length(seg, { units: 'meters' });
      if (!adj.has(a.id)) adj.set(a.id, []);
      if (!adj.has(b.id)) adj.set(b.id, []);
      adj.get(a.id).push({ to: b.id, weight: w, geom: [a.coord, b.coord] });
      adj.get(b.id).push({ to: a.id, weight: w, geom: [b.coord, a.coord] });
    }
  });

  return { nodes, adj };
}

function injectVertex(fc, coord, maxSnapMeters = 25) {
  let best = { dist: Infinity, i: -1, snapped: null };
  (fc.features || []).forEach((f, i) => {
    if (!f || f.geometry?.type !== 'LineString') return;
    const snapped = turf.nearestPointOnLine(f, turf.point(coord), { units: 'meters' });
    const dist = snapped.properties.dist || 0;
    if (dist < best.dist) best = { dist, i, snapped };
  });

  if (best.i === -1 || best.dist > maxSnapMeters) return { fc, used: null };

  const line = fc.features[best.i];
  const p = best.snapped.geometry.coordinates;

  const already = line.geometry.coordinates.some(([lng, lat]) => Math.abs(lng - p[0]) < 1e-12 && Math.abs(lat - p[1]) < 1e-12);
  if (already) return { fc, used: p };

  const split = turf.lineSplit(line, turf.point(p));
  const parts = split.features.filter((g) => g.geometry?.type === 'LineString');
  const features = fc.features.slice();
  features.splice(best.i, 1, ...parts.map((ls) => ({ type: 'Feature', properties: { ...(line.properties || {}) }, geometry: { type: 'LineString', coordinates: ls.geometry.coordinates } })));
  return { fc: { type: 'FeatureCollection', features }, used: p };
}

function dijkstra(adj, startId, goalId) {
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  const queue = [];
  const push = (id, d) => queue.push({ id, d });
  const popMin = () => {
    let m = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[m].d) m = i;
    return queue.splice(m, 1)[0];
  };

  adj.forEach((_, id) => dist.set(id, Infinity));
  dist.set(startId, 0);
  push(startId, 0);

  while (queue.length) {
    const { id } = popMin();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === goalId) break;
    const edges = adj.get(id) || [];
    for (const { to, weight } of edges) {
      const alt = dist.get(id) + weight;
      if (alt < dist.get(to)) {
        dist.set(to, alt);
        prev.set(to, id);
        push(to, alt);
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return null;
  const path = [];
  let u = goalId;
  path.push(u);
  while (prev.has(u)) { u = prev.get(u); path.push(u); }
  path.reverse();
  return { path, distance: dist.get(goalId) };
}

module.exports = {
  canonicalNetwork,
  buildGraph,
  injectVertex,
  dijkstra,
  canonicalPOIs,
  attachPoisToNetwork,
  poiToVertex,
};
