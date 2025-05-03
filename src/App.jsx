import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './components/Auth/LoginPage';
import DashboardPage from './components/Dashboard/DashboardPage';
import MetadataPage from './components/Dashboard/MetadataPage';
import './App.css';

const App = () => {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} /> {/* Default route */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/metadata" element={<MetadataPage />} />
            <Route path="*" element={<div>404 - Page Not Found</div>} /> {/* Fallback route */}
        </Routes>
    );
};

export default App;

