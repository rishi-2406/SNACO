// server.js (or index.js, minimal Express server)
const express = require('express');
const fetch = require('node-fetch'); // install if needed: npm i node-fetch@2
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Geocoding with bounding box limited to NIT Warangal campus
async function geocodeLocation(location) {
  try {
    const viewbox = [79.526662, 17.978217, 79.534066, 17.989356].join(',');
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&viewbox=${viewbox}&bounded=1`
    );
    const data = await response.json();

    if (data.length > 0) {
      const result = data[0];
      return {
        display_name: result.display_name,
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
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


app.post('/api/route', async (req, res) => {
  try {
    const locations = req.body.locations;
    if (!locations || locations.length !== 2) {
      return res.status(422).json({ error: 'Expected 2 waypoints' });
    }

    const waypoints = await Promise.all(
      locations.map(location => geocodeLocation(location))
    );

    res.json({ waypoints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
