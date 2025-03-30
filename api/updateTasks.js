// api/updateTasks.js - Dedicated endpoint for updating tasks
const axios = require('axios');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { taskIds, status } = req.body;
    const apiKey = req.headers.authorization;
    
    console.log(`Request received - Status: "${status}", Tasks: ${taskIds?.length || 0}`);
    console.log(`Authorization header present: ${!!apiKey}`);
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required in Authorization header' });
    }
    
    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'Task IDs array is required' });
    }
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    // Create a clean API key (in case it has "Bearer " prefix)
    const cleanApiKey = apiKey.replace(/^Bearer\s+/i, '');
    
    const results = [];
    const BATCH_SIZE = 3; // Process in smaller batches to avoid timeouts
    
    // Process tasks in batches
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
      const batch = taskIds.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}, tasks: ${batch.join(', ')}`);
      
      const batchPromises = batch.map(async (taskId) => {
        try {
          const response = await axios({
            method: 'PUT',
            url: `https://api.clickup.com/api/v2/task/${taskId}`,
            headers: {
              'Authorization': cleanApiKey,
              'Content-Type': 'application/json'
            },
            data: { status },
            timeout: 5000 // 5 second timeout per request
          });
          
          return { taskId, success: true, message: 'Status updated successfully' };
        } catch (error) {
          console.error(`Error updating task ${taskId}:`, error.message);
          
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
    console.error('Unhandled error in updateTasks:', error.message);
    
    return res.status(500).json({ 
      error: 'Failed to process request', 
      message: error.message 
    });
  }
};