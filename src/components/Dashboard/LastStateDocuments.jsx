// Commented out the entire LastStateDocuments component for debugging purposes.
// import React, { useState, useEffect } from 'react';
// import axios from 'axios';

// const LastStateDocuments = () => {
//     const [documents, setDocuments] = useState([]);
//     const [error, setError] = useState(null);
//     const [loading, setLoading] = useState(true);

//     useEffect(() => {
//         const fetchLastStateDocuments = async () => {
//             setLoading(true);
//             setError(null);
//             try {
//                 const token = process.env.NEXT_PUBLIC_API_TOKEN;
//                 const sessionid = process.env.NEXT_PUBLIC_SESSION_ID;
//                 const headers = {
//                     'Authorization': `Bearer ${token}`,
//                     'Cookie': `sessionid=${sessionid}`
//                 };

//                 const statesResponse = await axios.get(`/api/v4/workflow_templates/1/states/`, { headers });
//                 const states = statesResponse.data.results || [];
//                 if (states.length > 0) {
//                     const lastState = states.reduce((prev, current) => (prev.id > current.id ? prev : current));
//                     const documentsResponse = await axios.get(`/api/v4/workflow_templates/1/states/3/documents/`, { headers });
//                     setDocuments(documentsResponse.data.results || []);
//                 } else {
//                     setDocuments([]);
//                 }
//             } catch (err) {
//                 console.error('Error fetching last state documents:', err);
//                 setError('Erreur : Impossible de récupérer les documents du dernier état.');
//             } finally {
//                 setLoading(false);
//             }
//         };

//         fetchLastStateDocuments();
//     }, []);

//     if (loading) return <p>Chargement...</p>;
//     if (error) return <p>Erreur : {error}</p>;

//     return (
//         <div>
//             <h3>Documents dans le dernier état du flux de travail (ID du modèle : 1)</h3>
//             <ul>
//                 {documents.map((doc) => (
//                     <li key={doc.id}>
//                         {doc.label} (ID : {doc.id})
//                     </li>
//                 ))}
//             </ul>
//         </div>
//     );
// };

// export default LastStateDocuments;
