import axios from 'axios';

const API_BASE_URL = 'http://localhost/api/v4'; // Ajuster l'URL de base

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
            config.headers['Authorization'] = `Token ${token}`; // Ou la manière dont votre API attend le jeton
            // Vous devrez peut-être également gérer le jeton CSRF différemment s'il est requis pour d'autres requêtes 
            // config.headers['X-CSRFTOKEN'] = 'VOTRE_JETON_CSRF'; // Réfléchir à la manière de l'obtenir
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

export default api;