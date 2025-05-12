import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import api from '../../services/api';
import './WorkflowDocuments.css';

const WorkflowDocuments = () => {
    const [documents, setDocuments] = useState([]);
    const [metadata, setMetadata] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [showExpired, setShowExpired] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState(null);
    const [filterCriteria, setFilterCriteria] = useState({
        startDate: '',
        endDate: '',
        status: '',
    });
    const itemsPerPage = 5;

    const fetchDocuments = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.get('/api/documents', {
                params: {
                    keyword: searchQuery,
                    startDate: filterCriteria.startDate,
                    endDate: filterCriteria.endDate,
                    status: filterCriteria.status,
                },
            });
            setDocuments(response.data || []);
        } catch (err) {
            console.error('Error fetching documents:', err);
            setError('Failed to fetch documents.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, [searchQuery, filterCriteria]);

    const fetchMetadata = async (docId) => {
        try {
            const response = await api.get(`/documents/${docId}/metadata/`);
            return response.data.results.map((item) => ({
                label: item.metadata_type.label,
                value: item.value,
            }));
        } catch (err) {
            console.error(`Error fetching metadata for document ID ${docId}:`, err);
            return [];
        }
    };

    useEffect(() => {
        const fetchAllMetadata = async () => {
            const allMetadata = await Promise.all(
                documents.map(async (doc) => {
                    const docMetadata = await fetchMetadata(doc.id);
                    return { id: doc.id, metadata: docMetadata };
                })
            );
            setMetadata(allMetadata);
        };

        if (documents.length > 0) {
            fetchAllMetadata();
        }
    }, [documents]);

    const formatDate = (date) => {
        const parsedDate = new Date(date);
        return isNaN(parsedDate) ? date : parsedDate.toLocaleDateString('fr-FR');
    };

    const isDateExpired = (date) => {
        const parsedDate = new Date(date);
        if (isNaN(parsedDate)) return false; // Treat invalid dates as non-expired
        const today = new Date();
        return parsedDate < today;
    };

    const filteredMetadata = metadata.filter((doc) =>
        doc.metadata.some((item) =>
            item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.value.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    const paginatedMetadata = filteredMetadata.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const totalPages = Math.ceil(filteredMetadata.length / itemsPerPage);

    const handleDownloadPDF = () => {
        const doc = new jsPDF();
        const today = new Date();
        const monthYear = today.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        doc.text('Direction Générale de la Trésorerie Nationale', 10, 30);
        doc.text(`Date de téléchargement : ${today.toLocaleDateString()}`, 10, 20);
        doc.text('Liste de bénéficiaire de la pension alimentaire', 10, 10);
        doc.text(`Mois/Année : ${monthYear}`, 10, 40);

        let y = 50;
        metadata.forEach((docItem) => {
            const hasExpiredDate = docItem.metadata.some(
                (item) => item.label === 'Date-fin' && isDateExpired(item.value)
            );

            if (!hasExpiredDate) {
                doc.text(`Document ID: ${docItem.id}`, 10, y);
                y += 10;
                docItem.metadata.forEach((item) => {
                    const value = item.label === 'Date-fin' || item.label === 'Date-initial' ? formatDate(item.value) : item.value;
                    doc.text(`${item.label}: ${value}`, 10, y);
                    y += 10;
                    if (y > 280) {
                        doc.addPage();
                        y = 10;
                    }
                });
                y += 10;
            }
        });

        doc.save(`Liste_de_beneficiaire_${monthYear}.pdf`);
    };

    const hasExpiredDates = metadata.some((doc) =>
        doc.metadata.some((item) => item.label === 'Date-fin' && isDateExpired(item.value))
    );

    if (loading) return <p>Chargement...</p>;
    if (error) return <p>Erreur : {error}</p>;

    return (
        <div className="workflow-documents-container">
            <h3 className="workflow-documents-title">Liste de bénéficiaire de la pension alimentaire</h3>
            <div className="workflow-documents-content">
                <div className="p-6 bg-gray-100 min-h-screen">
                    <div className="flex justify-between items-center mb-4">
                        <input
                            type="text"
                            placeholder="Rechercher..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="border border-gray-300 rounded-md py-2 px-4 w-1/2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={handleDownloadPDF}
                            className="bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400"
                        >
                            Télécharger PDF
                        </button>
                        {hasExpiredDates && (
                            <button
                                onClick={() => setShowExpired((prev) => !prev)}
                                className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                {showExpired ? 'Masquer les valeurs expirées' : 'Afficher les valeurs expirées'}
                            </button>
                        )}
                    </div>
                    <table className="table-auto border-collapse border border-gray-300 w-full shadow-md rounded-md">
                        <thead className="bg-blue-500 text-white sticky top-0">
                            <tr>
                                {metadata[0]?.metadata.map((item, index) => (
                                    <th key={index} className="border border-gray-300 px-4 py-2 text-center">
                                        {item.label}
                                    </th>
                                ))}
                                <th className="border border-gray-300 px-4 py-2 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedMetadata.map((doc) => {
                                const isRowExpired = doc.metadata.some((item) => item.label === 'Date-fin' && isDateExpired(item.value));
                                if (isRowExpired && !showExpired) return null;
                                return (
                                    <tr key={doc.id} className={`hover:bg-gray-100 ${isRowExpired ? 'bg-red-100' : ''}`}>
                                        {doc.metadata.map((item, index) => (
                                            <td
                                                key={index}
                                                className="border border-gray-300 px-4 py-2 text-center"
                                            >
                                                {item.label === 'Date-fin' || item.label === 'Date-initial' ? formatDate(item.value) : item.value}
                                            </td>
                                        ))}
                                        <td className="border border-gray-300 px-4 py-2 text-center">
                                            <button
                                                onClick={() => setSelectedDocument(doc)}
                                                className="bg-blue-500 text-white py-1 px-3 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                            >
                                                Voir détails
                                            </button>
                                            {isRowExpired && (
                                                <p className="text-red-500 text-sm mt-2">Cette personne n'est plus bénéficiaire de pension car la date a expirée.</p>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="flex justify-between items-center mt-4">
                        <button
                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="bg-blue-500 text-white py-2 px-4 rounded-md disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                            Précédent
                        </button>
                        <span>Page {currentPage} sur {totalPages}</span>
                        <button
                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="bg-blue-500 text-white py-2 px-4 rounded-md disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                            Suivant
                        </button>
                    </div>

                    {selectedDocument && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center">
                            <div className="bg-white p-6 rounded-md shadow-md w-1/2">
                                <h3 className="text-xl font-bold mb-4">Détails du document (ID: {selectedDocument.id})</h3>
                                <ul>
                                    {selectedDocument.metadata.map((item, index) => (
                                        <li key={index} className="mb-2">
                                            <strong>{item.label}:</strong> {item.label === 'Date-fin' || item.label === 'Date-initial' ? formatDate(item.value) : item.value}
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => setSelectedDocument(null)}
                                    className="bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 mt-4"
                                >
                                    Fermer
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WorkflowDocuments;