const pool = require('../config/db');
const cloudinary = require('../config/cloudinary');
const emitter = require('../events/eventEmitter');

// Lazy module initialization: update notification constraint to support admin notification types
(async () => {
  try {
    // Safely update notification constraint to support user_registered and admin_removal
    await pool.query(`
      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
      ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
        CHECK (type IN ('like', 'follow', 'project_created', 'user_registered', 'admin_removal'));
    `);
    console.log('[AdminController] Lazy initialization complete.');
  } catch (err) {
    console.error('[AdminController Init Error]', err.message);
  }
})();

// Also listen on eventEmitter for UserRegistered just in case emitted manually
emitter.on('UserRegistered', async (newUser) => {
  try {
    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const adm of admins.rows) {
      const exists = await pool.query(
        `SELECT id FROM notifications WHERE recipient_id = $1 AND actor_id = $2 AND type = 'user_registered'`,
        [adm.id, newUser.id]
      );
      if (exists.rows.length === 0) {
        const message = `${newUser.name} just registered as a ${newUser.role}.`;
        await pool.query(
          `INSERT INTO notifications (recipient_id, actor_id, type, message)
           VALUES ($1, $2, 'user_registered', $3)`,
          [adm.id, newUser.id, message]
        );
      }
    }
  } catch (err) {
    console.error('[Event] UserRegistered handler error:', err.message);
  }
});

const getStats = async (req, res) => {
  try {
    const usersRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE role = 'student')   AS total_students,
        COUNT(*) FILTER (WHERE role = 'recruiter') AS total_recruiters,
        COUNT(*) FILTER (WHERE role = 'admin')     AS total_admins,
        COUNT(*)                                   AS total_users,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS new_users_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_users_this_week
      FROM users;
    `);

    const projectsRes = await pool.query(`
      SELECT
        COUNT(*) AS total_projects,
        COUNT(*) FILTER (WHERE status = 'published') AS total_published_projects,
        COUNT(*) FILTER (WHERE status = 'draft')     AS total_draft_projects,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS new_projects_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_projects_this_week
      FROM projects;
    `);

    const likesRes = await pool.query('SELECT COUNT(*) AS total_likes FROM likes;');

    const u = usersRes.rows[0] || {};
    const p = projectsRes.rows[0] || {};
    const l = likesRes.rows[0] || {};

    const stats = {
      totalUsers: Number.parseInt(u.total_users || 0, 10),
      totalStudents: Number.parseInt(u.total_students || 0, 10),
      totalRecruiters: Number.parseInt(u.total_recruiters || 0, 10),
      totalAdmins: Number.parseInt(u.total_admins || 0, 10),
      totalProjects: Number.parseInt(p.total_projects || 0, 10),
      totalPublishedProjects: Number.parseInt(p.total_published_projects || 0, 10),
      totalDraftProjects: Number.parseInt(p.total_draft_projects || 0, 10),
      totalLikes: Number.parseInt(l.total_likes || 0, 10),
      newUsersToday: Number.parseInt(u.new_users_today || 0, 10),
      newProjectsToday: Number.parseInt(p.new_projects_today || 0, 10),
      newUsersThisWeek: Number.parseInt(u.new_users_this_week || 0, 10),
      newProjectsThisWeek: Number.parseInt(p.new_projects_this_week || 0, 10),
    };

    res.json({
      success: true,
      ...stats,
      stats
    });
  } catch (err) {
    console.error('[admin.getStats]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching stats.' });
  }
};

const getUsers = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const { search, role, sort = 'newest' } = req.query;

    const params = [];
    let whereClause = 'WHERE 1=1';

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.student_id ILIKE $${params.length})`;
    }

    if (role && role !== 'all') {
      params.push(role);
      whereClause += ` AND u.role = $${params.length}`;
    }

    let orderClause = 'ORDER BY u.created_at DESC';
    if (sort === 'oldest') orderClause = 'ORDER BY u.created_at ASC';
    if (sort === 'name') orderClause = 'ORDER BY u.name ASC';

    const countQuery = `SELECT COUNT(*) FROM users u ${whereClause}`;
    const countRes = await pool.query(countQuery, params);
    const total = Number.parseInt(countRes.rows[0].count, 10);

    const queryParams = [...params, limit, offset];
    const dataQuery = `
      SELECT u.id, u.google_id, u.name, u.email, u.profile_pic, u.role, u.student_id, u.admin_verified, u.is_blocked, u.created_at, u.updated_at, 
        (SELECT COUNT(*) FROM projects WHERE user_id = u.id)::int AS project_count,
        (SELECT COUNT(*) FROM followers WHERE following_id = u.id)::int AS follower_count
      FROM users u
      ${whereClause}
      ${orderClause}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const dataRes = await pool.query(dataQuery, queryParams);

    res.json({
      success: true,
      users: dataRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1
    });
  } catch (err) {
    console.error('[admin.getUsers]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching users.' });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const userRes = await pool.query(`
      SELECT u.id, u.google_id, u.name, u.email, u.profile_pic, u.role, u.student_id, u.admin_verified, u.is_blocked, u.created_at, u.updated_at,
        (SELECT COUNT(*) FROM projects WHERE user_id = u.id)::int AS project_count,
        (SELECT COUNT(*) FROM followers WHERE following_id = u.id)::int AS follower_count,
        (SELECT COUNT(*) FROM followers WHERE follower_id = u.id)::int AS following_count,
        (SELECT COALESCE(COUNT(*), 0) FROM likes l JOIN projects p ON l.project_id = p.id WHERE p.user_id = u.id)::int AS total_likes_received
      FROM users u
      WHERE u.id = $1
    `, [id]);

    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userRes.rows[0];

    const projectsRes = await pool.query(`
      SELECT id, title, status, view_count, created_at, thumbnail_url
      FROM projects
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [id]);

    user.recent_projects = projectsRes.rows;

    res.json({
      success: true,
      user,
      ...user
    });
  } catch (err) {
    console.error('[admin.getUserById]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching user.' });
  }
};

const blockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked } = req.body;

    if (String(req.user.id) === String(id)) {
      return res.status(403).json({ success: false, message: 'You cannot block yourself.' });
    }

    const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (userRes.rows[0].role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot block an administrator.' });
    }

    await pool.query('UPDATE users SET is_blocked = $1, updated_at = NOW() WHERE id = $2', [Boolean(blocked), id]);

    res.json({ success: true, blocked: Boolean(blocked) });
  } catch (err) {
    console.error('[admin.blockUser]', err.message);
    res.status(500).json({ success: false, message: 'Server error toggling block.' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (userRes.rows[0].role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot delete an administrator.' });
    }

    // Extract Cloudinary public IDs for all project thumbnails by this user
    const projectsRes = await pool.query('SELECT thumbnail_url FROM projects WHERE user_id = $1 AND thumbnail_url IS NOT NULL', [id]);
    const publicIds = [];
    for (const row of projectsRes.rows) {
      if (row.thumbnail_url) {
        const parts = row.thumbnail_url.split('/');
        const lastPart = parts[parts.length - 1];
        const pubId = lastPart.split('.')[0];
        if (pubId) publicIds.push(pubId);
      }
    }

    if (publicIds.length > 0) {
      try {
        await cloudinary.api.delete_resources(publicIds);
      } catch (e) {
        console.warn('[Cloudinary Delete Warning]', e.message);
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('[admin.deleteUser]', err.message);
    res.status(500).json({ success: false, message: 'Server error deleting user.' });
  }
};

const getProjects = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const { search, status = 'all', sort = 'newest', userId } = req.query;

    const params = [];
    let whereClause = 'WHERE 1=1';

    if (status && status !== 'all') {
      params.push(status);
      whereClause += ` AND p.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    if (userId) {
      params.push(userId);
      whereClause += ` AND p.user_id = $${params.length}`;
    }

    let orderClause = 'ORDER BY p.created_at DESC';
    if (sort === 'oldest') orderClause = 'ORDER BY p.created_at ASC';
    if (sort === 'most_liked') orderClause = 'ORDER BY like_count DESC, p.created_at DESC';
    if (sort === 'most_viewed') orderClause = 'ORDER BY p.view_count DESC, p.created_at DESC';

    const countQuery = `SELECT COUNT(*) FROM projects p ${whereClause}`;
    const countRes = await pool.query(countQuery, params);
    const total = Number.parseInt(countRes.rows[0].count, 10);

    const queryParams = [...params, limit, offset];
    const dataQuery = `
      SELECT p.*, 
        json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'profile_pic', u.profile_pic, 'role', u.role) AS author,
        u.name AS author_name, u.id AS author_id,
        COALESCE(l.like_count, 0)::int AS like_count,
        COALESCE(t.tag_list, '{}') AS tag_list,
        COALESCE(t.tag_list, '{}') AS tags
      FROM projects p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS like_count FROM likes GROUP BY project_id) l ON l.project_id = p.id
      LEFT JOIN (SELECT project_id, array_agg(tag) AS tag_list FROM project_tags GROUP BY project_id) t ON t.project_id = p.id
      ${whereClause}
      ${orderClause}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const dataRes = await pool.query(dataQuery, queryParams);

    res.json({
      success: true,
      projects: dataRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1
    });
  } catch (err) {
    console.error('[admin.getProjects]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching projects.' });
  }
};

