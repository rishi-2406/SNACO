// Minimal geocoding/routing API restricted to NITW bbox
const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;

const path = require("path");
const fs = require("fs");
const { buildGraph } = require("./data/graph");
const { dijkstra } = require(path.join(__dirname, "utils", "pathfinding"));


// Load your campus paths into a graph structure at server startup
const geojsonPath = path.join(__dirname, "data", "paths.geojson");
const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
const graph = buildGraph(geojsonData);

app.use(express.json());

async function geocodeLocation(location) {
  try {
    // NIT Warangal campus bounding box from provided polygon (minLon,minLat,maxLon,maxLat)
    // Provided points (lat,lon):
    // (17.988631, 79.526662), (17.989356, 79.533899), (17.978217, 79.534066), (17.979742, 79.527993)
    // Bounding box derived: minLon=79.526662, minLat=17.978217, maxLon=79.534066, maxLat=17.989356
    const viewbox = [79.526662, 17.978217, 79.534066, 17.989356].join(',');
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&viewbox=${viewbox}&bounded=1`
    );
    const data = await response.json();
    
    if (data.length > 0) {
      const result = data[0];
      return {
        display_name: result.display_name,
        latitude: result.lat,
        longitude: result.lon,
      };
    } else {
      throw new Error('Location not found');
    }
  } catch (error) {
    throw error;
  }
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

app.post("/api/route", async (req, res) => {
  try {
    const locations = req.body.locations;
    
    if (!locations || locations.length !== 2) {
      return res.status(422).json({ error: "Expected 2 waypoints" });
    }

    // Step 1: Geocode both locations
    const waypoints = await Promise.all(
      locations.map((loc) => geocodeLocation(loc))
    );
    console.log("Geocoded waypoints:", waypoints);
    const start = waypoints[0];
    const end = waypoints[1];

    // Step 2: Convert to graph node keys (lon,lat)
    const startKey = `${start.longitude},${start.latitude}`;
    const endKey = `${end.longitude},${end.latitude}`;

    console.log("Start Key:", startKey);
    console.log("End Key:", endKey);

    // Step 3: Compute shortest path
    const result = dijkstra(graph, startKey, endKey);

    if (!result.path || result.path.length === 0) {
      return res.status(404).json({ error: "No route found in custom graph" });
    }

    console.log("Computed route:", result.path);


    // Step 4: Convert node keys back into coordinates
    const routeCoords = result.path.map((key) => {
      const [lon, lat] = key.split(",").map(Number);
      return { lat, lon };
    });

    console.log("Route coordinates:", routeCoords);
    
    // Step 5: Send both original geocoded waypoints + route
    res.json({
    waypoints: routeCoords,
    distance: result.distance,
    });


  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});