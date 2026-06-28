'use strict';

const CategoryService = require('../services/category.service');

const CategoryController = {
  // GET /api/categories
  list: (_req, res) => {
    res.json({ success: true, data: CategoryService.list() });
  },
};

module.exports = CategoryController;
