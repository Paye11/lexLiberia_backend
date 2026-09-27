const fs = require('fs');
const path = require('path');

const MAX_STORED_CHARS = 200000;

function normalizeText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_STORED_CHARS);
}

async function extractPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const parsed = await pdfParse(buffer);
  return normalizeText(parsed.text);
}

async function extractDocx(buffer) {
  const mammoth = require('mammoth');
  const parsed = await mammoth.extractRawText({ buffer });
  return normalizeText(parsed.value);
}

function isImageUpload(originalName, mimeType) {
  const extension = path.extname(originalName || '').toLowerCase();
  const type = String(mimeType || '').toLowerCase();
  return type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension);
}

async function extractBufferText(buffer, originalName, mimeType) {
  const extension = path.extname(originalName || '').toLowerCase();
  const type = String(mimeType || '').toLowerCase();

  try {
    if (extension === '.pdf' || type.includes('pdf')) {
      return await extractPdf(buffer);
    }

    if (extension === '.docx' || type.includes('wordprocessingml') || type.includes('msword')) {
      return await extractDocx(buffer);
    }
  } catch (error) {
    console.error(`Unable to extract text from an uploaded pleading: ${error.message}`);
  }

  return '';
}

async function extractDocumentText(filePath, mimeType) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return extractBufferText(fs.readFileSync(filePath), path.basename(filePath), mimeType);
}

module.exports = extractDocumentText;
module.exports.extractBufferText = extractBufferText;
module.exports.isImageUpload = isImageUpload;
