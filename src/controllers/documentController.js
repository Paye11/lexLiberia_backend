const Document = require('../models/Document');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const {
  isAdmin,
  canAccessPremiumContent,
} = require('../utils/accessControl');

function sanitizeDocument(doc, user) {
  const payload = doc.toObject ? doc.toObject() : { ...doc };
  const canView = canAccessPremiumContent(user);

  if (!canView) {
    delete payload.filePath;
    payload.locked = true;
  } else {
    payload.locked = false;
  }

  return payload;
}

async function enforceDocumentAccess(user) {
  if (!user) {
    return {
      allowed: false,
      status: 401,
      message: 'Please log in to view premium documents',
    };
  }

  if (isAdmin(user)) {
    return { allowed: true };
  }

  if (!canAccessPremiumContent(user)) {
    return {
      allowed: false,
      status: 403,
      message:
        'Premium documents are available on paid plans only. Upgrade your account or redeem a coupon.',
    };
  }

  const dailyLimit = user.plan?.dailyViewLimit ?? 0;
  if (dailyLimit > 0) {
    const today = new Date().setHours(0, 0, 0, 0);
    const lastView = new Date(user.lastViewDate).setHours(0, 0, 0, 0);
    const isNewDay = today !== lastView;
    const currentViews = isNewDay ? 0 : user.documentViewsToday;

    if (currentViews >= dailyLimit) {
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
  }

  return { allowed: true };
}

exports.getDocuments = async (req, res) => {
  try {
    let query;
    const reqQuery = { ...req.query };
    const removeFields = ['select', 'sort', 'page', 'limit'];
    removeFields.forEach((param) => delete reqQuery[param]);
    let queryStr = JSON.stringify(reqQuery);
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, (match) => `$${match}`);

    query = Document.find(JSON.parse(queryStr)).populate('uploadedBy', 'name email');

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
    const sanitized = documents.map((doc) => sanitizeDocument(doc, req.user));
    const pagination = {};

    if (endIndex < total) {
      pagination.next = { page: page + 1, limit };
    }
    if (startIndex > 0) {
      pagination.prev = { page: page - 1, limit };
    }

    res.status(200).json({
      success: true,
      count: sanitized.length,
      pagination,
      data: sanitized,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate(
      'uploadedBy',
      'name email'
    );

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const access = await enforceDocumentAccess(req.user);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
        data: sanitizeDocument(document, req.user),
      });
    }

    await Document.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: sanitizeDocument(document, req.user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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

exports.updateDocument = async (req, res) => {
  try {
    let document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const allowedFields = ['title', 'description', 'category'];
    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    document = await Document.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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

    const absolutePath = path.resolve(document.filePath);
    const inline = req.query.inline === '1' || req.query.inline === 'true';

    if (inline) {
      res.setHeader('Content-Type', document.fileType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${path.basename(absolutePath)}"`
      );
      return res.sendFile(absolutePath);
    }

    res.download(absolutePath);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
