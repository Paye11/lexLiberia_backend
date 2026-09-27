const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../uploads/'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (['.pdf', '.doc', '.docx'].includes(extension)) {
    cb(null, true);
    return;
  }
  cb(new Error('Only PDF and Word documents are allowed'));
};

const configuredLimit = Number.parseInt(process.env.MAX_FILE_SIZE, 10);
const defaultLimit = 75 * 1024 * 1024;
const maxFileSize = Number.isFinite(configuredLimit) && configuredLimit > defaultLimit
  ? configuredLimit
  : defaultLimit;

const upload = multer({
  storage: storage,
  limits: { fileSize: maxFileSize },
  fileFilter: fileFilter,
});

module.exports = upload;
