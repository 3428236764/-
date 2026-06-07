const express = require('express');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/president/power-status
router.get('/power-status', authMiddleware, requireRole('president'), (req, res) => {
  let power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (!power) {
    db().prepare('INSERT INTO president_power (president_id, period_start, total_used, max_uses) VALUES (?, ?, ?, ?)')
      .run(req.user.id, '2026-01-01', 0, 3);
    power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  }

  // Check period
  const now = new Date();
  const periodStart = new Date(power.period_start);
  const halfYear = 180 * 24 * 60 * 60 * 1000;
  if (now - periodStart > halfYear) {
    const newStart = now.getMonth() < 6
      ? `${now.getFullYear()}-01-01`
      : `${now.getFullYear()}-07-01`;
    db().prepare('INSERT INTO president_power (president_id, period_start, total_used, max_uses) VALUES (?, ?, ?, ?)')
      .run(req.user.id, newStart, 0, 3);
    power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  }

  const remaining = power.max_uses - power.total_used;
  // Calculate period end (6 months from period_start)
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 6);

  res.json({
    total: power.max_uses,
    used: power.total_used,
    remaining,
    periodStart: power.period_start,
    periodEnd: periodEnd.toISOString().substring(0, 10),
  });
});

module.exports = router;
