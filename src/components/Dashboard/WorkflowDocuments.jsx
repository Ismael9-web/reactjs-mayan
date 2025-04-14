import React, { useState, useEffect } from 'react';
import axios from 'axios';

const WorkflowDocuments = ({ workflowTemplateId }) => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchDocuments = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await axios.get(
                    `http://localhost/api/v4/workflow_templates/${workflowTemplateId}/documents/`,
                    {
                        headers: {
                            'accept': 'application/json',
                            'X-CSRFTOKEN': 'dK39VckuslJISC0Gz2otgRUdFvRb7712i4OYxCYJnDY3tgspmTa1h9LA15GSxvOj', // Replace with your actual CSRF token
                        },
                    }
                );
                setDocuments(response.data.results || []);
            } catch (err) {
                console.error('Error fetching workflow documents:', err);
                setError('Failed to fetch workflow documents.');
            } finally {
                setLoading(false);
            }
        };

        fetchDocuments();
    }, [workflowTemplateId]);

    if (loading) return <p>Loading documents...</p>;
    if (error) return <p>{error}</p>;

    return (
        <div>
            <h3>Workflow Documents</h3>
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

export default WorkflowDocuments;