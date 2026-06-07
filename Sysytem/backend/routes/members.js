const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createPendingChange } = require('./pending');

const router = express.Router();

// GET /api/members
router.get('/', authMiddleware, (req, res) => {
  const { search, role_tag } = req.query;
  let sql = 'SELECT * FROM members WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (name LIKE ? OR student_id LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (role_tag) {
    sql += ' AND role_tag = ?';
    params.push(role_tag);
  }
  sql += ' ORDER BY created_at DESC';
  const members = db().prepare(sql).all(...params);

  // Attach pending change status
  const changingIds = new Set(
    db().prepare("SELECT target_id FROM pending_changes WHERE change_type LIKE 'member%' AND confirm_status = 'pending'")
      .all().map(r => r.target_id)
  );
  const result = members.map(m => ({ ...m, isChanging: changingIds.has(m.id) }));
  res.json(result);
});

// GET /api/members/:id
router.get('/:id', authMiddleware, (req, res) => {
  const member = db().prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: '成员不存在' });
  res.json(member);
});

// POST /api/members (creates pending change)
router.post('/', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const { name, student_id, phone, role_tag } = req.body;
  if (!name || !student_id || !phone) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }
  if (!/^\d{11}$/.test(student_id)) {
    return res.status(400).json({ error: '学号必须为11位数字' });
  }
  const newMember = {
    id: uuidv4(),
    name, student_id, phone,
    role_tag: role_tag || '成员',
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    updated_at: null,
    isChanging: true,
  };
  const change = createPendingChange(req.user, 'member_add', '成员资料', '新增', newMember, null, newMember.id);
  res.status(201).json({ message: '新增已提交，待确认后生效', member: newMember, change });
});

// PUT /api/members/:id (creates pending change)
router.put('/:id', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const existing = db().prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '成员不存在' });

  const { name, student_id, phone, role_tag } = req.body;
  if (student_id && !/^\d{11}$/.test(student_id)) {
    return res.status(400).json({ error: '学号必须为11位数字' });
  }
  const newData = {
    id: existing.id,
    name: name || existing.name,
    student_id: student_id || existing.student_id,
    phone: phone || existing.phone,
    role_tag: role_tag || existing.role_tag,
  };
  const change = createPendingChange(req.user, 'member_edit', '成员资料', '修改', newData, existing, existing.id);
  res.json({ message: '修改已提交，待确认后生效', change });
});

// DELETE /api/members/:id (direct delete)
router.delete('/:id', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const existing = db().prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '成员不存在' });

  db().prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  res.json({ message: '成员已删除' });
});

// POST /api/members/batch (batch registration)
router.post('/batch', authMiddleware, requireRole('president', 'vice_admin'), (req, res) => {
  const { members: memberList } = req.body;
  if (!memberList || !Array.isArray(memberList) || memberList.length === 0) {
    return res.status(400).json({ error: '请提供有效的成员列表' });
  }

  const newMembers = [];
  for (const m of memberList) {
    if (!m.student_id || !/^\d{11}$/.test(m.student_id)) {
      return res.status(400).json({ error: `学号「${m.student_id}」不是11位数字，请修正` });
    }
    newMembers.push({
      id: uuidv4(),
      name: m.name,
      student_id: m.student_id,
      phone: m.phone,
      role_tag: m.role_tag || '成员',
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    });
  }

  const change = createPendingChange(req.user, 'member_batch', '成员资料', '批量新增', newMembers, null, 'batch_' + uuidv4());
  res.status(201).json({ message: `${newMembers.length} 条记录已提交，待确认后生效`, change });
});

module.exports = router;
