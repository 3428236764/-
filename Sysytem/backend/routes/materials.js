const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createPendingChange } = require('./pending');

const router = express.Router();

// GET /api/materials
router.get('/', authMiddleware, (req, res) => {
  const { search, category } = req.query;
  let sql = 'SELECT * FROM academic_materials WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (title LIKE ? OR summary LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY created_at DESC';
  const materials = db().prepare(sql).all(...params);

  const changingIds = new Set(
    db().prepare("SELECT target_id FROM pending_changes WHERE change_type LIKE 'material%' AND confirm_status = 'pending'")
      .all().map(r => r.target_id)
  );
  const result = materials.map(m => ({ ...m, isChanging: changingIds.has(m.id) }));
  res.json(result);
});

// GET /api/materials/:id
router.get('/:id', authMiddleware, (req, res) => {
  const m = db().prepare('SELECT * FROM academic_materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '资料不存在' });
  res.json(m);
});

// POST /api/materials
router.post('/', authMiddleware, requireRole('president', 'vice_acad'), (req, res) => {
  const { title, category, summary, file_name, file_path } = req.body;
  if (!title) return res.status(400).json({ error: '请填写标题' });

  const newMaterial = {
    id: uuidv4(),
    title,
    category: category || '',
    summary: summary || '',
    file_name: file_name || '',
    file_path: file_path || '',
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };
  const change = createPendingChange(req.user, 'material_add', '学术资料', '新增', newMaterial, null, newMaterial.id);
  res.status(201).json({ message: '新增已提交，待确认后生效', material: newMaterial, change });
});

// PUT /api/materials/:id
router.put('/:id', authMiddleware, requireRole('president', 'vice_acad'), (req, res) => {
  const existing = db().prepare('SELECT * FROM academic_materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '资料不存在' });

  const { title, category, summary, file_name, file_path } = req.body;
  const newData = {
    id: existing.id,
    title: title || existing.title,
    category: category !== undefined ? category : existing.category,
    summary: summary !== undefined ? summary : existing.summary,
    file_name: file_name !== undefined ? file_name : existing.file_name,
    file_path: file_path !== undefined ? file_path : existing.file_path,
  };
  const change = createPendingChange(req.user, 'material_edit', '学术资料', '修改', newData, existing, existing.id);
  res.json({ message: '修改已提交，待确认后生效', change });
});

// DELETE /api/materials/:id (direct delete)
router.delete('/:id', authMiddleware, requireRole('president', 'vice_acad'), (req, res) => {
  const existing = db().prepare('SELECT * FROM academic_materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '资料不存在' });

  db().prepare('DELETE FROM academic_materials WHERE id = ?').run(req.params.id);
  res.json({ message: '资料已删除' });
});

module.exports = router;
