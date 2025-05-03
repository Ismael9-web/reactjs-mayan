// Commented out the entire WorkflowStates component for debugging purposes.
// import React, { useEffect, useState } from 'react';
// import axios from 'axios';

// const WorkflowStates = ({ workflowTemplateId }) => {
//     const [states, setStates] = useState([]);
//     const [loading, setLoading] = useState(true);
//     const [error, setError] = useState(null);

//     useEffect(() => {
//         const fetchStates = async () => {
//             setLoading(true);
//             setError(null);
//             try {
//                 const response = await axios.get(`/api/v4/workflow_templates/${workflowTemplateId}/states/`); // Added trailing slash
//                 if (response.status === 200) {
//                     setStates(response.data.results || []);
//                 } else {
//                     throw new Error(`Unexpected response status: ${response.status}`);
//                 }
//             } catch (err) {
//                 console.error('Error fetching workflow states:', err);
//                 setError('Erreur : Impossible de récupérer les états du workflow.');
//             } finally {
//                 setLoading(false);
//             }
//         };

//         fetchStates();
//     }, [workflowTemplateId]);

//     if (loading) return <p>Chargement des états...</p>;
//     if (error) return <p>Erreur : {error}</p>;

//     return (
//         <div>
//             <h3>États du Workflow</h3>
//             <ul>
//                 {states.map((state) => (
//                     <li key={state.id}>
//                         {state.label} (ID : {state.id})
//                     </li>
//                 ))}
//             </ul>
//         </div>
//     );
// };

// export default WorkflowStates;