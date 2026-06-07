const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const cadreRoutes = require('./routes/cadre');
const resourceRoutes = require('./routes/resources');
const activityRoutes = require('./routes/activities');
const projectRoutes = require('./routes/projects');
const materialRoutes = require('./routes/materials');
const { router: pendingRoutes } = require('./routes/pending');
const presidentRoutes = require('./routes/president');
const uploadRoutes = require('./routes/upload');

app.use('/api', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/cadre-records', cadreRoutes);
app.use('/api/resource-requests', resourceRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/pending-tasks', pendingRoutes);
app.use('/api/pending-changes', pendingRoutes);
app.use('/api/president', presidentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/files', uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend static files
const frontendPath = path.join(__dirname, '..');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

// Start server after database initialization
(async () => {
  try {
    await initDatabase();
    console.log('数据库初始化完成');
    app.listen(PORT, () => {
      console.log(`协会管理系统后端已启动: http://localhost:${PORT}`);
      console.log(`API 地址: http://localhost:${PORT}/api`);
      console.log(`默认账号: admin / admin123 (会长)`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
})();
