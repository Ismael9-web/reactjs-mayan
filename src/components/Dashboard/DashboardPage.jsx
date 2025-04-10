import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import WorkflowDocuments from './WorkflowDocuments';
import WorkflowStates from './WorkflowStates';
import LastStateDocuments from './LastStateDocuments'; // Importer le nouveau composant


const DashboardPage = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
  
    const DashboardPage = () => {
        const { logout } = useAuth();
        const navigate = useNavigate();
      
        const handleLogout = () => {
          logout();
          navigate('/login');
        };
      
        return (
          <div>
            <h2>Tableau de bord</h2>
            <button onClick={handleLogout}>Se déconnecter</button>
      
            <h3>Documents de flux de travail (ID du modèle : 4)</h3>
            <WorkflowDocuments workflowTemplateId={4} />
      
            <h3>États de flux de travail (ID du modèle : 4)</h3>
            <WorkflowStates workflowTemplateId={4} />
      
            <h3>Documents dans le dernier état du flux de travail (ID du modèle : 4)</h3>
            <LastStateDocuments workflowTemplateId={4} /> {/* Inclure le nouveau composant */}
          </div>
        );
      };
}
    export default DashboardPage;      