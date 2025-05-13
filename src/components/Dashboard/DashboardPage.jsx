import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import WorkflowDocuments from './WorkflowDocuments';
import logo from '../../assets/logo.png';
import jsPDF from 'jspdf';
import Cookies from 'js-cookie';
import './DashboardPage.css';

const DashboardPage = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');

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

    const handleDownload = () => {
        const doc = new jsPDF();
        doc.text('Données des documents', 10, 10);
        doc.save('documents.pdf');
    };

    return (
        <div className="dashboard-container">
            <header className="bg-blue-500 text-white py-4 px-6 flex justify-between items-center">
                <div className="flex items-center space-x-4">
                    <img src={logo} alt="Logo" className="w-10" />
                    <h1 className="dashboard-title">Dashboard</h1>
                </div>
                <button
                    onClick={handleLogout}
                    className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-md"
                >
                    Déconnexion
                </button>
            </header>
            <main className="dashboard-content">
                <section>
                    <h3 className="text-lg font-bold mb-2">Workflow Documents</h3>
                    <WorkflowDocuments workflowTemplateId={1} workflowTemplateStateId={3} />
                </section>
                {/* Commented out for debugging purposes */}
                {/* <section>
                    <h3 className="text-lg font-bold mb-2">Workflow States</h3>
                    <WorkflowStates workflowTemplateId={1} />
                </section>
                <section>
                    <h3 className="text-lg font-bold mb-2">Last State Documents</h3>
                    <LastStateDocuments workflowTemplateId={1} />
                </section>
                <section>
                    <h3 className="text-lg font-bold mb-2">Metadata Page</h3>
                    <MetadataPage />
                </section> */}
            </main>
            <footer className="bg-gray-200 text-center py-4 text-sm text-gray-600">
                © 2025 Ministère du Budget - Direction des Systèmes d'Information
            </footer>
        </div>
    );
};

export default DashboardPage;