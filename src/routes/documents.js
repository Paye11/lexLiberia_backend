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

function acceptDocumentUpload(req, res, next) {
  upload.array('files', 15)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'One of the files is larger than 75 MB. Upload a smaller file.'
      : error.message;

    res.status(400).json({ success: false, message });
  });
}

router.route('/')
  .get(optionalAuth, getDocuments)
  .post(protect, authorize('admin'), acceptDocumentUpload, uploadDocument);

router.route('/download/:id')
  .get(protect, downloadDocument);

router.route('/:id')
  .get(optionalAuth, getDocument)
  .put(protect, authorize('admin'), updateDocument)
  .delete(protect, authorize('admin'), deleteDocument);

module.exports = router;
