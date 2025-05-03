import React, { createContext, useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  const login = async (username, password) => {
    try {
      const response = await api.post('/auth/token/obtain/', { username, password });
      const { access } = response.data;
      const sessionIdHeader = response.headers['set-cookie'];

      // Save token and sessionId in cookies
      Cookies.set('authToken', access, { expires: 1 }); // Expires in 1 day
      Cookies.set('sessionId', sessionIdHeader, { expires: 1 });

      setIsAuthenticated(true);
      navigate('/dashboard');
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const logout = () => {
    Cookies.remove('authToken');
    Cookies.remove('sessionId');
    setIsAuthenticated(false);
  };

  const getAuthHeaders = () => {
    const authToken = Cookies.get('authToken');
    const sessionId = Cookies.get('sessionId');
    return {
      Authorization: `Bearer ${authToken}`,
      Cookie: sessionId,
    };
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);