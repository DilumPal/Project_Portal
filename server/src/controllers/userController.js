const pool = require('../config/db');
const emitter = require('../events/eventEmitter');

const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user ? req.user.id : null;
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.profile_pic, u.role, u.student_id, u.created_at,
              COUNT(DISTINCT p.id)::int AS project_count,
              COUNT(DISTINCT f.follower_id)::int AS follower_count,
              EXISTS(SELECT 1 FROM followers f2 WHERE f2.follower_id = $2 AND f2.following_id = u.id) AS is_following
       FROM users u
       LEFT JOIN projects p ON u.id = p.user_id AND p.status = 'published'
       LEFT JOIN followers f ON u.id = f.following_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [id, currentUserId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const userProfile = result.rows[0];
    const isOwnerOrAdmin = req.user && (req.user.id === Number.parseInt(id, 10) || req.user.role === 'admin');
    
    if (!isOwnerOrAdmin) {
      delete userProfile.email;
    }

    res.json({ success: true, user: userProfile });
  } catch (err) {
    console.error('[getUserProfile]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getUserProjects = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;

    const canViewDrafts = req.user && (req.user.id === Number.parseInt(id, 10) || req.user.role === 'admin');
    const statusCondition = canViewDrafts ? "" : " AND p.status = 'published'";

    const result = await pool.query(
      `SELECT p.*, COALESCE(l.like_count, 0)::int AS like_count,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT pt.tag), NULL) AS tags
       FROM projects p
       LEFT JOIN (SELECT project_id, COUNT(*) AS like_count FROM likes GROUP BY project_id) l
         ON p.id = l.project_id
       LEFT JOIN project_tags pt ON p.id = pt.project_id
       WHERE p.user_id = $1${statusCondition}
       GROUP BY p.id, l.like_count
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, Number.parseInt(limit, 10), offset]
    );

    res.json({ success: true, projects: result.rows });
  } catch (err) {
    console.error('[getUserProjects]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const followUser = async (req, res) => {
  try {
    const { id: followingId } = req.params;
    const followerId = req.user.id;

    if (Number.parseInt(followingId, 10) === followerId) {
      return res.status(400).json({ success: false, message: 'Cannot follow yourself.' });
    }

    const targetUser = await pool.query('SELECT * FROM users WHERE id = $1', [followingId]);
    if (!targetUser.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const existing = await pool.query(
      'SELECT id FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );

    if (existing.rows.length) {
      await pool.query(
        'DELETE FROM followers WHERE follower_id = $1 AND following_id = $2',
        [followerId, followingId]
      );
      return res.json({ success: true, following: false, message: 'Unfollowed.' });
    }

    await pool.query(
      'INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)',
      [followerId, followingId]
    );

    emitter.emit('UserFollowed', {
      following: targetUser.rows[0],
      follower: req.user,
    });

    res.json({ success: true, following: true, message: 'Following.' });
  } catch (err) {
    console.error('[followUser]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Admin: get all users
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, profile_pic, role, student_id, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error('[getAllUsers]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getFollowers = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user ? req.user.id : null;
    const result = await pool.query(
      `SELECT u.id, u.name, u.role, u.profile_pic,
              EXISTS(SELECT 1 FROM followers f2 WHERE f2.follower_id = $2 AND f2.following_id = u.id) AS is_following
       FROM users u
       JOIN followers f ON u.id = f.follower_id
       WHERE f.following_id = $1`,
      [id, currentUserId]
    );
    res.json({ success: true, followers: result.rows });
  } catch (err) {
    console.error('[getFollowers]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getFollowing = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user ? req.user.id : null;
    const result = await pool.query(
      `SELECT u.id, u.name, u.role, u.profile_pic,
              EXISTS(SELECT 1 FROM followers f2 WHERE f2.follower_id = $2 AND f2.following_id = u.id) AS is_following
       FROM users u
       JOIN followers f ON u.id = f.following_id
       WHERE f.follower_id = $1`,
      [id, currentUserId]
    );
    res.json({ success: true, following: result.rows });
  } catch (err) {
    console.error('[getFollowing]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, student_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }

    // Fetch user to check role
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const userRole = userResult.rows[0].role;

    if (userRole === 'student' && student_id) {
       const existing = await pool.query('SELECT id FROM users WHERE student_id = $1 AND id != $2', [student_id, userId]);
       if (existing.rows.length) {
         return res.status(400).json({ success: false, message: 'Student ID is already registered to another user.' });
       }
    }

    const finalStudentId = userRole === 'student' ? (student_id || null) : null;

    const result = await pool.query(
      `UPDATE users 
       SET name = $1, student_id = $2
       WHERE id = $3
       RETURNING id, name, email, profile_pic, role, student_id, created_at`,
      [name.trim(), finalStudentId, userId]
    );

    res.json({ success: true, message: 'Profile updated successfully.', user: result.rows[0] });
  } catch (err) {
    console.error('[updateProfile]', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getUserProfile, getUserProjects, followUser, getAllUsers, getFollowers, getFollowing, updateProfile };
