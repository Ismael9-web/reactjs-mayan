import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import './WorkflowDocuments.css';

const WorkflowDocuments = () => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchDocumentsWithMetadata = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await api.get('/documents_with_metadata');
                setDocuments(response.data);
            } catch (err) {
                console.error('Error fetching documents with metadata:', err);
                setError('Failed to fetch documents with metadata.');
            } finally {
                setLoading(false);
            }
        };

        fetchDocumentsWithMetadata();
    }, []);

    if (loading) return <p>Loading documents...</p>;
    if (error) return <p>{error}</p>;

    return (
        <div className="workflow-documents-container">
            <h3>Documents with Metadata</h3>
            <ul>
                {documents.map((doc) => (
                    <li key={doc.id} className="document-item">
                        <h4>{doc.label}</h4>
                        <p>Created: {new Date(doc.datetime_created).toLocaleString()}</p>
                        <h5>Metadata:</h5>
                        <ul>
                            {doc.metadata.map((meta, index) => (
                                <li key={index}>
                                    <strong>{meta.metadata_type.label}:</strong> {meta.value}
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default WorkflowDocuments;