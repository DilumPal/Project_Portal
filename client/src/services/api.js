import axios from 'axios';

const ALLOWED_ORIGINS = [window.location.origin];

const isAbsoluteUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// Initialize allowlist with VITE_API_URL if applicable
const apiUrl = import.meta.env.VITE_API_URL;
if (isAbsoluteUrl(apiUrl)) {
  try {
    const apiOrigin = new URL(apiUrl).origin;
    if (!ALLOWED_ORIGINS.includes(apiOrigin)) {
      ALLOWED_ORIGINS.push(apiOrigin);
    }
  } catch (err) {
    console.warn('Could not parse VITE_API_URL origin:', err);
  }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Helper functions to break down logic
const getTargetUrl = (config) => {
  if (isAbsoluteUrl(config.url)) return new URL(config.url);
  if (isAbsoluteUrl(config.baseURL)) return new URL(config.url ?? '', config.baseURL);
  
  const base = new URL(config.baseURL ?? '/', window.location.origin);
  return new URL(config.url ?? '', base);
};

const validateRequestOrigin = (config) => {
  try {
    const targetUrl = getTargetUrl(config);
    if (!ALLOWED_ORIGINS.includes(targetUrl.origin)) {
      console.error(`Security violation: Blocked request to untrusted origin: ${targetUrl.origin}`);
      throw new Error(`Blocked request to untrusted origin: ${targetUrl.origin}`);
    }
  } catch (err) {
    if (err.message.includes('Blocked request')) throw err;
    console.error('Failed to parse request URL for validation:', err);
    throw new Error('Invalid request URL format.');
  }
};

api.interceptors.request.use((config) => {
  try {
    validateRequestOrigin(config);
    return config;
  } catch (err) {
    return Promise.reject(err);
  }
});

let refreshPromise = null;

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = api.post('/auth/refresh').finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const handleUnauthorizedError = async (err, originalRequest) => {
  // Return early if not a 401 error or if already retried
  if (err.response?.status !== 401 || originalRequest?._retry) {
    throw err;
  }

  // Use null-safe operators to check URL safely, return early if refresh failed
  if (originalRequest?.url?.includes('/auth/refresh')) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw err;
  }

  originalRequest._retry = true;

  try {
    await refreshAccessToken();
    return api(originalRequest);
  } catch (refreshError) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw refreshError;
  }
};

api.interceptors.response.use(
  (res) => res,
  (err) => handleUnauthorizedError(err, err.config)
);

export default api;
