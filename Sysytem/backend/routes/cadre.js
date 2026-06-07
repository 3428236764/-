const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createPendingChange } = require('./pending');

const router = express.Router();

// GET /api/cadre-records
router.get('/', authMiddleware, (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT cr.*, m.name as member_name, m.student_id as member_student_id
    FROM cadre_records cr
    LEFT JOIN members m ON cr.member_id = m.id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += ' AND (m.name LIKE ? OR cr.activity_name LIKE ? OR cr.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY cr.created_at DESC';
  const records = db().prepare(sql).all(...params);

  const changingIds = new Set(
    db().prepare("SELECT target_id FROM pending_changes WHERE change_type LIKE 'cadre%' AND confirm_status = 'pending'")
      .all().map(r => r.target_id)
  );
  const result = records.map(r => ({ ...r, isChanging: changingIds.has(r.id) }));
  res.json(result);
});

// GET /api/cadre-records/:id
router.get('/:id', authMiddleware, (req, res) => {
  const record = db().prepare(`
    SELECT cr.*, m.name as member_name, m.student_id as member_student_id
    FROM cadre_records cr LEFT JOIN members m ON cr.member_id = m.id
    WHERE cr.id = ?
  `).get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  res.json(record);
});

// POST /api/cadre-records
router.post('/', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const { member_id, activity_date, activity_name, description } = req.body;
  if (!member_id || !activity_date || !activity_name || !description) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }

  const member = db().prepare('SELECT * FROM members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).json({ error: '所选干事不存在' });

  const newRecord = {
    id: uuidv4(),
    member_id, activity_date, activity_name, description,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };
  const change = createPendingChange(req.user, 'cadre_add', '干事档案', '新增', newRecord, null, newRecord.id);
  res.status(201).json({ message: '新增已提交，待确认后生效', record: newRecord, change });
});

// PUT /api/cadre-records/:id
router.put('/:id', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const existing = db().prepare('SELECT * FROM cadre_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });

  const { member_id, activity_date, activity_name, description } = req.body;
  const newData = {
    id: existing.id,
    member_id: member_id || existing.member_id,
    activity_date: activity_date || existing.activity_date,
    activity_name: activity_name || existing.activity_name,
    description: description || existing.description,
  };
  const change = createPendingChange(req.user, 'cadre_edit', '干事档案', '修改', newData, existing, existing.id);
  res.json({ message: '修改已提交，待确认后生效', change });
});

// DELETE /api/cadre-records/:id (direct delete)
router.delete('/:id', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const existing = db().prepare('SELECT * FROM cadre_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });

  db().prepare('DELETE FROM cadre_records WHERE id = ?').run(req.params.id);
  res.json({ message: '记录已删除' });
});

module.exports = router;
