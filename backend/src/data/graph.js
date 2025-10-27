const turf = require('@turf/turf');

function buildGraph(geojson) {
  const graph = {}; // adjacency list

  geojson.features.forEach((feature) => {
    const coords = feature.geometry.coordinates;

    for (let i = 0; i < coords.length - 1; i++) {
      const start = coords[i].join(',');
      const end = coords[i + 1].join(',');

      const distance = turf.distance(
        turf.point(coords[i]),
        turf.point(coords[i + 1]),
        { units: 'meters' }
      );

      if (!graph[start]) graph[start] = [];
      if (!graph[end]) graph[end] = [];

      graph[start].push({ node: end, weight: distance });
      graph[end].push({ node: start, weight: distance }); // undirected
    }
  });

  return graph;
}

module.exports = { buildGraph };
