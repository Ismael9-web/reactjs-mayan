
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const WorkflowDocuments = () => {

    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [filter, setFilter] = useState('');
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
    const metadataKeys = Array.from(new Set(documents.flatMap(doc => doc.metadata.map(meta => meta.metadata_type.label))));

    // Helper: get value by metadata label
    const getMetaValue = (doc, label) => doc.metadata.find(meta => meta.metadata_type.label === label)?.value || '';

    // Unified filter: search all columns and metadata
    const filteredDocuments = documents.filter(doc => {
        const docValues = [
            doc.label,
            new Date(doc.datetime_created).toLocaleString(),
            ...metadataKeys.map(key => getMetaValue(doc, key))
        ].join(' ').toLowerCase();
        return docValues.includes(filter.toLowerCase());
    });

    const indexOfLastDocument = currentPage * documentsPerPage;
    const indexOfFirstDocument = indexOfLastDocument - documentsPerPage;
    const currentDocuments = filteredDocuments.slice(indexOfFirstDocument, indexOfLastDocument);

    const paginate = (pageNumber) => setCurrentPage(pageNumber);

    // Helper: check if expired (Date-fin < today)
    const isExpired = (doc) => {
        const dateFinLabel = metadataKeys.find(key => key.toLowerCase().includes('date-fin')) || metadataKeys.find(key => key.toLowerCase().includes('fin'));
        if (!dateFinLabel) return false;
        const dateFinValue = getMetaValue(doc, dateFinLabel);
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

    // PDF Export
    const handleExportPDF = () => {
        const docPdf = new jsPDF('l', 'pt', 'a4');
        // Title
        docPdf.setFontSize(16);
        docPdf.text('Direction de la Trésorerie Générale', 40, 50);
        docPdf.setFontSize(13);
        const todayStr = new Date().toLocaleDateString();
        docPdf.text(`Liste de beneficiaire de la pension alimentaire et la date (${todayStr})`, 40, 75);

        // Table columns (match sample PDF order)
        const columnOrder = [
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
        // Map actual metadata keys to sample columns
        const colMap = {};
        columnOrder.forEach(col => {
            const found = metadataKeys.find(k => k.replace(/\s|_/g, '').toLowerCase().includes(col.replace(/\s|_|é|è|ê|ë/g, '').toLowerCase().replace('é','e').replace('è','e').replace('ê','e').replace('ë','e')));
            colMap[col] = found || col;
        });

        // Table rows
        const rows = filteredDocuments.map(doc => [
            getMetaValue(doc, colMap['Date-fin']),
            getMetaValue(doc, colMap['Date-initial']),
            getMetaValue(doc, colMap['Montant par Mois']),
            getMetaValue(doc, colMap['Motif-Saisi']),
            getMetaValue(doc, colMap['Nom-beneficaire']),
            getMetaValue(doc, colMap['Nom-employé']),
            getMetaValue(doc, colMap['Relation-employe-beneficiaire']),
            getMetaValue(doc, colMap['fonction-employé']),
            getMetaValue(doc, colMap['total-à-payer']),
        ]);

        // Table header
        const head = [columnOrder];

        // Table styling
        docPdf.autoTable({
            head,
            body: rows,
            startY: 100,
            headStyles: { fillColor: [22, 119, 199], textColor: 255, fontStyle: 'bold' },
            bodyStyles: { fontSize: 10 },
            alternateRowStyles: { fillColor: [240, 240, 240] },
            margin: { left: 40, right: 40 },
            styles: { cellPadding: 4, overflow: 'linebreak' },
        });

        // Totals (as in sample)
        // Calculate total à payer and total ce mois (sum of Montant par Mois)
        let totalPayer = 0;
        let totalCeMois = 0;
        rows.forEach(row => {
            // total-à-payer
            const total = (row[8] || '').replace(/\s|,/g, '').replace(/[^\d.]/g, '');
            if (total) totalPayer += parseFloat(total);
            // Montant par Mois
            const mois = (row[2] || '').replace(/\s|,/g, '').replace(/[^\d.]/g, '');
            if (mois) totalCeMois += parseFloat(mois);
        });
        docPdf.setFontSize(12);
        docPdf.text(`Total à payé: ${totalPayer.toLocaleString('fr-FR')} DJF`, 500, docPdf.internal.pageSize.height - 60);
        docPdf.text(`Total à payé ce mois: ${totalCeMois.toLocaleString('fr-FR')} DJF`, 470, docPdf.internal.pageSize.height - 30);

        docPdf.save('liste_de_beneficiaires_de_la_pension_alimentaire.pdf');
    };

    if (loading) return <p>Chargement des documents...</p>;
    if (error) return <p>{error}</p>;


    return (
        <div className="p-4 bg-white shadow-md rounded-lg">
            <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h3 className="text-xl font-bold">Liste de Bénéficiaires de la Pension Alimentaire</h3>
                <div className="flex gap-2 items-center">
                    <input
                        type="text"
                        placeholder="Filtrer tous les champs..."
                        value={filter}
                        onChange={e => { setFilter(e.target.value); setCurrentPage(1); }}
                        className="border border-gray-300 rounded px-2 py-1"
                        style={{ minWidth: 220 }}
                    />
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
                            {/* Render columns in sample PDF order if possible */}
                            {['Date-fin','Date-initial','Montant par Mois','Motif-Saisi','Nom-beneficaire','Nom-employé','Relation-employe-beneficiaire','fonction-employé','total-à-payer'].map((col, idx) => (
                                <th key={col} className="border border-gray-300 px-4 py-2 whitespace-nowrap">{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {currentDocuments.map((doc) => {
                            // Map columns to metadata
                            const get = (label) => {
                                const found = metadataKeys.find(k => k.replace(/\s|_/g, '').toLowerCase().includes(label.replace(/\s|_|é|è|ê|ë/g, '').toLowerCase().replace('é','e').replace('è','e').replace('ê','e').replace('ë','e')));
                                return getMetaValue(doc, found || label) || '-';
                            };
                            const expired = isExpired(doc);
                            return (
                                <tr key={doc.id} className={expired ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'}>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Date-fin')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Date-initial')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Montant par Mois')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Motif-Saisi')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Nom-beneficaire')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Nom-employé')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('Relation-employe-beneficiaire')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('fonction-employé')}</td>
                                    <td className="border border-gray-300 px-4 py-2 whitespace-nowrap">{get('total-à-payer')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex justify-center mt-4">
                {Array.from({ length: Math.ceil(filteredDocuments.length / documentsPerPage) }, (_, index) => (
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