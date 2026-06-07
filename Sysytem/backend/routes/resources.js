const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/resource-requests
router.get('/', authMiddleware, (req, res) => {
  const { search, status } = req.query;
  const r = req.user.role;
  let sql = 'SELECT * FROM resource_requests WHERE 1=1';
  const params = [];

  if (r === 'minister') {
    sql += ' AND applicant_id = ?';
    params.push(req.user.id);
  }
  if (search) {
    sql += ' AND (item_name LIKE ? OR purpose LIKE ? OR applicant_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const requests = db().prepare(sql).all(...params);
  res.json(requests);
});

// GET /api/resource-requests/:id
router.get('/:id', authMiddleware, (req, res) => {
  const rr = db().prepare('SELECT * FROM resource_requests WHERE id = ?').get(req.params.id);
  if (!rr) return res.status(404).json({ error: '申请不存在' });
  res.json(rr);
});

// POST /api/resource-requests
router.post('/', authMiddleware, requireRole('minister'), (req, res) => {
  const { type, item_name, quantity, purpose, use_date } = req.body;
  if (!type || !item_name || !quantity || !purpose || !use_date) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }

  const request = {
    id: uuidv4(),
    applicant_id: req.user.id,
    applicant_name: req.user.realName,
    type, item_name, quantity: parseInt(quantity), purpose, use_date,
    status: '待组织副会审',
    org_vice_opinion: '',
    president_opinion: '',
    attachments: JSON.stringify(req.body.attachments || []),
    used_power: 0,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };

  db().prepare(`INSERT INTO resource_requests (id, applicant_id, applicant_name, type, item_name, quantity, purpose, use_date, status, org_vice_opinion, president_opinion, attachments, used_power, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(request.id, request.applicant_id, request.applicant_name, request.type, request.item_name, request.quantity, request.purpose, request.use_date, request.status, request.org_vice_opinion, request.president_opinion, request.attachments, request.used_power, request.created_at);

  res.status(201).json({ message: '申请已提交', request });
});

// PUT /api/resource-requests/:id/approve-org - 组织副会审批
router.put('/:id/approve-org', authMiddleware, requireRole('vice_org'), (req, res) => {
  const { action, comment } = req.body;
  const rr = db().prepare('SELECT * FROM resource_requests WHERE id = ?').get(req.params.id);
  if (!rr) return res.status(404).json({ error: '申请不存在' });
  if (rr.status !== '待组织副会审') return res.status(400).json({ error: '该申请当前状态不可审批' });

  if (action === 'agree') {
    db().prepare("UPDATE resource_requests SET status = '待会长同意', org_vice_opinion = ? WHERE id = ?")
      .run('同意', rr.id);
    res.json({ message: '已同意，待会长审批' });
  } else if (action === 'reject') {
    if (!comment) return res.status(400).json({ error: '驳回理由不能为空' });
    db().prepare("UPDATE resource_requests SET status = '已驳回', org_vice_opinion = ? WHERE id = ?")
      .run('驳回：' + comment, rr.id);
    res.json({ message: '已驳回' });
  } else {
    res.status(400).json({ error: '无效的操作' });
  }
});

// PUT /api/resource-requests/:id/approve-president - 会长审批
router.put('/:id/approve-president', authMiddleware, requireRole('president'), (req, res) => {
  const { action, comment, use_power } = req.body;
  const rr = db().prepare('SELECT * FROM resource_requests WHERE id = ?').get(req.params.id);
  if (!rr) return res.status(404).json({ error: '申请不存在' });

  if (use_power) {
    const power = getPresidentPower(req.user.id);
    const remaining = power.max_uses - power.total_used;
    if (remaining <= 0) return res.status(400).json({ error: '独立同意次数已用完' });
    usePresidentPower(req.user.id);

    db().prepare("UPDATE resource_requests SET status = '已批准', president_opinion = '独立同意', used_power = 1 WHERE id = ?").run(rr.id);
    return res.json({ message: '已使用独立同意权批准', remaining: remaining - 1 });
  }

  if (action === 'agree') {
    if (rr.status !== '待会长同意') return res.status(400).json({ error: '该申请当前状态不可审批' });
    db().prepare("UPDATE resource_requests SET status = '已批准', president_opinion = '同意' WHERE id = ?").run(rr.id);
    res.json({ message: '已批准' });
  } else if (action === 'reject') {
    if (!comment) return res.status(400).json({ error: '驳回理由不能为空' });
    db().prepare("UPDATE resource_requests SET status = '已驳回', president_opinion = ? WHERE id = ?")
      .run('驳回：' + comment, rr.id);
    res.json({ message: '已驳回' });
  } else {
    res.status(400).json({ error: '无效的操作' });
  }
});

// Helper functions
function getPresidentPower(presidentId) {
  let power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(presidentId);
  if (!power) {
    db().prepare('INSERT INTO president_power (president_id, period_start, total_used, max_uses) VALUES (?, ?, ?, ?)')
      .run(presidentId, '2026-01-01', 0, 3);
    power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(presidentId);
  }
  // Check if we need a new period
  const now = new Date();
  const periodStart = new Date(power.period_start);
  const halfYear = 180 * 24 * 60 * 60 * 1000;
  if (now - periodStart > halfYear) {
    const newStart = now.getMonth() < 6
      ? `${now.getFullYear()}-01-01`
      : `${now.getFullYear()}-07-01`;
    db().prepare('INSERT INTO president_power (president_id, period_start, total_used, max_uses) VALUES (?, ?, ?, ?)')
      .run(presidentId, newStart, 0, 3);
    power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(presidentId);
  }
  return power;
}

function usePresidentPower(presidentId) {
  const power = getPresidentPower(presidentId);
  db().prepare('UPDATE president_power SET total_used = total_used + 1 WHERE id = ?').run(power.id);
}

module.exports = router;
