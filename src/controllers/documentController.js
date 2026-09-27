const Document = require('../models/Document');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const {
  isAdmin,
  canAccessPremiumContent,
} = require('../utils/accessControl');
const extractDocumentText = require('../utils/extractDocumentText');

function resolveStoredFilePath(storedPath) {
  if (!storedPath) return null;

  const candidates = [
    storedPath,
    path.resolve(storedPath),
    path.join(process.cwd(), storedPath),
    path.join(__dirname, '../../uploads', path.basename(storedPath)),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function sanitizeDocument(doc, user) {
  const payload = doc.toObject ? doc.toObject() : { ...doc };
  const canView = canAccessPremiumContent(user);
  const resolvedPath = resolveStoredFilePath(payload.filePath);

  delete payload.filePath;
  delete payload.textContent;

  if (!canView) {
    payload.locked = true;
    payload.canPreview = false;
    payload.fileAvailable = Boolean(resolvedPath);
  } else {
    payload.locked = false;
    payload.canPreview = Boolean(resolvedPath);
    payload.fileAvailable = Boolean(resolvedPath);
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

    if (access.allowed) {
      await Document.findByIdAndUpdate(
        req.params.id,
        { $inc: { views: 1 } },
        { new: true, runValidators: true }
      );
    }

    res.status(200).json({
      success: true,
      data: sanitizeDocument(document, req.user),
      access: {
        canView: access.allowed,
        message: access.allowed ? null : access.message,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const DOCUMENT_CATEGORIES = [
  'constitution',
  'civil-procedure',
  'criminal-procedure',
  'penal',
  'judiciary',
  'property',
  'labor',
  'revenue',
  'commercial',
  'election',
  'environmental',
  'supreme-court-opinions',
  'regulations',
  'executive-orders',
];

function removeUploadedFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

exports.uploadDocument = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
  const savedPaths = new Set();

  try {
    if (!files.length) {
      return res.status(400).json({ success: false, message: 'Please upload at least one file' });
    }

    let items = [];
    if (req.body.items) {
      items = JSON.parse(req.body.items);
    } else if (files.length === 1) {
      items = [{
        title: req.body.title,
        description: req.body.description,
        category: req.body.category,
      }];
    }

    if (!Array.isArray(items) || items.length !== files.length) {
      files.forEach((file) => removeUploadedFile(file.path));
      return res.status(400).json({
        success: false,
        message: 'Choose a category for every file.',
      });
    }

    const invalid = items.find((item) => !DOCUMENT_CATEGORIES.includes(item?.category) || !String(item?.title || '').trim());
    if (invalid) {
      files.forEach((file) => removeUploadedFile(file.path));
      return res.status(400).json({
        success: false,
        message: 'Each file needs a title and a category.',
      });
    }

    const created = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const item = items[index];
      const title = String(item.title).trim();
      const description = String(item.description || title).trim();
      const textContent = await extractDocumentText(file.path, file.mimetype);
      const document = await Document.create({
        title,
        description,
        category: item.category,
        filePath: file.path,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedBy: req.user._id,
        textContent,
      });
      savedPaths.add(file.path);
      created.push(document);
    }

    res.status(201).json({
      success: true,
      count: created.length,
      data: created,
    });
  } catch (error) {
    files.forEach((file) => {
      if (!savedPaths.has(file.path)) removeUploadedFile(file.path);
    });
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

    const absolutePath = resolveStoredFilePath(document.filePath);
    if (!absolutePath) {
      return res.status(404).json({
        success: false,
        message:
          'Document file is missing on the server. Please ask an administrator to re-upload it.',
      });
    }

    const inline = req.query.inline === '1' || req.query.inline === 'true';
    const filename = path.basename(absolutePath);
    const contentType = document.fileType || 'application/octet-stream';

    if (inline) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Unable to open document file.',
          });
        }
      });
    }

    return res.download(absolutePath, filename, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Unable to download document file.',
        });
      }
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
