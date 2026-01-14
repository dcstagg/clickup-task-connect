// api/archiveBatch.js - Archive tasks to MongoDB and delete from ClickUp
const axios = require('axios');
const { MongoClient } = require('mongodb');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.CLICKUP_API_KEY;
  const mongoUri = process.env.MONGODB_URI;
  const { tasks } = req.body;

  if (!apiKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'CLICKUP_API_KEY environment variable is not configured'
    });
  }

  if (!mongoUri) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'MONGODB_URI environment variable is not configured'
    });
  }

  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'tasks array is required'
    });
  }

  // Limit batch size to prevent timeouts
  if (tasks.length > 10) {
    return res.status(400).json({
      error: 'Batch too large',
      message: 'Maximum 10 tasks per batch to prevent timeouts'
    });
  }

  const results = [];

  try {
    // Connect to MongoDB
    const client = await connectToMongo();
    const db = client.db('nutiliti');
    const collection = db.collection('clickup_archived_tasks');

    // Process each task
    for (const task of tasks) {
      const result = {
        taskId: task.taskId,
        name: task.name,
        savedToMongo: false,
        deletedFromClickUp: false,
        success: false,
        message: ''
      };

      try {
        // Step 1: Save to MongoDB FIRST (safety net)
        const archiveDoc = {
          ...task,
          archivedAt: new Date(),
          _originalTaskId: task.taskId
        };

        // Use upsert to avoid duplicates if re-running
        await collection.updateOne(
          { taskId: task.taskId },
          { $set: archiveDoc },
          { upsert: true }
        );

        result.savedToMongo = true;
        console.log(`Saved task ${task.taskId} to MongoDB`);

        // Step 2: Delete from ClickUp (only after successful save)
        try {
          await axios({
            method: 'DELETE',
            url: `https://api.clickup.com/api/v2/task/${task.taskId}`,
            headers: {
              'Authorization': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          });

          result.deletedFromClickUp = true;
          result.success = true;
          result.message = 'Archived successfully';
          console.log(`Deleted task ${task.taskId} from ClickUp`);

        } catch (deleteError) {
          // Task saved but couldn't delete - manual cleanup needed
          console.error(`Failed to delete task ${task.taskId}:`, deleteError.message);
          result.message = `Saved to archive but failed to delete from ClickUp: ${deleteError.response?.data?.err || deleteError.message}`;
        }

      } catch (saveError) {
        console.error(`Failed to save task ${task.taskId}:`, saveError.message);
        result.message = `Failed to save to archive: ${saveError.message}`;
      }

      results.push(result);

      // Small delay between tasks to avoid rate limiting
      if (tasks.indexOf(task) < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    return res.status(200).json({
      success: failedCount === 0,
      processed: results.length,
      successful: successCount,
      failed: failedCount,
      results
    });

  } catch (error) {
    console.error('Error in archiveBatch:', error.message);

    return res.status(500).json({
      error: 'Archive process failed',
      message: error.message,
      results // Return partial results if any
    });
  }
};
