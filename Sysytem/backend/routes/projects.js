const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/projects
router.get('/', authMiddleware, (req, res) => {
  const { search, status } = req.query;
  const r = req.user.role;
  let sql = 'SELECT * FROM project_applications WHERE 1=1';
  const params = [];

  if (r === 'academic_minister') {
    sql += ' AND applicant_id = ?';
    params.push(req.user.id);
  }
  if (search) {
    sql += ' AND (project_name LIKE ? OR leader LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const projects = db().prepare(sql).all(...params);
  const result = projects.map(p => ({
    ...p,
    member_ids: JSON.parse(p.member_ids || '[]'),
    attachments: JSON.parse(p.attachments || '[]'),
  }));
  res.json(result);
});

// GET /api/projects/:id
router.get('/:id', authMiddleware, (req, res) => {
  const p = db().prepare('SELECT * FROM project_applications WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  p.member_ids = JSON.parse(p.member_ids || '[]');
  p.attachments = JSON.parse(p.attachments || '[]');
  res.json(p);
});

// POST /api/projects
router.post('/', authMiddleware, requireRole('academic_minister'), (req, res) => {
  const { project_name, leader, member_ids, description, budget, start_date, end_date } = req.body;
  if (!project_name || !leader || !description || !budget || !start_date || !end_date) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }

  const project = {
    id: uuidv4(),
    applicant_id: req.user.id,
    applicant_name: req.user.realName,
    project_name, leader,
    member_ids: JSON.stringify(member_ids || []),
    description, budget, start_date, end_date,
    status: '待学术副会审',
    acad_vice_opinion: '',
    president_opinion: '',
    attachments: JSON.stringify(req.body.attachments || []),
    used_power: 0,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };

  db().prepare(`INSERT INTO project_applications (id, applicant_id, applicant_name, project_name, leader, member_ids, description, budget, start_date, end_date, status, acad_vice_opinion, president_opinion, attachments, used_power, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project.id, project.applicant_id, project.applicant_name, project.project_name, project.leader, project.member_ids, project.description, project.budget, project.start_date, project.end_date, project.status, project.acad_vice_opinion, project.president_opinion, project.attachments, project.used_power, project.created_at);

  res.status(201).json({ message: '项目申请已提交', project });
});

// PUT /api/projects/:id/approve-acad - 学术副会审批
router.put('/:id/approve-acad', authMiddleware, requireRole('vice_acad'), (req, res) => {
  const { action, comment } = req.body;
  const p = db().prepare('SELECT * FROM project_applications WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  if (p.status !== '待学术副会审') return res.status(400).json({ error: '该申请当前状态不可审批' });

  if (action === 'pass') {
    db().prepare("UPDATE project_applications SET status = '待会长同意', acad_vice_opinion = '通过并上报' WHERE id = ?").run(p.id);
    res.json({ message: '已通过并上报，待会长审批' });
  } else if (action === 'reject') {
    if (!comment) return res.status(400).json({ error: '驳回理由不能为空' });
    db().prepare("UPDATE project_applications SET status = '已驳回', acad_vice_opinion = ? WHERE id = ?")
      .run('驳回：' + comment, p.id);
    res.json({ message: '已驳回' });
  } else {
    res.status(400).json({ error: '无效的操作' });
  }
});

// PUT /api/projects/:id/approve-president - 会长审批
router.put('/:id/approve-president', authMiddleware, requireRole('president'), (req, res) => {
  const { action, comment, use_power } = req.body;
  const p = db().prepare('SELECT * FROM project_applications WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });

  if (use_power) {
    const { getPresidentPower, usePresidentPower } = require('./resources');
    const power = getPresidentPower(req.user.id);
    const remaining = power.max_uses - power.total_used;
    if (remaining <= 0) return res.status(400).json({ error: '独立同意次数已用完' });
    usePresidentPower(req.user.id);

    db().prepare("UPDATE project_applications SET status = '已确认', president_opinion = '独立同意', used_power = 1 WHERE id = ?").run(p.id);
    return res.json({ message: '已使用独立同意权确认', remaining: remaining - 1 });
  }

  if (action === 'agree') {
    if (p.status !== '待会长同意') return res.status(400).json({ error: '该申请当前状态不可审批' });
    db().prepare("UPDATE project_applications SET status = '已确认', president_opinion = '同意' WHERE id = ?").run(p.id);
    res.json({ message: '已确认' });
  } else if (action === 'reject') {
    if (!comment) return res.status(400).json({ error: '退回理由不能为空' });
    db().prepare("UPDATE project_applications SET status = '已驳回', president_opinion = ? WHERE id = ?")
      .run('退回：' + comment, p.id);
    res.json({ message: '已退回' });
  } else {
    res.status(400).json({ error: '无效的操作' });
  }
});

module.exports = router;
