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
    // Set a timeout to ensure we return before Vercel kills us
    const START_TIME = Date.now();
    const MAX_DURATION_MS = 8000; // Leave 2s buffer before Vercel's 10s limit

    // Fetch list info from ClickUp
    const listResponse = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    const listName = listResponse.data.name || 'Unknown List';

    // Count tasks with a time limit - return partial count if we run out of time
    let taskCount = 0;
    let pageGroup = 0;
    let hasMore = true;
    let isPartialCount = false;
    const PARALLEL_PAGES = 10; // Fetch 10 pages at once (1000 tasks)

    console.log(`Counting all tasks in list ${listId}...`);

    while (hasMore) {
      // Check if we're running out of time
      if (Date.now() - START_TIME > MAX_DURATION_MS) {
        console.log('Time limit reached, returning partial count');
        isPartialCount = true;
        break;
      }

      // Create array of page numbers to fetch in parallel
      const pageNumbers = [];
      for (let i = 0; i < PARALLEL_PAGES; i++) {
        pageNumbers.push(pageGroup * PARALLEL_PAGES + i);
      }

      // Fetch multiple pages in parallel
      const pagePromises = pageNumbers.map(page =>
        axios({
          method: 'GET',
          url: `https://api.clickup.com/api/v2/list/${listId}/task`,
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          },
          params: {
            page: page,
            subtasks: false,
            include_closed: true
          },
          timeout: 5000
        }).catch(err => {
          console.error(`Page ${page} error:`, err.message);
          return { data: { tasks: [] } };
        })
      );

      const results = await Promise.all(pagePromises);

      let groupCount = 0;
      let foundEmptyPage = false;

      for (let i = 0; i < results.length; i++) {
        const tasks = results[i].data.tasks || [];
        groupCount += tasks.length;

        if (tasks.length < 100) {
          foundEmptyPage = true;
        }
      }

      taskCount += groupCount;
      console.log(`Pages ${pageGroup * PARALLEL_PAGES + 1}-${(pageGroup + 1) * PARALLEL_PAGES}: found ${groupCount} tasks (total: ${taskCount})`);

      if (foundEmptyPage || groupCount === 0) {
        hasMore = false;
      } else {
        pageGroup++;
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

    console.log(`Final count: ${taskCount} tasks in ClickUp, ${archivedCount} archived, partial: ${isPartialCount}`);

    return res.status(200).json({
      success: true,
      listId,
      listName,
      taskCount,
      isPartialCount, // true if we hit time limit
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
