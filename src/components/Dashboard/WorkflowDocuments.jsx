import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const WorkflowDocuments = () => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const documentsPerPage = 5;

    useEffect(() => {
        const fetchDocumentsWithMetadata = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await api.get('/documents_with_metadata');
                setDocuments(response.data);
            } catch (err) {
                console.error('Error fetching documents with metadata:', err);
                setError('Échec du chargement des documents avec métadonnées.');
            } finally {
                setLoading(false);
            }
        };

        fetchDocumentsWithMetadata();
    }, []);

    const indexOfLastDocument = currentPage * documentsPerPage;
    const indexOfFirstDocument = indexOfLastDocument - documentsPerPage;
    const currentDocuments = documents.slice(indexOfFirstDocument, indexOfLastDocument);

    const paginate = (pageNumber) => setCurrentPage(pageNumber);

    if (loading) return <p>Chargement des documents...</p>;
    if (error) return <p>{error}</p>;

    // Extract unique metadata keys for table columns
    const metadataKeys = Array.from(new Set(documents.flatMap(doc => doc.metadata.map(meta => meta.metadata_type.label))));

    return (
        <div className="p-4 bg-white shadow-md rounded-lg">
            <div className="mb-4">
                <h3 className="text-xl font-bold">Liste de Bénéficiaires de la Pension Alimentaire</h3>
            </div>
            <table className="w-full border-collapse border border-gray-300">
                <thead>
                    <tr className="bg-gray-200">
                        <th className="border border-gray-300 px-4 py-2">Nom</th>
                        <th className="border border-gray-300 px-4 py-2">Date de Création</th>
                        {metadataKeys.map((key, index) => (
                            <th key={index} className="border border-gray-300 px-4 py-2">{key}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {currentDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-100">
                            <td className="border border-gray-300 px-4 py-2">{doc.label}</td>
                            <td className="border border-gray-300 px-4 py-2">{new Date(doc.datetime_created).toLocaleString()}</td>
                            {metadataKeys.map((key, index) => (
                                <td key={index} className="border border-gray-300 px-4 py-2">
                                    {doc.metadata.find(meta => meta.metadata_type.label === key)?.value || '-'}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="flex justify-center mt-4">
                {Array.from({ length: Math.ceil(documents.length / documentsPerPage) }, (_, index) => (
                    <button
                        key={index}
                        onClick={() => paginate(index + 1)}
                        className={`px-3 py-1 mx-1 border rounded ${currentPage === index + 1 ? 'bg-blue-500 text-white' : 'bg-white text-blue-500'}`}
                    >
                        {index + 1}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default WorkflowDocuments;