import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiUsers, FiFolder, FiUserPlus, FiUserCheck, FiX, FiEdit3, FiImage, FiCheck } from 'react-icons/fi';
import toast from 'react-hot-toast';
import api from '../services/api';
import useAuthStore from '../store/authStore';
import ProjectCard from '../components/ProjectCard';

export default function ProfilePage() {
  const { id } = useParams();
  const { user, fetchMe } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [projects, setProjects] = useState([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Follow Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalUsers, setModalUsers] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  // Edit Profile Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', student_id: '' });
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/users/${id}`),
      api.get(`/users/${id}/projects`),
    ]).then(([profileRes, projectsRes]) => {
      setProfile(profileRes.data.user);
      setFollowing(profileRes.data.user.is_following || false);
      setProjects(projectsRes.data.projects);
    }).catch(() => toast.error('Could not load profile.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleFollow = async () => {
    if (!user) { toast.error('Sign in to follow users.'); return; }
    try {
      const res = await api.post(`/users/${id}/follow`);
      setFollowing(res.data.following);
      setProfile(prev => ({
        ...prev,
        follower_count: prev.follower_count + (res.data.following ? 1 : -1)
      }));
      toast.success(res.data.message);
    } catch {
      toast.error('Could not update follow.');
    }
  };

  const openFollowModal = async (type) => {
    setModalOpen(true);
    setModalTitle(type === 'followers' ? 'Followers' : 'Following');
    setModalLoading(true);
    try {
      const res = await api.get(`/users/${id}/${type}`);
      setModalUsers(res.data[type]);
    } catch {
      toast.error(`Could not load ${type}.`);
    } finally {
      setModalLoading(false);
    }
  };

  const openEditModal = () => {
    setEditForm({
      name: profile.name || '',
      student_id: profile.student_id || ''
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditSubmitting(true);
    try {
      const res = await api.put('/users/profile', editForm);
      setProfile(prev => ({ ...prev, ...res.data.user }));
      fetchMe(); // Update global store
      setEditModalOpen(false);
      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setEditSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!profile) return null;

  const isOwner = user && user.id === Number.parseInt(id, 10);
  const isStudent = profile.role === 'student';

  return (
    <div className="min-h-screen pt-24 pb-20 bg-gray-50/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative bg-white border border-gray-200/60 rounded-3xl shadow-sm overflow-hidden mb-12"
        >
          {/* Banner */}
          <div className="h-32 sm:h-48 bg-gradient-to-r from-green-600 to-emerald-400 w-full" />
          
          <div className="px-6 sm:px-10 pb-8 relative">
            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-end -mt-16 sm:-mt-20 mb-6">
              {profile.profile_pic ? (
                <img 
                  src={profile.profile_pic} 
                  alt={profile.name} 
                  className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl object-cover border-4 border-white shadow-md flex-shrink-0 bg-white" 
                />
              ) : (
                <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl bg-green-50 flex items-center justify-center text-5xl font-bold text-green-700 border-4 border-white shadow-md flex-shrink-0">
                  {profile.name?.[0]?.toUpperCase()}
                </div>
              )}
              
              <div className="flex-1 w-full flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{profile.name}</h1>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 capitalize border border-gray-200">
                      {profile.role}
                    </span>
                  </div>
                  {isStudent && profile.student_id && (
                    <p className="text-emerald-600 font-medium text-sm mt-1">{profile.student_id}</p>
                  )}
                  {profile.email && <p className="text-gray-500 text-sm mt-1">{profile.email}</p>}
                </div>
                
                <div className="flex items-center gap-3">
                  {isOwner && (
                    <button
                      onClick={openEditModal}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 transition-all shadow-sm"
                    >
                      <FiEdit3 size={16} /> Edit Profile
                    </button>
                  )}
                  {!isOwner && user && (
                    <button
                      onClick={handleFollow}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                        following
                          ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600 border border-gray-200 hover:border-red-200'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {following ? <><FiUserCheck size={16} /> Following</> : <><FiUserPlus size={16} /> Follow</>}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm text-gray-600 border-t border-gray-100 pt-6">
              {isStudent && (
                <span className="flex items-center gap-2">
                  <FiFolder className="text-gray-400" size={16} /> 
                  <span className="font-semibold text-gray-900">{profile.project_count}</span> projects
                </span>
              )}
              <button 
                onClick={() => openFollowModal('followers')}
                className="flex items-center gap-2 hover:text-emerald-600 transition-colors group"
              >
                <FiUsers className="text-gray-400 group-hover:text-emerald-500 transition-colors" size={16} /> 
                <span className="font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors">{profile.follower_count}</span> followers
              </button>
            </div>
          </div>
        </motion.div>

        {/* Projects section - mostly for students or users with projects */}
        {(isStudent || projects.length > 0) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <h2 className="text-xl font-bold text-gray-900 mb-6">Projects</h2>
            {projects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((p, i) => <ProjectCard key={p.id} project={p} index={i} />)}
              </div>
            ) : (
              <div className="text-center py-20 bg-white border border-gray-200/60 rounded-3xl shadow-sm">
                <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FiFolder size={24} className="text-gray-400" />
                </div>
                <h3 className="text-gray-900 font-semibold mb-1">No projects yet</h3>
                <p className="text-gray-500 text-sm">When {isOwner ? 'you publish' : `${profile.name} publishes`} projects, they will appear here.</p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-100"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-gray-900 text-lg">Edit Profile</h3>
              <button 
                onClick={() => setEditModalOpen(false)} 
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                <FiX size={20} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all"
                  placeholder="Your full name"
                />
              </div>

              {isStudent && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Student ID
                  </label>
                  <input
                    type="text"
                    value={editForm.student_id}
                    onChange={e => setEditForm({ ...editForm, student_id: e.target.value })}
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all"
                    placeholder="e.g. 2020/CS/001"
                  />
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={editSubmitting || !editForm.name.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold rounded-xl transition-all text-sm shadow-sm hover:shadow"
                >
                  {editSubmitting ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><FiCheck size={16} /> Save Changes</>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Followers/Following Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-gray-900">{modalTitle}</h3>
              <button 
                onClick={() => setModalOpen(false)} 
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                <FiX size={20} />
              </button>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {modalLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : modalUsers.length > 0 ? (
                <div className="p-2">
                  {modalUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-2xl transition-colors">
                      <Link to={`/profile/${u.id}`} onClick={() => setModalOpen(false)} className="flex-shrink-0">
                        {u.profile_pic ? (
                          <img src={u.profile_pic} alt={u.name} className="w-12 h-12 rounded-xl object-cover border border-gray-200" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-green-700 font-bold text-lg border border-green-100">
                            {u.name?.[0]?.toUpperCase()}
                          </div>
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link to={`/profile/${u.id}`} onClick={() => setModalOpen(false)} className="font-semibold text-sm text-gray-900 hover:text-green-600 transition-colors truncate block">
                          {u.name}
                        </Link>
                        <p className="text-xs text-gray-500 capitalize mt-0.5">{u.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <FiUsers className="text-gray-400" size={20} />
                  </div>
                  <p className="text-sm text-gray-500">No users found.</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
