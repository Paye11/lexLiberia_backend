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

async function extractDocumentText(filePath, mimeType) {
  if (!filePath || !fs.existsSync(filePath)) return '';

  const extension = path.extname(filePath).toLowerCase();
  const type = String(mimeType || '').toLowerCase();

  try {
    if (extension === '.pdf' || type.includes('pdf')) {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(fs.readFileSync(filePath));
      return normalizeText(parsed.text);
    }

    if (
      extension === '.docx' ||
      type.includes('wordprocessingml') ||
      type.includes('msword')
    ) {
      const mammoth = require('mammoth');
      const parsed = await mammoth.extractRawText({ path: filePath });
      return normalizeText(parsed.value);
    }
  } catch (error) {
    console.error(`Unable to extract text from ${path.basename(filePath)}: ${error.message}`);
  }

  return '';
}

module.exports = extractDocumentText;
