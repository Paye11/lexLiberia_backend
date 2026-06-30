const Document = require('../models/Document');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');

async function enforceDocumentAccess(user) {
  if (!user) {
    return { allowed: false, status: 401, message: 'Please log in to view this document' };
  }

  if (user.role === 'admin') {
    return { allowed: true };
  }

  const today = new Date().setHours(0, 0, 0, 0);
  const lastView = new Date(user.lastViewDate).setHours(0, 0, 0, 0);
  const isNewDay = today !== lastView;
  const currentViews = isNewDay ? 0 : user.documentViewsToday;
  const dailyLimit = user.plan?.dailyViewLimit ?? 0;

  if (dailyLimit > 0 && currentViews >= dailyLimit) {
    return {
      allowed: false,
      status: 403,
      message: 'Daily document view limit reached for your current plan',
    };
  }

  await User.findByIdAndUpdate(
    user._id,
    isNewDay
      ? { documentViewsToday: 1, lastViewDate: Date.now() }
      : { $inc: { documentViewsToday: 1 } },
    { new: true, runValidators: true }
  );

  return { allowed: true };
}

// @desc    Get all documents
// @route   GET /api/documents
// @access  Public
exports.getDocuments = async (req, res) => {
  try {
    let query;
    const reqQuery = { ...req.query };
    const removeFields = ['select', 'sort', 'page', 'limit'];
    removeFields.forEach(param => delete reqQuery[param]);
    let queryStr = JSON.stringify(reqQuery);
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

    query = Document.find(JSON.parse(queryStr)).populate('uploadedBy', 'name email');

    if (req.query.select) {
      const fields = req.query.select.split(',').join(' ');
      query = query.select(fields);
    }

    if (req.query.sort) {
      const sortBy = req.query.sort.split(',').join(' ');
      query = query.sort(sortBy);
    } else {
      query = query.sort('-createdAt');
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Document.countDocuments();
    query = query.skip(startIndex).limit(limit);

    const documents = await query;
    const pagination = {};

    if (endIndex < total) {
      pagination.next = { page: page + 1, limit };
    }
    if (startIndex > 0) {
      pagination.prev = { page: page - 1, limit };
    }

    res.status(200).json({
      success: true,
      count: documents.length,
      pagination,
      data: documents,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single document
// @route   GET /api/documents/:id
// @access  Public
exports.getDocument = async (req, res) => {
  try {
    const access = await enforceDocumentAccess(req.user);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const document = await Document.findById(req.params.id).populate('uploadedBy', 'name email');

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await Document.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload a document
// @route   POST /api/documents
// @access  Private/Admin
exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { title, description, category } = req.body;

    const document = await Document.create({
      title,
      description,
      category,
      filePath: req.file.path,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedBy: req.user._id,
    });

    res.status(201).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a document
// @route   PUT /api/documents/:id
// @access  Private/Admin
exports.updateDocument = async (req, res) => {
  try {
    let document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    document = await Document.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a document
// @route   DELETE /api/documents/:id
// @access  Private/Admin
exports.deleteDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }

    await document.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Download document
// @route   GET /api/documents/download/:id
// @access  Private
exports.downloadDocument = async (req, res) => {
  try {
    const access = await enforceDocumentAccess(req.user);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    res.download(path.resolve(document.filePath));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
