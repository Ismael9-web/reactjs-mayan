import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const EXPIRY_METADATA_KEY = 'expiry_date'; // Change this if your expiry field is named differently

const WorkflowDocuments = () => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [filters, setFilters] = useState({});
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
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

    // Extract unique metadata keys for table columns
    const metadataKeys = useMemo(() =>
        Array.from(new Set(documents.flatMap(doc => doc.metadata.map(meta => meta.metadata_type.label))))
    , [documents]);

    // Filtering
    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        setCurrentPage(1);
    };
    const filteredDocuments = useMemo(() => {
        return documents.filter(doc => {
            // Filter by label and creation date
            if (filters.label && !doc.label.toLowerCase().includes(filters.label.toLowerCase())) return false;
            if (filters.datetime_created && !doc.datetime_created.includes(filters.datetime_created)) return false;
            // Filter by metadata
            for (const key of metadataKeys) {
                if (filters[key]) {
                    const metaValue = doc.metadata.find(meta => meta.metadata_type.label === key)?.value || '';
                    if (!metaValue.toLowerCase().includes(filters[key].toLowerCase())) return false;
                }
            }
            return true;
        });
    }, [documents, filters, metadataKeys]);

    // Sorting
    const sortedDocuments = useMemo(() => {
        if (!sortConfig.key) return filteredDocuments;
        return [...filteredDocuments].sort((a, b) => {
            let aValue, bValue;
            if (sortConfig.key === 'label') {
                aValue = a.label;
                bValue = b.label;
            } else if (sortConfig.key === 'datetime_created') {
                aValue = a.datetime_created;
                bValue = b.datetime_created;
            } else {
                aValue = a.metadata.find(meta => meta.metadata_type.label === sortConfig.key)?.value || '';
                bValue = b.metadata.find(meta => meta.metadata_type.label === sortConfig.key)?.value || '';
            }
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredDocuments, sortConfig]);

    // Pagination
    const indexOfLastDocument = currentPage * documentsPerPage;
    const indexOfFirstDocument = indexOfLastDocument - documentsPerPage;
    const currentDocuments = sortedDocuments.slice(indexOfFirstDocument, indexOfLastDocument);
    const totalPages = Math.ceil(sortedDocuments.length / documentsPerPage);
    const paginate = (pageNumber) => setCurrentPage(pageNumber);

    // PDF Export (exclude expired)
    const handleExportPDF = () => {
        const doc = new jsPDF();
        const today = new Date();
        const tableColumn = ['Nom', 'Date de Création', ...metadataKeys];
        const tableRows = sortedDocuments
            .filter(doc => {
                const expiry = doc.metadata.find(meta => meta.metadata_type.label === EXPIRY_METADATA_KEY)?.value;
                return !expiry || new Date(expiry) >= today;
            })
            .map(doc => [
                doc.label,
                new Date(doc.datetime_created).toLocaleString(),
                ...metadataKeys.map(key => doc.metadata.find(meta => meta.metadata_type.label === key)?.value || '-')
            ]);
        doc.autoTable({ head: [tableColumn], body: tableRows });
        doc.save('documents.pdf');
    };

    // Highlight expired
    const isExpired = (doc) => {
        const expiry = doc.metadata.find(meta => meta.metadata_type.label === EXPIRY_METADATA_KEY)?.value;
        return expiry && new Date(expiry) < new Date();
    };

    // Sorting handler
    const handleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    if (loading) return <p>Chargement des documents...</p>;
    if (error) return <p>{error}</p>;

    return (
        <div className="p-4 bg-white shadow-md rounded-lg">
            <div className="mb-4 flex justify-between items-center">
                <h3 className="text-xl font-bold">Liste de Bénéficiaires de la Pension Alimentaire</h3>
                <button
                    onClick={handleExportPDF}
                    className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
                >
                    Exporter en PDF
                </button>
            </div>
            {/* Filters */}
            <div className="mb-2 flex flex-wrap gap-2">
                <input
                    type="text"
                    placeholder="Filtrer par nom"
                    value={filters.label || ''}
                    onChange={e => handleFilterChange('label', e.target.value)}
                    className="border px-2 py-1 rounded"
                />
                <input
                    type="text"
                    placeholder="Filtrer par date de création"
                    value={filters.datetime_created || ''}
                    onChange={e => handleFilterChange('datetime_created', e.target.value)}
                    className="border px-2 py-1 rounded"
                />
                {metadataKeys.map(key => (
                    <input
                        key={key}
                        type="text"
                        placeholder={`Filtrer par ${key}`}
                        value={filters[key] || ''}
                        onChange={e => handleFilterChange(key, e.target.value)}
                        className="border px-2 py-1 rounded"
                    />
                ))}
            </div>
            <table className="w-full border-collapse border border-gray-300">
                <thead>
                    <tr className="bg-gray-200">
                        <th
                            className="border border-gray-300 px-4 py-2 cursor-pointer"
                            onClick={() => handleSort('label')}
                        >
                            Nom {sortConfig.key === 'label' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                        </th>
                        <th
                            className="border border-gray-300 px-4 py-2 cursor-pointer"
                            onClick={() => handleSort('datetime_created')}
                        >
                            Date de Création {sortConfig.key === 'datetime_created' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                        </th>
                        {metadataKeys.map((key, index) => (
                            <th
                                key={index}
                                className="border border-gray-300 px-4 py-2 cursor-pointer"
                                onClick={() => handleSort(key)}
                            >
                                {key} {sortConfig.key === key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {currentDocuments.map((doc) => (
                        <tr
                            key={doc.id}
                            className={`hover:bg-gray-100 ${isExpired(doc) ? 'bg-red-200' : ''}`}
                        >
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
                {Array.from({ length: totalPages }, (_, index) => (
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