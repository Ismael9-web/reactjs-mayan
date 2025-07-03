
import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const WorkflowDocuments = () => {

    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [filter, setFilter] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const filterInputRef = useRef(null);
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



    // --- Dynamic columns: use all metadata keys found in documents ---
    const metadataKeys = React.useMemo(() => {
        return Array.from(new Set(documents.flatMap(doc => doc.metadata.map(meta => meta.metadata_type.label))));
    }, [documents]);

    // Helper: get value by metadata label
    const getMetaValue = (doc, label) => doc.metadata.find(meta => meta.metadata_type.label === label)?.value || '';

    // --- Unified filter: search all columns and metadata ---
    const filteredDocuments = React.useMemo(() => {
        if (!filter) return documents;
        const lower = filter.toLowerCase();
        return documents.filter(doc => {
            if ((doc.label || '').toLowerCase().includes(lower)) return true;
            for (let key of metadataKeys) {
                if ((getMetaValue(doc, key) || '').toLowerCase().includes(lower)) return true;
            }
            return false;
        });
    }, [documents, filter, metadataKeys]);

    // --- Sorting logic for all columns (label + metadata) ---
    const sortedDocuments = React.useMemo(() => {
        if (!sortConfig.key) return filteredDocuments;
        return [...filteredDocuments].sort((a, b) => {
            let aValue, bValue;
            if (sortConfig.key === 'label') {
                aValue = a.label || '';
                bValue = b.label || '';
            } else {
                aValue = getMetaValue(a, sortConfig.key);
                bValue = getMetaValue(b, sortConfig.key);
            }
            // Try to compare as dates if possible
            const aDate = Date.parse(aValue);
            const bDate = Date.parse(bValue);
            if (!isNaN(aDate) && !isNaN(bDate)) {
                return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
            }
            // Otherwise compare as string
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredDocuments, sortConfig]);

    // --- Pagination ---
    const indexOfLast = currentPage * documentsPerPage;
    const indexOfFirst = indexOfLast - documentsPerPage;
    const currentDocuments = sortedDocuments.slice(indexOfFirst, indexOfLast);

    const paginate = (pageNumber) => setCurrentPage(pageNumber);


    // --- Helper: check if expired (Date-fin < today) ---
    const isExpired = (doc) => {
        // Try to find a metadata key that matches 'Date-fin' (case-insensitive, ignore accents)
        const dateFinKey = metadataKeys.find(key => key.replace(/[éèêë]/gi, 'e').toLowerCase().includes('date-fin'))
            || metadataKeys.find(key => key.replace(/[éèêë]/gi, 'e').toLowerCase().includes('fin'));
        if (!dateFinKey) return false;
        const dateFinValue = getMetaValue(doc, dateFinKey);
        if (!dateFinValue) return false;
        // Accept formats like DD-MM-YYYY or YYYY-MM-DD
        const [d, m, y] = dateFinValue.split('-');
        let dateFin;
        if (dateFinValue.length === 10 && d && m && y) {
            if (y.length === 4) {
                dateFin = new Date(dateFinValue);
            } else {
                dateFin = new Date(`${y}-${m}-${d}`);
            }
        } else {
            dateFin = new Date(dateFinValue);
        }
        if (isNaN(dateFin)) return false;
        const today = new Date();
        today.setHours(0,0,0,0);
        return dateFin < today;
    };


    // --- PDF Export: all columns, all filtered data, dynamic header, and totals as in sample image ---
    const handleExportPDF = () => {
        // Attach autoTable to jsPDF if not already
        if (typeof jsPDF === 'function' && typeof jsPDF.prototype.autoTable !== 'function' && typeof autoTable === 'function') {
            autoTable(jsPDF);
        }
        if (typeof jsPDF !== 'function' || typeof jsPDF.prototype.autoTable !== 'function') {
            alert('jsPDF or autoTable is not loaded.');
            return;
        }
        const docPdf = new jsPDF('p', 'pt', 'a4');
        // Title
        docPdf.setFontSize(14);
        docPdf.text('Direction de la Trésorerie Générale', 32, 32);
        docPdf.setFontSize(12);
        const todayStr = new Date().toLocaleDateString();
        docPdf.text(`Liste de bénéficiaires de la pension alimentaire à la date (${todayStr})`, 32, 54);

        // Table columns: use metadataKeys, but try to match the order in the sample if possible
        const preferredOrder = [
            'Date-fin',
            'Date-initial',
            'Montant par Mois',
            'Motif-Saisi',
            'Nom-beneficaire',
            'Nom-employé',
            'Relation-employe-beneficiaire',
            'fonction-employé',
            'total-à-payer',
        ];
        const normalize = s => s && s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s|_/g, '').toLowerCase();
        const orderedKeys = preferredOrder
            .map(pref => metadataKeys.find(k => normalize(k).includes(normalize(pref))))
            .filter(Boolean);
        const extraKeys = metadataKeys.filter(k => !orderedKeys.includes(k));
        const finalKeys = [...orderedKeys, ...extraKeys];

        // Table header and rows
        const head = [[...finalKeys]];
        const rows = sortedDocuments.map(doc => finalKeys.map(key => getMetaValue(doc, key)));

        // Add table
        try {
            // Use docPdf.autoTable instead of autoTable(docPdf, ...)
            docPdf.autoTable({
                head,
                body: rows,
                startY: 70,
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', halign: 'center' },
                bodyStyles: { fontSize: 10 },
                alternateRowStyles: { fillColor: [240, 240, 240] },
                margin: { left: 32, right: 32 },
                styles: { cellPadding: 4, overflow: 'linebreak' },
            });
        } catch (e) {
            alert('Erreur lors de la génération du PDF: ' + e.message);
            return;
        }

        // Totals (as in sample)
        const totalPayerKey = finalKeys.find(k => normalize(k).includes('totalapayer'));
        const montantMoisKey = finalKeys.find(k => normalize(k).includes('montantparmois'));
        let totalPayer = 0;
        let totalCeMois = 0;
        sortedDocuments.forEach(doc => {
            let total = getMetaValue(doc, totalPayerKey) || '';
            total = (total || '').replace(/\s|,/g, '').replace(/[^\d.]/g, '');
            if (total) totalPayer += parseFloat(total);
            let mois = getMetaValue(doc, montantMoisKey) || '';
            mois = (mois || '').replace(/\s|,/g, '').replace(/[^\d.]/g, '');
            if (mois) totalCeMois += parseFloat(mois);
        });
        docPdf.setFontSize(10);
        const pageHeight = docPdf.internal.pageSize.height;
        docPdf.text(`Total à payé: ${totalPayer.toLocaleString('fr-FR')} DJF`, 380, pageHeight - 60);
        docPdf.text(`Total à payé ce mois: ${totalCeMois.toLocaleString('fr-FR')} DJF`, 350, pageHeight - 40);

        docPdf.save('liste_de_beneficiaires_de_la_pension_alimentaire.pdf');
    };

    // --- Suggestive autocomplete logic ---
    const allSuggestions = React.useMemo(() => {
        const vals = new Set();
        documents.forEach(doc => {
            vals.add(doc.label);
            metadataKeys.forEach(key => {
                const v = getMetaValue(doc, key);
                if (v) vals.add(v);
            });
        });
        return Array.from(vals).filter(v => v && v.toString().trim().length > 0);
    }, [documents, metadataKeys]);

    useEffect(() => {
        if (!filter) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }
        const lower = filter.toLowerCase();
        const matches = allSuggestions.filter(v => v.toString().toLowerCase().includes(lower));
        setSuggestions(matches.slice(0, 10));
        setShowSuggestions(matches.length > 0);
    }, [filter, allSuggestions]);

    // Handle suggestion click
    const handleSuggestionClick = (val) => {
        setFilter(val);
        setShowSuggestions(false);
        setCurrentPage(1);
        if (filterInputRef.current) filterInputRef.current.blur();
    };

    // Handle sort click (label or metadata)
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
            <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h3 className="text-xl font-bold">Liste des documents</h3>
                <div className="flex gap-2 items-center relative">
                    <input
                        type="text"
                        placeholder="Filtrer tous les champs..."
                        value={filter}
                        ref={filterInputRef}
                        onChange={e => { setFilter(e.target.value); setCurrentPage(1); }}
                        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                        className="border border-gray-300 rounded px-2 py-1"
                        style={{ minWidth: 220 }}
                        autoComplete="off"
                    />
                    {showSuggestions && (
                        <ul className="absolute z-10 bg-white border border-gray-300 rounded shadow-md mt-1 left-0 w-full max-h-48 overflow-y-auto">
                            {suggestions.map((s, i) => (
                                <li
                                    key={i}
                                    className="px-3 py-1 hover:bg-blue-100 cursor-pointer"
                                    onMouseDown={() => handleSuggestionClick(s)}
                                >
                                    {s}
                                </li>
                            ))}
                        </ul>
                    )}
                    <button
                        onClick={handleExportPDF}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                    >
                        Exporter PDF
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                    <thead>
                        <tr className="bg-gray-200">
                            <th
                                className="border border-gray-300 px-4 py-2 whitespace-nowrap cursor-pointer select-none"
                                onClick={() => handleSort('label')}
                            >
                                Nom du document
                                {sortConfig.key === 'label' && (
                                    <span className="ml-1">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                                )}
                            </th>
                            {metadataKeys.map((key, idx) => (
                                <th
                                    key={key}
                                    className="border border-gray-300 px-4 py-2 whitespace-nowrap cursor-pointer select-none"
                                    onClick={() => handleSort(key)}
                                >
                                    {key}
                                    {sortConfig.key === key && (
                                        <span className="ml-1">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {currentDocuments.map((doc) => {
                            const expired = isExpired(doc);
                            return (
                                <tr key={doc.id} className={expired ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'}>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{doc.label}</td>
                                    {metadataKeys.map((key, idx) => (
                                        <td key={key} className="border border-gray-300 px-4 py-2 whitespace-nowrap">{getMetaValue(doc, key) || '-'}</td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex justify-center mt-4">
                {Array.from({ length: Math.ceil(sortedDocuments.length / documentsPerPage) }, (_, index) => (
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