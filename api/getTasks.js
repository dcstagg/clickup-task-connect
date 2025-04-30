// api/getTasks.js - Endpoint to fetch task statuses
const axios = require('axios');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

module.exports = async (req, res) => {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskIds } = req.body;
  const apiKey = req.headers.authorization;
  
  if (!apiKey || !taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({ 
      error: 'Missing required parameters', 
      message: 'API key and taskIds array are required' 
    });
  }
  
  // Clean API key
  const cleanApiKey = apiKey.replace(/^Bearer\s+/i, '');
  
  const results = [];
  const BATCH_SIZE = 3; // Process in smaller batches to avoid timeouts
  
  try {
    // Process tasks in batches
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
      const batch = taskIds.slice(i, i + BATCH_SIZE);
      console.log(`Fetching batch ${Math.floor(i/BATCH_SIZE) + 1}, tasks: ${batch.join(', ')}`);
      
      const batchPromises = batch.map(async (taskId) => {
        try {
          const response = await axios({
            method: 'GET',
            url: `https://api.clickup.com/api/v2/task/${taskId}`,
            headers: {
              'Authorization': cleanApiKey,
              'Content-Type': 'application/json'
            },
            timeout: 5000 // 5 second timeout per request
          });
          
          // Extract relevant data
          const { id, name, status, url, parent } = response.data;
          
          return { 
            taskId: id, 
            name, 
            status: {
              status,
              color: response.data.status?.color || null
            },
            url,
            list: parent ? { id: parent.id, name: parent.name } : null,
            success: true 
          };
        } catch (error) {
          console.error(`Error fetching task ${taskId}:`, error.message);
          
          if (error.response) {
            return { 
              taskId, 
              success: false, 
              message: `Failed: ${error.response.data?.err || error.response.statusText}` 
            };
          } else {
            return { 
              taskId, 
              success: false, 
              message: `Failed: ${error.message}` 
            };
          }
        }
      });
      
      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add a small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < taskIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return res.status(200).json({ results });
  } catch (error) {
    console.error('Unhandled error in getTasks:', error.message);
    
    return res.status(500).json({ 
      error: 'Failed to process request', 
      message: error.message 
    });
  }
};