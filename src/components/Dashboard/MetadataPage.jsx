// Commented out the entire MetadataPage component for debugging purposes.
// import React, { useEffect, useState } from 'react';
// import api from '../../services/api';

// const MetadataPage = () => {
//     const [metadata, setMetadata] = useState([]);
//     const [loading, setLoading] = useState(true);
//     const [error, setError] = useState(null);

//     useEffect(() => {
//         const fetchMetadata = async () => {
//             try {
//                 const response = await api.get('/fetch-metadata');
//                 setMetadata(response.data);
//             } catch (err) {
//                 console.error('Error fetching metadata:', err);
//                 setError('Failed to fetch metadata.');
//             } finally {
//                 setLoading(false);
//             }
//         };

//         fetchMetadata();
//     }, []);

//     if (loading) return <p>Loading metadata...</p>;
//     if (error) return <p>Error: {error}</p>;

//     return (
//         <div className="p-6">
//             <h1 className="text-2xl font-bold mb-4">Document Metadata</h1>
//             {metadata.map((doc) => (
//                 <div key={doc.id} className="border p-4 mb-4 rounded shadow">
//                     <h2 className="text-xl font-semibold">Document ID: {doc.id}</h2>
//                     <p>Date Initial: {doc['Date-initial']}</p>
//                     <p>Date Fin: {doc['Date-fin']}</p>
//                     <p>Montant par Mois: {doc['Montant par Mois']}</p>
//                     <p>Motif Saisi: {doc['Motif-Saisi']}</p>
//                     <p>Nom Bénéficiaire: {doc['Nom-bénéficiaire']}</p>
//                     <p>Nom Employé: {doc['Nom-employé']}</p>
//                     <p>Relation Employé-Bénéficiaire: {doc['Relation-employé-bénéficiaire']}</p>
//                     <p>Fonction Employé: {doc['fonction-employé']}</p>
//                     <p>Total à Payer: {doc['total-à-payer']}</p>
//                 </div>
//             ))}
//         </div>
//     );
// };

// export default MetadataPage;