const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const projRes = await pool.query('SELECT title, user_id, thumbnail_url FROM projects WHERE id = $1', [id]);
    if (!projRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const { title, user_id: authorId, thumbnail_url } = projRes.rows[0];

    if (thumbnail_url) {
      try {
        const parts = thumbnail_url.split('/');
        const lastPart = parts[parts.length - 1];
        const pubId = lastPart.split('.')[0];
        if (pubId) await cloudinary.api.delete_resources([pubId]);
      } catch (e) {
        console.warn('[Cloudinary Delete Warning]', e.message);
      }
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);

    try {
      await pool.query(
        `INSERT INTO notifications (recipient_id, actor_id, type, message)
         VALUES ($1, $2, 'admin_delete', $3)`,
        [authorId, req.user ? req.user.id : null, `An admin deleted your project "${title}".`]
      );
    } catch (notifErr) {
      console.warn('[Admin Delete Notification Warning]', notifErr.message);
    }

    emitter.emit('admin.project.removed', { projectTitle: title, authorId });

    res.json({ success: true, message: 'Project deleted successfully.' });
  } catch (err) {
    console.error('[admin.deleteProject]', err.message);
    res.status(500).json({ success: false, message: 'Server error deleting project.' });
  }
};

const updateProject = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { title, description, github_url, demo_url, tech_stack, status, tags } = req.body;
    const existingRes = await client.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!existingRes.rows.length) {
      client.release();
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    const existing = existingRes.rows[0];

    const newTitle = (title !== undefined && title !== null) ? String(title).trim() : existing.title;
    if (!newTitle) {
      client.release();
      return res.status(422).json({ success: false, message: 'Title is required.' });
    }

    if (status !== undefined && status !== null && status !== 'published' && status !== 'draft' && status !== 'hidden') {
      client.release();
      return res.status(422).json({ success: false, message: 'Status must be published, draft, or hidden.' });
    }
    const newStatus = (status !== undefined && status !== null) ? status : existing.status;
    const newDesc = (description !== undefined && description !== null) ? description : existing.description;
    const newGithub = github_url !== undefined ? (github_url || null) : existing.github_url;
    const newDemo = demo_url !== undefined ? (demo_url || null) : existing.demo_url;

    let techStackJson = existing.tech_stack;
    if (tech_stack !== undefined && tech_stack !== null) {
      if (Array.isArray(tech_stack)) {
        techStackJson = JSON.stringify(tech_stack);
      } else if (typeof tech_stack === 'string') {
        try {
          JSON.parse(tech_stack);
          techStackJson = tech_stack;
        } catch {
          techStackJson = JSON.stringify(tech_stack.split(',').map(s => s.trim()).filter(Boolean));
        }
      }
    } else {
      techStackJson = JSON.stringify(techStackJson || []);
    }

    let tagArray = null;
    if (tags !== undefined && tags !== null) {
      if (Array.isArray(tags)) {
        tagArray = tags;
      } else if (typeof tags === 'string') {
        try {
          tagArray = JSON.parse(tags);
        } catch {
          tagArray = tags.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE projects SET title = $1, description = $2, github_url = $3, demo_url = $4, tech_stack = $5, status = $6, updated_at = NOW()
       WHERE id = $7`,
      [newTitle, newDesc || '', newGithub, newDemo, techStackJson, newStatus, id]
    );

    if (tagArray !== null) {
      await client.query('DELETE FROM project_tags WHERE project_id = $1', [id]);
      for (const t of tagArray) {
        if (t && typeof t === 'string' && t.trim()) {
          await client.query('INSERT INTO project_tags (project_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, t.trim()]);
        }
      }
    }

    try {
      if (newStatus !== existing.status) {
        const notifType = newStatus === 'hidden' ? 'admin_hide' : 'admin_edit';
        const msg = newStatus === 'hidden'
          ? `An admin hid your project "${newTitle}" from public view.`
          : `An admin changed your project "${newTitle}" status to ${newStatus}.`;
        await client.query(
          `INSERT INTO notifications (recipient_id, actor_id, project_id, type, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [existing.user_id, req.user ? req.user.id : null, id, notifType, msg]
        );
      } else {
        await client.query(
          `INSERT INTO notifications (recipient_id, actor_id, project_id, type, message)
           VALUES ($1, $2, $3, 'admin_edit', $4)`,
          [existing.user_id, req.user ? req.user.id : null, id, `An admin edited details of your project "${newTitle}".`]
        );
      }
    } catch (notifErr) {
      console.warn('[Admin Update Notification Warning]', notifErr.message);
    }

    await client.query('COMMIT');

    const updatedRes = await pool.query(
      `SELECT p.*, u.name AS author_name, u.profile_pic AS author_pic, u.student_id,
              COALESCE(l.like_count, 0)::int AS like_count,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT pt.tag), NULL) AS tags
       FROM projects p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN (SELECT project_id, COUNT(*) AS like_count FROM likes GROUP BY project_id) l ON p.id = l.project_id
       LEFT JOIN project_tags pt ON p.id = pt.project_id
       WHERE p.id = $1
       GROUP BY p.id, u.name, u.profile_pic, u.student_id, l.like_count`,
      [id]
    );

    res.json({ success: true, project: updatedRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin.updateProject]', err.message);
    res.status(500).json({ success: false, message: 'Server error updating project.' });
  } finally {
    client.release();
  }
};

const addProjectForStudent = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, title, description, github_url, demo_url, tech_stack, tags, status } = req.body;

    if (!userId) {
      return res.status(422).json({ success: false, message: 'User ID is required.' });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!userRes.rows.length || userRes.rows[0].role !== 'student') {
      return res.status(422).json({ success: false, message: 'Target user must be an existing student.' });
    }

    const targetUser = userRes.rows[0];
    let thumbnail_url = null;

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'uok-connect/thumbnails', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(req.file.buffer);
      });
      thumbnail_url = result.secure_url;
    }

    let techStackJson = '[]';
    let tagArray = [];
    try {
      techStackJson = JSON.stringify(Array.isArray(tech_stack) ? tech_stack : JSON.parse(tech_stack || '[]'));
      tagArray = Array.isArray(tags) ? tags : JSON.parse(tags || '[]');
    } catch (e) {
      console.warn('Invalid JSON in tech_stack or tags:', e.message);
    }

    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO projects (user_id, title, description, thumbnail_url, github_url, demo_url, tech_stack, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [targetUser.id, title, description || '', thumbnail_url, github_url || null, demo_url || null, techStackJson, status || 'published']
    );

    const project = insertResult.rows[0];

    if (tagArray.length) {
      for (const t of tagArray) {
        if (t && typeof t === 'string' && t.trim()) {
          await client.query('INSERT INTO project_tags (project_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [project.id, t.trim()]);
        }
      }
    }

    await client.query('COMMIT');

    emitter.emit('project.created', { project, userId: targetUser.id });
    emitter.emit('ProjectCreated', { project, user: targetUser });

    res.status(201).json({ success: true, project });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin.addProjectForStudent]', err.message);
    res.status(500).json({ success: false, message: 'Server error creating project.' });
  } finally {
    client.release();
  }
};

