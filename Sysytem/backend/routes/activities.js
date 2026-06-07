const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createPendingChange } = require('./pending');

const router = express.Router();

// GET /api/activities
router.get('/', authMiddleware, (req, res) => {
  const { search, year } = req.query;
  let sql = 'SELECT * FROM activities WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (name LIKE ? OR location LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (year) {
    sql += ' AND date LIKE ?';
    params.push(`${year}%`);
  }
  sql += ' ORDER BY created_at DESC';
  const activities = db().prepare(sql).all(...params);

  const changingIds = new Set(
    db().prepare("SELECT target_id FROM pending_changes WHERE change_type LIKE 'activity%' AND confirm_status = 'pending'")
      .all().map(r => r.target_id)
  );
  const result = activities.map(a => ({
    ...a,
    isChanging: changingIds.has(a.id),
    participant_ids: JSON.parse(a.participant_ids || '[]'),
    photo_links: JSON.parse(a.photo_links || '[]'),
  }));
  res.json(result);
});

// GET /api/activities/:id
router.get('/:id', authMiddleware, (req, res) => {
  const activity = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) return res.status(404).json({ error: '活动不存在' });
  activity.participant_ids = JSON.parse(activity.participant_ids || '[]');
  activity.photo_links = JSON.parse(activity.photo_links || '[]');
  res.json(activity);
});

// POST /api/activities
router.post('/', authMiddleware, requireRole('president', 'vice_org'), (req, res) => {
  const { name, date, location, plan_text, second_class_desc, participant_ids, photo_links } = req.body;
  if (!name || !date || !location) {
    return res.status(400).json({ error: '请填写必填字段（名称、日期、地点）' });
  }
  const newActivity = {
    id: uuidv4(),
    name, date, location,
    plan_text: plan_text || '',
    second_class_desc: second_class_desc || '',
    participant_ids: JSON.stringify(participant_ids || []),
    photo_links: JSON.stringify(photo_links || []),
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };
  const change = createPendingChange(req.user, 'activity_add', '活动记录', '新增', newActivity, null, newActivity.id);
  res.status(201).json({ message: '新增已提交，待确认后生效', activity: newActivity, change });
});

// PUT /api/activities/:id
router.put('/:id', authMiddleware, requireRole('president', 'vice_org'), (req, res) => {
  const existing = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '活动不存在' });

  const { name, date, location, plan_text, second_class_desc, participant_ids, photo_links } = req.body;
  const newData = {
    id: existing.id,
    name: name || existing.name,
    date: date || existing.date,
    location: location || existing.location,
    plan_text: plan_text !== undefined ? plan_text : existing.plan_text,
    second_class_desc: second_class_desc !== undefined ? second_class_desc : existing.second_class_desc,
    participant_ids: participant_ids ? JSON.stringify(participant_ids) : existing.participant_ids,
    photo_links: photo_links ? JSON.stringify(photo_links) : existing.photo_links,
  };
  const change = createPendingChange(req.user, 'activity_edit', '活动记录', '修改', newData, {
    ...existing,
    participant_ids: JSON.parse(existing.participant_ids || '[]'),
    photo_links: JSON.parse(existing.photo_links || '[]'),
  }, existing.id);
  res.json({ message: '修改已提交，待确认后生效', change });
});

// DELETE /api/activities/:id (direct delete)
router.delete('/:id', authMiddleware, requireRole('president', 'vice_org'), (req, res) => {
  const existing = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '活动不存在' });

  db().prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  res.json({ message: '活动已删除' });
});

module.exports = router;
