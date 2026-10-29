const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt'];

// Extracts plain text from an uploaded resume held in memory (nothing is written to disk).
async function extractTextFromBuffer(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();

  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    return data.text || '';
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (ext === '.txt') {
    return buffer.toString('utf8');
  }
  throw new Error('Unsupported file type. Please upload a PDF, DOCX or TXT file.');
}

module.exports = { extractTextFromBuffer, SUPPORTED_EXTENSIONS };
