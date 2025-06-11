import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import WorkflowDocuments from './WorkflowDocuments';
import logo from '../../assets/logo.png';
import Cookies from 'js-cookie';

const DashboardPage = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const authToken = Cookies.get('authToken');
        if (!authToken) {
            navigate('/login');
        }
    }, [navigate]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-gradient-to-r from-blue-500 to-purple-600 text-white py-4 px-6 flex justify-between items-center">
                <div className="flex items-center space-x-4">
                    <img src={logo} alt="Logo" className="w-10" />
                    <h1 className="text-2xl font-bold">Tableau de Bord</h1>
                </div>
                <button
                    onClick={handleLogout}
                    className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-md"
                >
                    Déconnexion
                </button>
            </header>
            <main className="p-6">
                <WorkflowDocuments />
            </main>
            <footer className="bg-gray-200 text-center py-4 text-sm text-gray-600">
                © 2025 Ministère du Budget - Direction des Systèmes d'Information
            </footer>
        </div>
    );
};

export default DashboardPage;