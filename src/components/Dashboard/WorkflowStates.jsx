import React, { useEffect, useState } from 'react';
import api from '../../services/api';

const WorkflowStates = ({ workflowTemplateId }) => {
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStates = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(`/workflow_templates/${workflowTemplateId}/states/`);
        setStates(response.data.results || []);
      } catch (err) {
        console.error('Error fetching workflow states:', err);
        setError('Failed to fetch states.');
      } finally {
        setLoading(false);
      }
    };

    fetchStates();
  }, [workflowTemplateId]);

  if (loading) return <p>Loading states...</p>;
  if (error) return <p>{error}</p>;

  return (
    <div>
      <h3>Workflow States</h3>
      <ul>
        {states.map((state) => (
          <li key={state.id}>{state.label} (ID: {state.id})</li>
        ))}
      </ul>
    </div>
  );
};

export default WorkflowStates;