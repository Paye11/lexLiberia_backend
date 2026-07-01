const express = require('express');
const { getPublicNotices } = require('../controllers/adminController');

const router = express.Router();

router.get('/public', getPublicNotices);

module.exports = router;
