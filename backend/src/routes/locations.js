const express = require('express');
const router = express.Router();
const Location = require('../models/Location');

// Get all locations
router.get('/locations', async (req, res) => {
  try {
    const locations = await Location.find().sort({ createdAt: -1 });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a new location
router.post('/locations', async (req, res) => {
  const location = new Location({
    name: req.body.name,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    address: req.body.address
  });

  try {
    const newLocation = await location.save();
    res.status(201).json(newLocation);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get a specific location
router.get('/locations/:id', async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (location) {
      res.json(location);
    } else {
      res.status(404).json({ message: 'Location not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a location
router.delete('/locations/:id', async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (location) {
      await location.remove();
      res.json({ message: 'Location deleted' });
    } else {
      res.status(404).json({ message: 'Location not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;