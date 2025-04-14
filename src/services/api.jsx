import axios from 'axios';

const API_BASE_URL = 'http://localhost/api/v4'; // Ajuster l'URL de base

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
            config.headers['Authorization'] = `Token ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

export default api;