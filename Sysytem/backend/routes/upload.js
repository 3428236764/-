const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = new Date().toISOString().substring(0, 10);
    const dir = path.join(UPLOAD_DIR, dateDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '_' + Math.random().toString(36).substr(2, 8) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.docx', '.xlsx', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件格式，仅支持 .docx .xlsx .pdf'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// POST /api/upload
router.post('/', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择文件' });
  }
  res.json({
    message: '上传成功',
    file: {
      originalName: req.file.originalname,
      fileName: req.file.filename,
      path: req.file.path.replace(UPLOAD_DIR, '').replace(/\\/g, '/'),
      size: req.file.size,
    },
  });
});

// POST /api/upload/multiple
router.post('/multiple', authMiddleware, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请选择文件' });
  }
  const files = req.files.map(f => ({
    originalName: f.originalname,
    fileName: f.filename,
    path: f.path.replace(UPLOAD_DIR, '').replace(/\\/g, '/'),
    size: f.size,
  }));
  res.json({ message: `成功上传 ${files.length} 个文件`, files });
});

// GET /api/files/:dateDir/:filename
router.get('/files/:dateDir/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.dateDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.download(filePath);
});

// Multer error handling middleware
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大2MB）' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
