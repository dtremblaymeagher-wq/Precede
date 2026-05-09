'use strict';
/**
 * utils/file-extractors.js
 *
 * Shared text extraction logic for all file-based entry pipelines
 * (manual upload via pdf-routes, Drive import via connector-routes, etc.)
 */

const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const XLSX     = require('xlsx');

const MIME_MAP = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       'xlsx',
    'application/vnd.ms-excel': 'xlsx',
    'text/csv':         'csv',
    'application/csv':  'csv',
    'text/plain':       'csv',
};

function detectFileType(mimetype = '', filename = '') {
    if (MIME_MAP[mimetype]) return MIME_MAP[mimetype];
    const ext = filename.split('.').pop().toLowerCase();
    return { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv' }[ext] ?? null;
}

async function extractText(buffer, fileType) {
    if (fileType === 'pdf') {
        const data = await pdfParse(buffer);
        return data.text?.trim() ?? '';
    }
    if (fileType === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        return result.value?.trim() ?? '';
    }
    if (fileType === 'xlsx') {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const parts = [];
        for (const name of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
            if (csv.trim()) parts.push(`=== ${name} ===\n${csv}`);
        }
        return parts.join('\n\n').trim();
    }
    if (fileType === 'csv') {
        return buffer.toString('utf-8').trim();
    }
    return '';
}

module.exports = { detectFileType, extractText };
