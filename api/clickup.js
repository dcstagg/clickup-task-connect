// api/clickup.js - Vercel serverless function
const axios = require('axios');

// Helper function to handle CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Handle preflight requests
const handleOptions = (req, res) => {
  res.status(200).send(null);
};

// Get list details
const getList = async (req, res) => {
  const { listId } = req.query;
  const apiKey = req.headers.authorization;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required in Authorization header' });
  }
  
  if (!listId) {
    return res.status(400).json({ error: 'List ID is required' });
  }
  
  try {
    const response = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching list:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({ 
      error: error.response?.data?.err || 'Failed to fetch list details' 
    });
  }
};

// Update tasks
const updateTasks = async (req, res) => {
  const { taskIds, status } = req.body;
  const apiKey = req.headers.authorization;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required in Authorization header' });
  }
  
  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({ error: 'Task IDs array is required' });
  }
  
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }
  
  try {
    const results = [];
    
    for (const taskId of taskIds) {
      try {
        await axios({
          method: 'PUT',
          url: `https://api.clickup.com/api/v2/task/${taskId}`,
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          },
          data: {
            status
          }
        });
        
        results.push({ taskId, success: true, message: 'Status updated successfully' });
      } catch (error) {
        results.push({ 
          taskId, 
          success: false, 
          message: `Failed: ${error.response?.data?.err || error.message}` 
        });
      }
    }
    
    return res.status(200).json({ results });
  } catch (error) {
    console.error('Error updating tasks:', error.message);
    return res.status(500).json({ error: 'Failed to process request' });
  }
};

// Main handler
module.exports = async (req, res) => {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return handleOptions(req, res);
  }
  
  // Route based on request path and method
  if (req.method === 'GET') {
    return getList(req, res);
  } else if (req.method === 'POST') {
    return updateTasks(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};