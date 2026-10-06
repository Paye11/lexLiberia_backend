const express = require('express');
const multer = require('multer');
const path = require('path');
const { research, ask } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '').toLowerCase();
    const allowedExtension = ['.pdf', '.docx', '.doc', '.txt', '.rtf', '.odt', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.tif', '.tiff'].includes(extension);
    const allowedType = type.includes('pdf') || type.includes('word') || type.includes('officedocument') || type.includes('text/') || type.startsWith('image/');

    if (allowedExtension || allowedType) {
      callback(null, true);
      return;
    }

    callback(new Error('Upload a PDF, Word document, text file, or a clear image of the pleading.'));
  },
});

const router = express.Router();

router.post('/research', protect, (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The file is larger than 15 MB. Upload a smaller document or pleading.'
      : error.message;

    res.status(400).json({ success: false, message });
  });
}, research);

router.post('/ask', protect, (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The file is larger than 15 MB. Upload a smaller document or pleading.'
      : error.message;

    res.status(400).json({ success: false, message });
  });
}, ask);

module.exports = router;
