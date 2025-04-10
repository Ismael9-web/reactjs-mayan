import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const LastStateDocuments = ({ workflowTemplateId }) => {
    const [documents, setDocuments] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLastStateDocuments = async () => {
            setLoading(true);
            setError(null);
            try {
                const statesResponse = await api.get(`/workflow_templates/${workflowTemplateId}/states/`);
                const states = statesResponse.data.results || [];
                if (states.length > 0) {
                    const lastState = states.reduce((prev, current) => (prev.id > current.id ? prev : current));
                    const documentsResponse = await api.get(`/workflow_templates/${workflowTemplateId}/states/${lastState.id}/documents/`);
                    setDocuments(documentsResponse.data.results || []);
                } else {
                    setDocuments([]);
                }
            } catch (err) {
                console.error('Erreur lors de la récupération des documents :', err);
                setError('Erreur lors de la récupération des documents.');
                setDocuments([]);
            } finally {
                setLoading(false);
            }
        };
        fetchLastStateDocuments();
    }, [workflowTemplateId]);

    if (loading) return <p>Chargement...</p>;
    if (error) return <p>Erreur : {error}</p>;

    return (
        <div>
            <h3>Documents dans le dernier état du flux de travail (ID du modèle : {workflowTemplateId})</h3>
            <ul>
                {documents.map((doc) => (
                    <li key={doc.id}>
                        {doc.title} (ID: {doc.id})
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default LastStateDocuments;
