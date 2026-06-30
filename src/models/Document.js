const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please add a title'],
    },
    description: {
      type: String,
      required: [true, 'Please add a description'],
    },
    category: {
      type: String,
      required: [true, 'Please add a category'],
      enum: [
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
      ],
    },
    filePath: {
      type: String,
      required: [true, 'Please add a file'],
    },
    fileType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    views: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Document', DocumentSchema);
