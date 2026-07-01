const express = require('express');
const {
  getDocuments,
  getDocument,
  uploadDocument,
  updateDocument,
  deleteDocument,
  downloadDocument,
} = require('../controllers/documentController');
const { protect, optionalAuth, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.route('/')
  .get(optionalAuth, getDocuments)
  .post(protect, authorize('admin'), upload.single('file'), uploadDocument);

router.route('/download/:id')
  .get(protect, downloadDocument);

router.route('/:id')
  .get(optionalAuth, getDocument)
  .put(protect, authorize('admin'), updateDocument)
  .delete(protect, authorize('admin'), deleteDocument);

module.exports = router;
