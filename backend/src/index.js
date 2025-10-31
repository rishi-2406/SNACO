// server.js
const express = require('express');
const fetch = require('node-fetch'); // npm i node-fetch@2
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.post('/api/route', async (req, res) => {
  try {
    const locations = req.body.locations;
    if (!locations || locations.length !== 2) {
      return res.status(422).json({ error: 'Expected 2 waypoints' });
    }
    const waypoints = await Promise.all(locations.map(geocodeLocation));
    res.json({ waypoints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
