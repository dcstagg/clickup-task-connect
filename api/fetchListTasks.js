// api/fetchListTasks.js - Fetch tasks from a list for archiving
const axios = require('axios');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
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

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.CLICKUP_API_KEY;
  const listId = req.query.listId;
  const page = parseInt(req.query.page) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 100, 100); // Max 100 per page
  const closedOnly = req.query.closedOnly === 'true';

  if (!apiKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'CLICKUP_API_KEY environment variable is not configured'
    });
  }

  if (!listId) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'listId query parameter is required'
    });
  }

  try {
    console.log(`Fetching tasks from list ${listId}, page ${page}, closedOnly: ${closedOnly}`);

    // Build query params - always fetch all tasks including closed
    const params = {
      page: page,
      subtasks: false,
      include_closed: true,
      order_by: 'created',
      reverse: false // Oldest first
    };

    const response = await axios({
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${listId}/task`,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      params,
      timeout: 30000 // 30 second timeout for large lists
    });

    let allTasks = response.data.tasks || [];

    // If closedOnly, filter to tasks that have a date_closed (actually closed/completed)
    // This is more reliable than filtering by status name
    if (closedOnly) {
      allTasks = allTasks.filter(task => task.date_closed !== null);

      // Sort by date_closed ascending (oldest closed first)
      allTasks.sort((a, b) => {
        const dateA = parseInt(a.date_closed) || 0;
        const dateB = parseInt(b.date_closed) || 0;
        return dateA - dateB;
      });

      console.log(`Filtered to ${allTasks.length} closed tasks, sorted by oldest closed first`);
    }

    // Apply limit (ClickUp returns up to 100 per page by default)
    const tasks = allTasks.slice(0, limit);

    // Map to the data we need for archiving
    const mappedTasks = tasks.map(task => ({
      taskId: task.id,
      name: task.name,
      description: task.description || '',
      status: {
        status: task.status?.status || 'Unknown',
        color: task.status?.color || null
      },
      dateCreated: task.date_created ? new Date(parseInt(task.date_created)) : null,
      dateUpdated: task.date_updated ? new Date(parseInt(task.date_updated)) : null,
      dateClosed: task.date_closed ? new Date(parseInt(task.date_closed)) : null,
      dueDate: task.due_date ? new Date(parseInt(task.due_date)) : null,
      assignees: task.assignees?.map(a => ({
        id: a.id,
        username: a.username,
        email: a.email
      })) || [],
      tags: task.tags?.map(t => ({
        name: t.name,
        tagFg: t.tag_fg,
        tagBg: t.tag_bg
      })) || [],
      customFields: task.custom_fields || [],
      url: task.url,
      listId: task.list?.id || listId,
      listName: task.list?.name || 'Unknown List',
      priority: task.priority,
      rawData: task // Store full original data
    }));

    return res.status(200).json({
      success: true,
      listId,
      page,
      taskCount: mappedTasks.length,
      hasMore: allTasks.length >= 100, // ClickUp returns max 100, so if we got 100 there might be more
      tasks: mappedTasks
    });

  } catch (error) {
    console.error('Error in fetchListTasks:', error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: 'ClickUp API error',
        message: error.response.data?.err || error.message
      });
    }

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: 'Request timeout',
        message: 'The request timed out. Try a smaller page size.'
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch tasks',
      message: error.message
    });
  }
};
