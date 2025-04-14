import React, { createContext, useContext, useState } from 'react';
import api from '../services/api'; // Import the API service

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (username, password) => {
    try {
      const response = await api.post('http://localhost/api/v4/auth/token/obtain/', {
        username,
        password,
      });
      const token = response.data.auth_token;

      // Save the token to localStorage
      localStorage.setItem('authToken', token);

      // Set the user as authenticated
      setIsAuthenticated(true);

      return true; // Login successful
    } catch (error) {
      console.error('Login failed:', error);
      return false; // Login failed
    }
  };

  const logout = () => {
    // Remove the token from localStorage
    localStorage.removeItem('authToken');

    // Set the user as unauthenticated
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);