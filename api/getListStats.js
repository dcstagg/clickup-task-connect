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
    // Fetch list info from ClickUp
    const listResponse = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    });

    const listName = listResponse.data.name || 'Unknown List';

    // Count ALL tasks by paginating through entire list
    let taskCount = 0;
    let page = 0;
    let hasMore = true;

    console.log(`Counting all tasks in list ${listId}...`);

    while (hasMore) {
      const tasksResponse = await axios({
        method: 'GET',
        url: `https://api.clickup.com/api/v2/list/${listId}/task`,
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          page: page,
          subtasks: false,
          include_closed: true  // Include completed/closed tasks
        },
        timeout: 30000
      });

      const tasks = tasksResponse.data.tasks || [];
      taskCount += tasks.length;

      console.log(`Page ${page + 1}: found ${tasks.length} tasks (total: ${taskCount})`);

      // ClickUp returns up to 100 tasks per page
      // If we get fewer than 100, we've reached the end
      if (tasks.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Get archived count from MongoDB
    let archivedCount = 0;
    try {
      const client = await connectToMongo();
      const db = client.db('nutiliti');
      const collection = db.collection('clickup_archived_tasks');
      archivedCount = await collection.countDocuments({ listId: listId });
    } catch (mongoError) {
      console.error('MongoDB error:', mongoError.message);
    }

    console.log(`Final count: ${taskCount} tasks in ClickUp, ${archivedCount} archived`);

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
