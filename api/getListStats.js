// api/getListStats.js - Get list statistics and archive count
const axios = require('axios');
const { MongoClient } = require('mongodb');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// MongoDB connection cache
let cachedClient = null;

async function connectToMongo() {
  if (cachedClient) {
    return cachedClient;
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

module.exports = async (req, res) => {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.CLICKUP_API_KEY;
  const defaultListId = process.env.CLICKUP_LIST_ID;
  const listId = req.query.listId || defaultListId;

  if (!apiKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'CLICKUP_API_KEY environment variable is not configured'
    });
  }

  if (!listId) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'List ID is required (provide listId query param or set CLICKUP_LIST_ID env var)'
    });
  }

  try {
    // Fetch list info and task count from ClickUp in parallel
    const [listResponse, tasksResponse, archivedCount] = await Promise.all([
      // Get list details
      axios({
        method: 'GET',
        url: `https://api.clickup.com/api/v2/list/${listId}`,
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }),
      // Get tasks to count them (using minimal fields)
      axios({
        method: 'GET',
        url: `https://api.clickup.com/api/v2/list/${listId}/task`,
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          page: 0,
          subtasks: false,
          include_closed: true
        },
        timeout: 15000
      }),
      // Get archived count from MongoDB
      (async () => {
        try {
          const client = await connectToMongo();
          const db = client.db('nutiliti');
          const collection = db.collection('clickup_archived_tasks');
          return await collection.countDocuments({ listId: listId });
        } catch (mongoError) {
          console.error('MongoDB error:', mongoError.message);
          return 0; // Return 0 if MongoDB fails
        }
      })()
    ]);

    const listName = listResponse.data.name || 'Unknown List';
    const taskCount = tasksResponse.data.tasks?.length || 0;

    return res.status(200).json({
      success: true,
      listId,
      listName,
      taskCount,
      archivedCount,
      defaultListId: defaultListId || null
    });

  } catch (error) {
    console.error('Error in getListStats:', error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: 'ClickUp API error',
        message: error.response.data?.err || error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
};
