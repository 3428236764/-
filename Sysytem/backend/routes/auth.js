const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const db = () => getDb();
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const user = db().prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.real_name,
    },
  });
});

// GET /api/me - 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = db().prepare('SELECT id, username, role, real_name FROM accounts WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user });
});

module.exports = router;
