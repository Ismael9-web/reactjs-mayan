
import React, { createContext, useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  // Login: use /api/login to get token, sessionid, csrftoken (all set as cookies by backend)
  const login = async (username, password) => {
    try {
      const response = await api.post('/login', { username, password });
      // Cookies are set by backend (authToken, sessionid, csrftoken)
      setIsAuthenticated(true);
      navigate('/dashboard');
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const logout = () => {
    // Remove all auth cookies
    Cookies.remove('authToken');
    Cookies.remove('sessionid');
    Cookies.remove('csrftoken');
    setIsAuthenticated(false);
  };

  // For requests, cookies are sent automatically by axios (withCredentials: true)
  // If you need to manually get CSRF/session, use:
  const getAuthCookies = () => {
    return {
      authToken: Cookies.get('authToken'),
      sessionid: Cookies.get('sessionid'),
      csrftoken: Cookies.get('csrftoken'),
    };
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, getAuthCookies }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);