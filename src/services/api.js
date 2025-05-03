import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
    baseURL: 'http://localhost/api/v4/', // Backend base URL
    // withCredentials: true, // Ensure cookies and credentials are sent with requests
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // 'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFTOKEN': Cookies.get('csrftoken'), // CSRF token for Django
    },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get('authToken');
  if (token) {
    config.headers.Authorization = `Token ${token}`;
    // config.headers.Cookies = Cookies.get('sessionid');
    // config.headers.set.Cookies.headers = {csrftoken :Cookies.get('csrftoken')};

  }
  // config.params = config.params || {}; // Ensure params is initialized
  // config.params = {"workflow_template_id" : 1, "workflow_template_state_id" : 3 }; // Add request params
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access (e.g., redirect to login)
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
