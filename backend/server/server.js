const express = require('express');
const app = express();
const PORT = process.env.PORT || 5001;

app.use(express.json());

async function geocodeLocation(location) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json`
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

app.post('/api/route', async (req, res) => {
  try {
    const locations = req.body.locations;
    
    if (!locations || locations.length !== 2) {
      return res.status(422).json({ error: 'Expected 2 waypoints' });
    }
    
    const waypoints = await Promise.all(
      locations.map((location) => geocodeLocation(location))
    );
    
    res.json({ waypoints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});