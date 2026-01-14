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

  try {
    // Only allow GET requests
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { listId } = req.query;
    const apiKey = process.env.CLICKUP_API_KEY;

    console.log(`Received request for list ID: ${listId}`);

    if (!apiKey) {
      return res.status(500).json({ error: 'CLICKUP_API_KEY environment variable is not configured' });
    }

    if (!listId) {
      return res.status(400).json({ error: 'List ID is required' });
    }

    console.log(`Making request to ClickUp API for list: ${listId}`);
    
    const response = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000 // 8 second timeout
    });
    
    console.log('ClickUp API response received successfully');
    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Error in getList handler:', error.message);
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error response data:', JSON.stringify(error.response.data));
      console.error('Error response status:', error.response.status);
      
      return res.status(error.response.status).json({
        error: 'ClickUp API error',
        message: error.message,
        details: error.response.data
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from ClickUp API');
      return res.status(504).json({
        error: 'No response from ClickUp API',
        message: error.message
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
      return res.status(500).json({
        error: 'Request setup error',
        message: error.message
      });
    }
  }
};