const express = require('express');
const multer = require('multer');
const path = require('path');
const { research, ask } = require('../controllers/aiController');
const { protect, authorize } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '').toLowerCase();
    const allowedExtension = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension);
    const allowedType = type.includes('pdf') || type.includes('word') || type.startsWith('image/');

    if (allowedExtension || allowedType) {
      callback(null, true);
      return;
    }

    callback(new Error('Upload a PDF, Word document, or an image of the pleading.'));
  },
});

const router = express.Router();

router.post('/research', protect, authorize('admin'), (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The file is larger than 10 MB. Upload a smaller pleading.'
      : error.message;

    res.status(400).json({ success: false, message });
  });
}, research);

router.post('/ask', protect, authorize('admin'), (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The file is larger than 10 MB. Upload a smaller pleading.'
      : error.message;

    res.status(400).json({ success: false, message });
  });
}, ask);

module.exports = router;
