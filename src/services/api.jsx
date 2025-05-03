import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: 'http://localhost/api/v4/', // Point to the Express.js backend
  withCredentials: true, // Ensure cookies and credentials are sent with requests
});

api.interceptors.request.use(
  (config) => {
    const token = Cookies.get('authToken');
    const sessionId = Cookies.get('sessionId');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    if (sessionId) {
      config.headers['Cookie'] = sessionId;
    }
    return config;
  },
  (error) => {
    console.error('Request Error:', error.message);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Response Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    return Promise.reject(error);
  }
);

export default api;
