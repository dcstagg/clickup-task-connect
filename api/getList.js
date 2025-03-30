// api/getList.js - Dedicated endpoint for fetching list details
const axios = require('axios');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

module.exports = async (req, res) => {
  // Set CORS headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { listId } = req.query;
  const apiKey = req.headers.authorization;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required in Authorization header' });
  }
  
  if (!listId) {
    return res.status(400).json({ error: 'List ID is required' });
  }
  
  try {
    console.log(`Fetching list: ${listId}`);
    const response = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000 // 8 second timeout
    });
    
    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching list:', error.message);
    const errorResponse = {
      error: 'Failed to fetch list details',
      message: error.message,
      details: error.response?.data?.err || 'Unknown error'
    };
    return res.status(error.response?.status || 500).json(errorResponse);
  }
};S