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
  const viewId = req.query.viewId; // Optional: fetch from a specific view
  const page = parseInt(req.query.page) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 100, 100); // Max 100 per page
  const closedOnly = req.query.closedOnly === 'true';

  if (!apiKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'CLICKUP_API_KEY environment variable is not configured'
    });
  }

  if (!listId && !viewId) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'listId or viewId query parameter is required'
    });
  }

  try {
    console.log(`Fetching tasks - listId: ${listId}, viewId: ${viewId}, page: ${page}, closedOnly: ${closedOnly}`);

    let allTasks = [];

    // If viewId is provided, fetch from the view (already sorted/filtered by ClickUp)
    if (viewId) {
      console.log(`Fetching from view ${viewId}...`);

      const response = await axios({
        method: 'GET',
        url: `https://api.clickup.com/api/v2/view/${viewId}/task`,
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          page: page
        },
        timeout: 15000
      });

      allTasks = response.data.tasks || [];
      console.log(`Fetched ${allTasks.length} tasks from view`);

    } else if (closedOnly) {
      // For closed tasks, fetch multiple pages IN PARALLEL to find oldest
      // Then sort all of them by date_closed
      const PARALLEL_PAGES = 10; // Fetch 10 pages at once (1000 tasks)

      console.log(`Fetching ${PARALLEL_PAGES} pages in parallel to find oldest closed tasks...`);

      // Create array of page fetches
      const pagePromises = [];
      for (let p = 0; p < PARALLEL_PAGES; p++) {
        pagePromises.push(
          axios({
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
          }).catch(err => {
            console.error(`Page ${p} error:`, err.message);
            return { data: { tasks: [] } };
          })
        );
      }

      // Fetch all pages in parallel
      const results = await Promise.all(pagePromises);

      // Collect all closed tasks from all pages
      for (let i = 0; i < results.length; i++) {
        const pageTasks = results[i].data.tasks || [];
        const closedTasks = pageTasks.filter(task => task.date_closed !== null);
        allTasks.push(...closedTasks);
        console.log(`Page ${i + 1}: ${pageTasks.length} tasks, ${closedTasks.length} closed`);
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
