const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const db = () => getDb();
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Create a pending change (used by other route modules)
function createPendingChange(user, changeType, module, action, proposedData, originalData, targetId) {
  let needConfirmRole = 'president';
  let summary = '';

  if (user.role === 'president') {
    if (changeType.startsWith('member') || changeType.startsWith('cadre')) needConfirmRole = 'vice_admin';
    else if (changeType.startsWith('activity')) needConfirmRole = 'vice_org';
    else if (changeType.startsWith('material')) needConfirmRole = 'vice_acad';
  }

  if (changeType === 'member_batch') {
    summary = `批量新增 ${proposedData.length} 名成员`;
  } else if (proposedData && !Array.isArray(proposedData)) {
    summary = proposedData.name || proposedData.title || proposedData.project_name || proposedData.activity_name || '';
  } else if (Array.isArray(proposedData)) {
    summary = `批量操作 ${proposedData.length} 项`;
  }

  const change = {
    id: uuidv4(),
    change_type: changeType,
    module,
    action,
    proposed_data: JSON.stringify(proposedData),
    original_data: originalData ? JSON.stringify(originalData) : null,
    target_id: targetId,
    proposer_id: user.id,
    proposer_name: user.realName,
    proposer_role: user.role,
    confirm_status: 'pending',
    need_confirm_role: needConfirmRole,
    summary,
    confirmer_id: null,
    confirmer_name: null,
    reject_reason: '',
    used_power: 0,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };

  db().prepare(`INSERT INTO pending_changes (id, change_type, module, action, proposed_data, original_data, target_id, proposer_id, proposer_name, proposer_role, confirm_status, need_confirm_role, summary, confirmer_id, confirmer_name, reject_reason, used_power, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(change.id, change.change_type, change.module, change.action, change.proposed_data, change.original_data, change.target_id, change.proposer_id, change.proposer_name, change.proposer_role, change.confirm_status, change.need_confirm_role, change.summary, change.confirmer_id, change.confirmer_name, change.reject_reason, change.used_power, change.created_at);

  return change;
}

// GET /api/pending-tasks - count
router.get('/tasks', authMiddleware, (req, res) => {
  const r = req.user.role;
  let count = 0;

  const changes = db().prepare("SELECT * FROM pending_changes WHERE confirm_status = 'pending'").all();

  changes.forEach(c => {
    if (c.proposer_role === 'president') {
      if (c.change_type.startsWith('member') || c.change_type.startsWith('cadre')) { if (r === 'vice_admin') count++; }
      else if (c.change_type.startsWith('activity')) { if (r === 'vice_org') count++; }
      else if (c.change_type.startsWith('material')) { if (r === 'vice_acad') count++; }
    } else {
      if (r === 'president') count++;
    }
  });

  if (r === 'vice_org') count += db().prepare("SELECT COUNT(*) as cnt FROM resource_requests WHERE status = '待组织副会审'").get().cnt;
  if (r === 'president') count += db().prepare("SELECT COUNT(*) as cnt FROM resource_requests WHERE status = '待会长同意'").get().cnt;
  if (r === 'vice_acad') count += db().prepare("SELECT COUNT(*) as cnt FROM project_applications WHERE status = '待学术副会审'").get().cnt;
  if (r === 'president') count += db().prepare("SELECT COUNT(*) as cnt FROM project_applications WHERE status = '待会长同意'").get().cnt;

  res.json({ count });
});

// GET /api/pending-changes - list
router.get('/changes', authMiddleware, (req, res) => {
  const r = req.user.role;
  const allChanges = db().prepare("SELECT * FROM pending_changes WHERE confirm_status = 'pending' ORDER BY created_at DESC").all();

  const myPending = allChanges.filter(c => {
    if (c.proposer_role === 'president') {
      if (c.change_type.startsWith('member') || c.change_type.startsWith('cadre')) return r === 'vice_admin';
      if (c.change_type.startsWith('activity')) return r === 'vice_org';
      if (c.change_type.startsWith('material')) return r === 'vice_acad';
      return false;
    } else {
      return r === 'president';
    }
  });

  const result = myPending.map(c => ({
    ...c,
    proposed_data: c.proposed_data ? JSON.parse(c.proposed_data) : null,
    original_data: c.original_data ? JSON.parse(c.original_data) : null,
  }));
  res.json(result);
});

// GET /api/pending-changes/:id
router.get('/changes/:id', authMiddleware, (req, res) => {
  const c = db().prepare('SELECT * FROM pending_changes WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '变更不存在' });
  c.proposed_data = c.proposed_data ? JSON.parse(c.proposed_data) : null;
  c.original_data = c.original_data ? JSON.parse(c.original_data) : null;
  res.json(c);
});

// PUT /api/pending-changes/:id/confirm
router.put('/changes/:id/confirm', authMiddleware, (req, res) => {
  const { action, reason, use_power } = req.body;
  const c = db().prepare('SELECT * FROM pending_changes WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '变更不存在' });
  if (c.confirm_status !== 'pending') return res.status(400).json({ error: '该变更已处理' });

  if (action === 'confirm') {
    // Apply the change to the actual table
    applyChange(c, use_power);

    db().prepare("UPDATE pending_changes SET confirm_status = 'done', confirmer_id = ?, confirmer_name = ?, used_power = ? WHERE id = ?")
      .run(req.user.id, req.user.realName, use_power ? 1 : 0, c.id);

    // If using power, deduct
    if (use_power && req.user.role === 'president') {
      const power = db().prepare('SELECT * FROM president_power WHERE president_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
      if (power) {
        db().prepare('UPDATE president_power SET total_used = total_used + 1 WHERE id = ?').run(power.id);
      }
    }

    res.json({ message: use_power ? '已使用独立同意权确认变更' : '变更已确认' });
  } else if (action === 'reject') {
    if (!reason) return res.status(400).json({ error: '驳回理由不能为空' });

    db().prepare("UPDATE pending_changes SET confirm_status = 'rejected', confirmer_id = ?, confirmer_name = ?, reject_reason = ? WHERE id = ?")
      .run(req.user.id, req.user.realName, reason, c.id);
    res.json({ message: '变更已驳回' });
  } else {
    res.status(400).json({ error: '无效的操作' });
  }
});

// Apply a pending change to the actual data table
function applyChange(c, usePower) {
  const proposed = JSON.parse(c.proposed_data);
  if (!proposed) return;

  switch (c.change_type) {
    case 'member_add':
      db().prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(proposed.id, proposed.name, proposed.student_id, proposed.phone, proposed.role_tag || '成员', proposed.created_at, proposed.updated_at);
      break;
    case 'member_edit':
      db().prepare('UPDATE members SET name=?, student_id=?, phone=?, role_tag=?, updated_at=? WHERE id=?')
        .run(proposed.name, proposed.student_id, proposed.phone, proposed.role_tag, new Date().toISOString().replace('T',' ').substring(0,19), proposed.id);
      break;
    case 'member_delete':
      db().prepare('DELETE FROM members WHERE id = ?').run(c.target_id);
      break;
    case 'member_batch':
      const insertM = db().prepare('INSERT INTO members (id, name, student_id, phone, role_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const m of proposed) {
        insertM.run(m.id, m.name, m.student_id, m.phone, m.role_tag || '成员', m.created_at);
      }
      break;
    case 'cadre_add':
      db().prepare('INSERT INTO cadre_records (id, member_id, activity_date, activity_name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(proposed.id, proposed.member_id, proposed.activity_date, proposed.activity_name, proposed.description, proposed.created_at);
      break;
    case 'cadre_edit':
      db().prepare('UPDATE cadre_records SET member_id=?, activity_date=?, activity_name=?, description=? WHERE id=?')
        .run(proposed.member_id, proposed.activity_date, proposed.activity_name, proposed.description, proposed.id);
      break;
    case 'cadre_delete':
      db().prepare('DELETE FROM cadre_records WHERE id = ?').run(c.target_id);
      break;
    case 'activity_add':
      db().prepare('INSERT INTO activities (id, name, date, location, plan_text, second_class_desc, participant_ids, photo_links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(proposed.id, proposed.name, proposed.date, proposed.location, proposed.plan_text, proposed.second_class_desc, proposed.participant_ids, proposed.photo_links, proposed.created_at);
      break;
    case 'activity_edit':
      db().prepare('UPDATE activities SET name=?, date=?, location=?, plan_text=?, second_class_desc=?, participant_ids=?, photo_links=? WHERE id=?')
        .run(proposed.name, proposed.date, proposed.location, proposed.plan_text, proposed.second_class_desc, proposed.participant_ids, proposed.photo_links, proposed.id);
      break;
    case 'activity_delete':
      db().prepare('DELETE FROM activities WHERE id = ?').run(c.target_id);
      break;
    case 'material_add':
      db().prepare('INSERT INTO academic_materials (id, title, category, summary, file_name, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(proposed.id, proposed.title, proposed.category, proposed.summary, proposed.file_name, proposed.file_path, proposed.created_at);
      break;
    case 'material_edit':
      db().prepare('UPDATE academic_materials SET title=?, category=?, summary=?, file_name=?, file_path=? WHERE id=?')
        .run(proposed.title, proposed.category, proposed.summary, proposed.file_name, proposed.file_path, proposed.id);
      break;
    case 'material_delete':
      db().prepare('DELETE FROM academic_materials WHERE id = ?').run(c.target_id);
      break;
  }
}

module.exports = { router, createPendingChange };
