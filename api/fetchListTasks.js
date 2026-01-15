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

    let allTasks = [];

    if (closedOnly) {
      // For closed tasks, we need to fetch multiple pages to find the truly oldest
      // Then sort all of them by date_closed
      const MAX_PAGES = 20; // Fetch up to 2000 tasks to find oldest closed
      const START_TIME = Date.now();
      const MAX_DURATION_MS = 25000; // Leave buffer before Vercel timeout

      console.log(`Fetching up to ${MAX_PAGES} pages to find oldest closed tasks...`);

      for (let p = 0; p < MAX_PAGES; p++) {
        // Check time limit
        if (Date.now() - START_TIME > MAX_DURATION_MS) {
          console.log(`Time limit reached at page ${p}`);
          break;
        }

        const response = await axios({
          method: 'GET',
          url: `https://api.clickup.com/api/v2/list/${listId}/task`,
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          },
          params: {
            page: p,
            subtasks: false,
            include_closed: true
          },
          timeout: 8000
        });

        const pageTasks = response.data.tasks || [];
        if (pageTasks.length === 0) {
          console.log(`No more tasks at page ${p}`);
          break;
        }

        // Filter to closed tasks only
        const closedTasks = pageTasks.filter(task => task.date_closed !== null);
        allTasks.push(...closedTasks);

        console.log(`Page ${p + 1}: ${pageTasks.length} tasks, ${closedTasks.length} closed (total closed: ${allTasks.length})`);

        // If we have enough closed tasks, stop fetching
        if (allTasks.length >= limit * 2) {
          console.log(`Found enough closed tasks, stopping fetch`);
          break;
        }

        // If page wasn't full, we've reached the end
        if (pageTasks.length < 100) {
          break;
        }
      }

      // Sort ALL collected closed tasks by date_closed ascending (oldest first)
      allTasks.sort((a, b) => {
        const dateA = parseInt(a.date_closed) || 0;
        const dateB = parseInt(b.date_closed) || 0;
        return dateA - dateB;
      });

      console.log(`Total ${allTasks.length} closed tasks, sorted by oldest closed first`);

    } else {
      // For all tasks, just fetch the requested page
      const response = await axios({
        method: 'GET',
        url: `https://api.clickup.com/api/v2/list/${listId}/task`,
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          page: page,
          subtasks: false,
          include_closed: true,
          order_by: 'created',
          reverse: false // Oldest first
        },
        timeout: 30000
      });

      allTasks = response.data.tasks || [];
    }

    // Apply limit
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
      totalFound: allTasks.length, // Total tasks found before limiting
      hasMore: allTasks.length > limit, // More tasks available than we're returning
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
