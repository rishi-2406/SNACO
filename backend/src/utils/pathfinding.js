function dijkstra(graph, start, end) {
  const distances = {};
  const prev = {};
  const pq = new Set(Object.keys(graph));

  Object.keys(graph).forEach(node => (distances[node] = Infinity));
  distances[start] = 0;

  while (pq.size > 0) {
    const u = [...pq].reduce((a, b) => (distances[a] < distances[b] ? a : b));
    pq.delete(u);

    if (u === end) break;

    if (!graph[u]) continue; // skip if no edges

    graph[u].forEach(neighbor => {
      const alt = distances[u] + neighbor.weight;
      if (alt < distances[neighbor.node]) {
        distances[neighbor.node] = alt;
        prev[neighbor.node] = u;
      }
    });
  }

  // Reconstruct path
  const path = [];
  let u = end;
  while (u) {
    path.unshift(u);
    u = prev[u];
  }

  return {
    path,
    distance: distances[end],
  };
}

module.exports = { dijkstra };
