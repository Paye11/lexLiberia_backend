const Category = require('../models/Category');
const Document = require('../models/Document');

function pickCategoryFields(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    slug: doc.slug,
    description: doc.description || '',
    order: typeof doc.order === 'number' ? doc.order : 0,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy?._id || doc.createdBy || null,
  };
}

exports.listCategories = async (req, res) => {
  try {
    const includeInactive = req.user?.role === 'admin' && req.query.includeInactive === 'true';
    const filter = includeInactive ? {} : { isActive: { $ne: false } };

    const docs = await Category.find(filter)
      .sort({ order: 1, name: 1, createdAt: -1 })
      .populate('createdBy', 'name username email role')
      .lean();

    res.status(200).json({
      success: true,
      count: docs.length,
      data: docs.map((doc) => ({
        ...pickCategoryFields(doc),
        createdBy: doc.createdBy
          ? {
              _id: doc.createdBy._id,
              name: doc.createdBy.name || '',
              username: doc.createdBy.username || '',
              email: doc.createdBy.email || '',
              role: doc.createdBy.role || '',
            }
          : null,
      })),
    });
  } catch (error) {
    console.error('[categoryController.listCategories]', error);
    res.status(500).json({ success: false, message: 'Unable to load categories.' });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, description, order, isActive } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const trimmed = String(name).trim();
    if (trimmed.length < 2) {
      return res.status(400).json({ success: false, message: 'Category name must be at least 2 characters.' });
    }
    if (trimmed.length > 80) {
      return res.status(400).json({ success: false, message: 'Category name must be less than 80 characters.' });
    }

    const duplicate = await Category.findOne({ name: trimmed }).lean();
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
    }

    const created = await Category.create({
      name: trimmed,
      description: description ? String(description).trim() : '',
      order: order === '' || order == null ? 0 : Number(order) || 0,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      createdBy: req.user._id,
    });

    const saved = await Category.findById(created._id)
      .populate('createdBy', 'name username email role')
      .lean();

    res.status(201).json({
      success: true,
      data: pickCategoryFields(saved),
    });
  } catch (error) {
    console.error('[categoryController.createCategory]', error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Unable to create category.' });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, order, isActive } = req.body || {};

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2) {
        return res.status(400).json({ success: false, message: 'Category name must be at least 2 characters.' });
      }
      if (trimmed.length > 80) {
        return res.status(400).json({ success: false, message: 'Category name must be less than 80 characters.' });
      }
      const duplicate = await Category.findOne({
        _id: { $ne: category._id },
        name: trimmed,
      }).lean();
      if (duplicate) {
        return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
      }
      category.name = trimmed;
    }

    if (description !== undefined) {
      category.description = String(description).trim();
    }
    if (order !== undefined) {
      category.order = order === '' || order == null ? 0 : Number(order) || 0;
    }
    if (typeof isActive === 'boolean') {
      category.isActive = isActive;
    }

    const updated = await category.save();
    const payload = await Category.findById(updated._id)
      .populate('createdBy', 'name username email role')
      .lean();

    res.status(200).json({
      success: true,
      data: pickCategoryFields(payload),
    });
  } catch (error) {
    console.error('[categoryController.updateCategory]', error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A category with this name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Unable to update category.' });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { reassignTo } = req.body || {};

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const inUse = await Document.countDocuments({ category: category.slug });

    if (inUse > 0) {
      if (!reassignTo) {
        const remaining = await Category.countDocuments({
          _id: { $ne: category._id },
          isActive: { $ne: false },
        }).lean();
        return res.status(400).json({
          success: false,
          message: `${inUse} document(s) still use this category. Reassign them before deleting, or provide reassignTo.`,
          inUse,
          canReassign: remaining > 0,
        });
      }

      const target = await Category.findById(reassignTo).lean();
      if (!target) {
        return res.status(400).json({ success: false, message: 'The target category for reassignment does not exist.' });
      }
      if (String(target._id) === String(category._id)) {
        return res.status(400).json({ success: false, message: 'Cannot reassign documents into the category you are deleting.' });
      }

      await Document.updateMany(
        { category: category.slug },
        { $set: { category: target.slug } },
      );
    }

    await Category.deleteOne({ _id: category._id });

    res.status(200).json({
      success: true,
      data: pickCategoryFields(category.toObject()),
      reassigned: inUse || 0,
    });
  } catch (error) {
    console.error('[categoryController.deleteCategory]', error);
    res.status(500).json({ success: false, message: 'Unable to delete category.' });
  }
};

exports.categoryStats = async (req, res) => {
  try {
    const docs = await Document.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const map = new Map();
    docs.forEach((row) => {
      map.set(String(row._id || ''), Number(row.count) || 0);
    });

    const categories = await Category.find()
      .sort({ order: 1, name: 1 })
      .lean();

    const stats = categories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      slug: cat.slug,
      isActive: cat.isActive !== false,
      count: map.get(cat.slug) || 0,
    }));

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('[categoryController.categoryStats]', error);
    res.status(500).json({ success: false, message: 'Unable to load category stats.' });
  }
};