const globalSearch = async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q || q.trim().length < 1) {
      return res.json({ success: true, users: [], projects: [], searchResults: { users: [], projects: [] } });
    }

    const searchParam = `%${q.trim()}%`;

    const [usersRes, projectsRes] = await Promise.all([
      pool.query(`
        SELECT id, name, email, role, profile_pic FROM users 
        WHERE name ILIKE $1 OR email ILIKE $1 OR student_id ILIKE $1 LIMIT 5
      `, [searchParam]),
      pool.query(`
        SELECT p.id, p.title, p.thumbnail_url, p.status, u.id AS author_id, u.name AS author_name 
        FROM projects p JOIN users u ON p.user_id = u.id
        WHERE p.title ILIKE $1 OR p.description ILIKE $1 LIMIT 5
      `, [searchParam])
    ]);

    const results = {
      users: usersRes.rows,
      projects: projectsRes.rows
    };

    res.json({
      success: true,
      ...results,
      searchResults: results
    });
  } catch (err) {
    console.error('[admin.globalSearch]', err.message);
    res.status(500).json({ success: false, message: 'Server error during search.' });
  }
};

const getAdminNotifications = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.name AS actor_name, u.profile_pic AS actor_pic
      FROM notifications n
      LEFT JOIN users u ON n.actor_id = u.id
      WHERE n.recipient_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [req.user.id]);

    res.json({ success: true, notifications: result.rows });
  } catch (err) {
    console.error('[admin.getAdminNotifications]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching notifications.' });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND recipient_id = $2',
      [id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.markNotificationRead]', err.message);
    res.status(500).json({ success: false, message: 'Server error marking notification read.' });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true, read_at = NOW() WHERE recipient_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.markAllNotificationsRead]', err.message);
    res.status(500).json({ success: false, message: 'Server error marking notifications read.' });
  }
};

module.exports = {
  getStats,
  getUsers,
  getUserById,
  blockUser,
  deleteUser,
  getProjects,
  deleteProject,
  updateProject,
  addProjectForStudent,
  globalSearch,
  getAdminNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
