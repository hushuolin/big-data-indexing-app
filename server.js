const express = require('express');
const redis = require('redis');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const dotenv = require('dotenv');
const planSchema = require('./schema');
const etag = require('etag');
const moment = require('moment');

// Load environment variables from .env file
dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());

// Initialize Redis
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

client.on('error', (err) => console.error('Redis error:', err));
client.on('connect', () => console.log('Redis client connected'));
client.on('ready', () => console.log('Redis client ready'));

// Middleware to ensure Redis client is connected
app.use((req, res, next) => {
  if (!client.isReady) {
    console.error('Redis client is not connected');
    return res.status(500).json({ error: 'Redis client is not connected' });
  }
  next();
});

// Function to transform date format
const transformDate = (req, res, next) => {
  if (req.body.creationDate) {
    req.body.creationDate = moment(req.body.creationDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
  }
  next();
};

// Middleware for validation
const validateSchema = (schema) => {
  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(schema);

  return (req, res, next) => {
    const valid = validate(req.body);
    if (!valid) {
      return res.status(400).json({ message: "Validation failed", errors: validate.errors });
    }
    next();
  };
};

// Create Plan (POST)
app.post('/v1/plan', transformDate, validateSchema(planSchema), async (req, res) => {
  try {
    const requestBodyString = JSON.stringify(req.body);
    const { objectId } = req.body;

    if (!objectId) {
      return res.status(400).json({ message: "Missing objectId in the request body." });
    }

    await client.set(objectId, requestBodyString);
    const dataString = await client.get(objectId);
    const generatedEtag = etag(dataString);
    res.set('ETag', generatedEtag);
    res.status(201).json(JSON.parse(dataString));
  } catch (err) {
    console.error('Error creating plan:', err);
    res.status(500).json({ error: 'Error creating plan' });
  }
});

// Read Plan (GET)
app.get('/v1/plan/:id', async (req, res) => {
  try {
    const key = req.params.id;
    const dataString = await client.get(key);

    if (!dataString) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const etagHeader = etag(dataString);
    if (req.headers['if-none-match'] === etagHeader) {
      return res.status(304).end();
    }

    res.set('ETag', etagHeader);
    res.status(200).json(JSON.parse(dataString));
  } catch (err) {
    console.error('Error retrieving plan:', err);
    res.status(500).json({ error: 'Error retrieving plan' });
  }
});

// Delete Plan (DELETE)
app.delete('/v1/plan/:id', async (req, res) => {
  try {
    const key = req.params.id;
    const result = await client.del(key);

    if (result === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.status(200).json({ message: 'Plan deleted successfully' });
  } catch (err) {
    console.error('Error deleting plan:', err);
    res.status(500).json({ error: 'Error deleting plan' });
  }
});

// Start the server only after Redis client is connected and ready
client.connect().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to Redis:', err);
});

module.exports = app; // Export the app for testing
