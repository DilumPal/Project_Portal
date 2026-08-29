import axios from 'axios';

// 1. Define the allowlist of trusted origins
const ALLOWED_ORIGINS = [
  window.location.origin, // Allow requests to the same origin
];

// If VITE_API_URL is configured as an absolute URL, add its origin to the allowlist
const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl && /^https?:\/\//i.test(apiUrl)) {
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
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// 2. Request Interceptor for URL Allowlisting
api.interceptors.request.use((config) => {
  try {
    let targetUrl;
    // Determine the full URL of the request safely
    if (config.url && /^https?:\/\//i.test(config.url)) {
      targetUrl = new URL(config.url);
    } else if (config.baseURL && /^https?:\/\//i.test(config.baseURL)) {
      targetUrl = new URL(config.url || '', config.baseURL);
    } else {
      // Safely resolve relative URLs against the true window origin, 
      // ignoring potential manipulation of the <base> tag in HTML
      const base = new URL(config.baseURL || '/', window.location.origin);
      targetUrl = new URL(config.url || '', base);
    }

    // 3. Validate the full origin (scheme, host, and port) against the allowlist
    if (!ALLOWED_ORIGINS.includes(targetUrl.origin)) {
      console.error(`Security violation: Blocked request to untrusted origin: ${targetUrl.origin}`);
      return Promise.reject(new Error(`Blocked request to untrusted origin: ${targetUrl.origin}`));
    }
  } catch (err) {
    console.error('Failed to parse request URL for validation:', err);
    return Promise.reject(new Error('Invalid request URL format.'));
  }

  return config;
});

// Holds the in-flight refresh request (if any) so concurrent 401s share
// the same refresh call instead of racing each other. Using a shared
// promise (rather than a boolean flag + queue) avoids the race where two
// requests both see isRefreshing === false and both trigger a refresh.
let refreshPromise = null;

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url.includes('/auth/refresh')) {
        window.dispatchEvent(new CustomEvent('auth:expired'));
        return Promise.reject(err);
      }

      originalRequest._retry = true;

      try {
        await refreshAccessToken();
        return api(originalRequest);
      } catch (refreshError) {
        window.dispatchEvent(new CustomEvent('auth:expired'));
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(err);
  }
);

export default api;
