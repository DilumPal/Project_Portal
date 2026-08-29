const pool = require('../config/db');

const getPublicStats = async (req, res) => {
  try {
    const usersRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE role = 'student')   AS total_students,
        COUNT(*) FILTER (WHERE role = 'recruiter') AS total_recruiters
      FROM users;
    `);

    const projectsRes = await pool.query(`
      SELECT COUNT(*) AS total_projects FROM projects WHERE status = 'published';
    `);
    
    // For connections, we can count rows in followers
    const connectionsRes = await pool.query(`
      SELECT COUNT(*) AS total_connections FROM followers;
    `);

    const u = usersRes.rows[0] || {};
    const p = projectsRes.rows[0] || {};
    const c = connectionsRes.rows[0] || {};

    res.json({
      success: true,
      stats: {
        totalProjects: Number.parseInt(p.total_projects || 0, 10),
        totalStudents: Number.parseInt(u.total_students || 0, 10),
        totalCompanies: Number.parseInt(u.total_recruiters || 0, 10),
        totalConnections: Number.parseInt(c.total_connections || 0, 10),
      }
    });
  } catch (err) {
    console.error('[publicController.getPublicStats]', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching public stats.' });
  }
};

module.exports = { getPublicStats };
