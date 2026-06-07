const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'association.db');

let db = null;
let SQL = null;

// sql.js wrapper to provide better-sqlite3-like API
class DbWrapper {
  constructor(database, sqlLib) {
    this._db = database;
    this._sql = sqlLib;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self._db.run(sql, params);
        self._save();
        return this;
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        let row = null;
        if (stmt.step()) {
          row = stmt.getAsObject();
        }
        stmt.free();
        return row;
      },
      all(...params) {
        const stmt = self._db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
    };
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  _save() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('Database save error:', e.message);
    }
  }

  close() {
    this._db.close();
  }
}

async function initDatabase() {
  SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new DbWrapper(new SQL.Database(fileBuffer), SQL);
    } catch (e) {
      console.log('Loading existing database failed, creating new one');
      db = new DbWrapper(new SQL.Database(), SQL);
    }
  } else {
    db = new DbWrapper(new SQL.Database(), SQL);
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      real_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      student_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      role_tag TEXT DEFAULT '成员',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cadre_records (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      activity_date TEXT,
      activity_name TEXT,
      description TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS resource_requests (
      id TEXT PRIMARY KEY,
      applicant_id INTEGER,
      applicant_name TEXT,
      type TEXT,
      item_name TEXT,
      quantity INTEGER,
      purpose TEXT,
      use_date TEXT,
      status TEXT DEFAULT '待组织副会审',
      org_vice_opinion TEXT DEFAULT '',
      president_opinion TEXT DEFAULT '',
      attachments TEXT DEFAULT '[]',
      used_power INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT,
      location TEXT,
      plan_text TEXT DEFAULT '',
      second_class_desc TEXT DEFAULT '',
      participant_ids TEXT DEFAULT '[]',
      photo_links TEXT DEFAULT '[]',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_applications (
      id TEXT PRIMARY KEY,
      applicant_id INTEGER,
      applicant_name TEXT,
      project_name TEXT,
      leader TEXT,
      member_ids TEXT DEFAULT '[]',
      description TEXT DEFAULT '',
      budget TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT '待学术副会审',
      acad_vice_opinion TEXT DEFAULT '',
      president_opinion TEXT DEFAULT '',
      attachments TEXT DEFAULT '[]',
      used_power INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS academic_materials (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_changes (
      id TEXT PRIMARY KEY,
      change_type TEXT,
      module TEXT,
      action TEXT,
      proposed_data TEXT,
      original_data TEXT,
      target_id TEXT,
      proposer_id INTEGER,
      proposer_name TEXT,
      proposer_role TEXT,
      confirm_status TEXT DEFAULT 'pending',
      need_confirm_role TEXT,
      summary TEXT DEFAULT '',
      confirmer_id INTEGER,
      confirmer_name TEXT,
      reject_reason TEXT DEFAULT '',
      used_power INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS president_power (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      president_id INTEGER,
      period_start TEXT,
      total_used INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 3
    );
  `);

  // Seed default accounts
  const count = db.prepare('SELECT COUNT(*) as cnt FROM accounts').get();
  if (count && count.cnt === 0) {
    const salt = bcrypt.genSaltSync(10);
    const accounts = [
      { username: 'admin', password: bcrypt.hashSync('admin123', salt), role: 'president', real_name: '会长' },
      { username: 'vice1', password: bcrypt.hashSync('vice1123', salt), role: 'vice_admin', real_name: '行政副会' },
      { username: 'vice2', password: bcrypt.hashSync('vice2123', salt), role: 'vice_org', real_name: '组织副会' },
      { username: 'vice3', password: bcrypt.hashSync('vice3123', salt), role: 'vice_acad', real_name: '学术副会' },
      { username: 'minister', password: bcrypt.hashSync('minister123', salt), role: 'minister', real_name: '普通部长' },
      { username: 'academic', password: bcrypt.hashSync('academic123', salt), role: 'academic_minister', real_name: '学术部长' },
    ];
    for (const a of accounts) {
      db.prepare('INSERT INTO accounts (username, password, role, real_name) VALUES (?, ?, ?, ?)')
        .run(a.username, a.password, a.role, a.real_name);
    }
    console.log('默认账号已创建');
  }

  // Seed president power
  const powerCount = db.prepare('SELECT COUNT(*) as cnt FROM president_power').get();
  if (powerCount && powerCount.cnt === 0) {
    db.prepare('INSERT INTO president_power (president_id, period_start, total_used, max_uses) VALUES (?, ?, ?, ?)')
      .run(1, '2026-01-01', 0, 3);
  }

  // Seed demo data
  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM members').get();
  if (memberCount && memberCount.cnt === 0) {
    seedDemoData();
  }

  return db;
}

function seedDemoData() {
  const m1 = uuidv4(); const m2 = uuidv4(); const m3 = uuidv4();
  const m4 = uuidv4(); const m5 = uuidv4();

  db.prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m1, '张三', '20240010001', '13800000001', '成员', '2026-01-15 10:00');
  db.prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m2, '李四', '20240010002', '13900000002', '干事', '2026-01-16 14:00');
  db.prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m3, '王五', '20240010003', '13700000003', '成员', '2026-02-01 09:00');
  db.prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m4, '赵六', '20240010004', '13600000004', '干事', '2026-02-10 11:00');
  db.prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m5, '孙七', '20240010005', '13500000005', '成员', '2026-03-01 08:00');

  db.prepare('INSERT INTO cadre_records (id, member_id, activity_date, activity_name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), m2, '2026-02-20', '新生见面会', '负责场地布置和签到引导，协助主持人进行流程控制', '2026-02-20 18:00');
  db.prepare('INSERT INTO cadre_records (id, member_id, activity_date, activity_name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), m4, '2026-03-15', '学术讲座', '邀请教授主讲，协调多媒体设备，整理会议纪要', '2026-03-15 20:00');

  db.prepare('INSERT INTO activities (id, name, date, location, plan_text, second_class_desc, participant_ids, photo_links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), '新生见面会', '2026-02-20', '教学楼A101', '1. 开场致辞 2. 成员自我介绍 3. 协会介绍 4. 互动游戏', '参与人数50人，每人0.1分', JSON.stringify([m1, m2, m3]), '[]', '2026-02-20 18:00');
  db.prepare('INSERT INTO activities (id, name, date, location, plan_text, second_class_desc, participant_ids, photo_links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), '春季学术讲座', '2026-03-15', '报告厅', '邀请XX大学教授做人工智能专题讲座', '参与人数80人，每人0.2分', JSON.stringify([m2, m4]), '[]', '2026-03-15 20:00');

  db.prepare('INSERT INTO resource_requests (id, applicant_id, applicant_name, type, item_name, quantity, purpose, use_date, status, org_vice_opinion, president_opinion, attachments, used_power, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 5, '普通部长', '物资', '打印纸', 10, '活动宣传材料打印', '2026-03-10', '已批准', '同意', '同意', '[]', 0, '2026-03-01 10:00');
  db.prepare('INSERT INTO resource_requests (id, applicant_id, applicant_name, type, item_name, quantity, purpose, use_date, status, org_vice_opinion, president_opinion, attachments, used_power, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 5, '普通部长', '场地', '操场', 1, '团建活动', '2026-04-15', '待组织副会审', '', '', '[]', 0, '2026-04-01 09:00');

  db.prepare('INSERT INTO project_applications (id, applicant_id, applicant_name, project_name, leader, member_ids, description, budget, start_date, end_date, status, acad_vice_opinion, president_opinion, attachments, used_power, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 6, '学术部长', 'AI技术调研', '学术部长', JSON.stringify([m2]), '调研最新AI技术发展趋势，形成研究报告', '5000元', '2026-03-01', '2026-05-31', '待学术副会审', '', '', '[]', 0, '2026-02-25 14:00');

  db.prepare('INSERT INTO academic_materials (id, title, category, summary, file_name, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), '机器学习入门指南', '课件', '面向初学者的机器学习基础知识整理，包含监督学习、无监督学习等核心概念', 'ml_guide.pdf', '', '2026-01-20');

  console.log('演示数据已创建');
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb };
