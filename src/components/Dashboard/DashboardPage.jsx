import React from 'react';
import { useNavigate } from 'react-router-dom'; // Ensure proper named import
import { useAuth } from '../../context/AuthContext';
import WorkflowDocuments from './WorkflowDocuments';
import WorkflowStates from './WorkflowStates';
import LastStateDocuments from './LastStateDocuments';
import logo from '../../assets/logo.png'; // Add your logo image here

const DashboardPage = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-blue-500 text-white py-4 px-6 flex justify-between items-center">
                <div className="flex items-center space-x-4">
                    <img src={logo} alt="Logo" className="w-10" />
                    <h1 className="text-xl font-bold">Dashboard</h1>
                </div>
                <button
                    onClick={handleLogout}
                    className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-md"
                >
                    Logout
                </button>
            </header>
            <main className="p-6 space-y-6">
                <section>
                    <h3 className="text-lg font-bold mb-2">Workflow Documents (Template ID: 4)</h3>
                    <WorkflowDocuments workflowTemplateId={4} />
                </section>
                <section>
                    <h3 className="text-lg font-bold mb-2">Workflow States (Template ID: 4)</h3>
                    <WorkflowStates workflowTemplateId={4} />
                </section>
                <section>
                    <h3 className="text-lg font-bold mb-2">Last State Documents (Template ID: 4)</h3>
                    <LastStateDocuments workflowTemplateId={4} />
                </section>
            </main>
            <footer className="bg-gray-200 text-center py-4 text-sm text-gray-600">
                © 2025 Ministère du Budget - Direction des Systèmes d'Information
            </footer>
        </div>
    );
};

export default DashboardPage;