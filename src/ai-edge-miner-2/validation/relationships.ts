import { connect } from '../../db/connect.js';
import { DeviceModel } from '../../db/devices-schema.js';
import { ELIGIBLE_NODE_TYPES } from '../common/constants.js';
import { redactEmail, redactKey } from '../../redact-utils.js';
import { log } from '../common/log.js';

export async function validateParentChildRelationships(options: { emails?: string[]; orders?: string[]; fixDuplicates?: boolean; dryRun?: boolean } = {}) {
  const { emails, orders, fixDuplicates = false, dryRun = false } = options;
  await connect();

  let aiEdgeMinerQuery: any = { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ } };
  let parentQuery: any = { ai_edge_miner_assigned: true };
  if (emails && emails.length) { const f = { email: { $in: emails } }; aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...f }; parentQuery = { ...parentQuery, ...f }; }
  if (orders && orders.length) { const f = { order: { $in: orders } }; aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...f }; parentQuery = { ...parentQuery, ...f }; }

  const aiEdgeMiners = await DeviceModel.find(aiEdgeMinerQuery).select('_id miner_key email order parent_device_id parent_device_name parent_device_miner_key').lean();
  const assignedParents = await DeviceModel.find(parentQuery).select('_id miner_key name email order ai_edge_miner_assigned assigned_ai_edge_miner_id').lean();

  const childrenByParent = aiEdgeMiners.reduce<Record<string, any[]>>((acc, child) => {
    if (child.parent_device_id) {
      const pid = child.parent_device_id.toString();
      if (!acc[pid]) acc[pid] = [];
      acc[pid].push(child);
    }
    return acc;
  }, {});

  const duplicateParentAssignments: Array<{ parentId: string; parentKey: string; parentName: string; assignedChildren: Array<{ childId: string; childKey: string; email: string; order: string; }>; }> = [];
  for (const [parentId, children] of Object.entries(childrenByParent)) {
    if (children.length > 1) {
      const parent = assignedParents.find(p => p._id.toString() === parentId);
      duplicateParentAssignments.push({ parentId, parentKey: parent ? redactKey(parent.miner_key || '') : 'UNKNOWN', parentName: parent?.name || 'UNKNOWN', assignedChildren: children.map(c => ({ childId: c._id.toString(), childKey: redactKey(c.miner_key || ''), email: redactEmail(c.email || ''), order: c.order || '' })) });
    }
  }

  const orphanedAIEdgeMiners: Array<{ childId: string; childKey: string; email: string; order: string; reason: string; }> = [];
  for (const c of aiEdgeMiners) {
    if (!c.parent_device_id) {
      orphanedAIEdgeMiners.push({ childId: c._id.toString(), childKey: redactKey(c.miner_key || ''), email: redactEmail(c.email || ''), order: c.order || '', reason: 'No parent device assigned' });
    }
  }

  const invalidParentReferences: Array<{ childId: string; childKey: string; parentId: string; reason: string; }> = [];
  for (const c of aiEdgeMiners) {
    if (c.parent_device_id) {
      const parentId = c.parent_device_id.toString();
      const parent = await DeviceModel.findById(parentId).lean();
      if (!parent) invalidParentReferences.push({ childId: c._id.toString(), childKey: redactKey(c.miner_key || ''), parentId, reason: 'Parent device does not exist' });
      else if (!parent.ai_edge_miner_assigned) invalidParentReferences.push({ childId: c._id.toString(), childKey: redactKey(c.miner_key || ''), parentId, reason: 'Parent device not marked as assigned' });
      else if (parent.assigned_ai_edge_miner_id?.toString() !== c._id.toString()) invalidParentReferences.push({ childId: c._id.toString(), childKey: redactKey(c.miner_key || ''), parentId, reason: 'Parent device assigned to different child' });
    }
  }

  let fixedDuplicates = 0;
  if (fixDuplicates && duplicateParentAssignments.length > 0 && !dryRun) {
    for (const dup of duplicateParentAssignments) {
      const childrenToReassign = dup.assignedChildren.slice(1);
      for (const ch of childrenToReassign) {
        const availableParent = await DeviceModel.findOneAndUpdate(
          { email: ch.email, order: ch.order, ai_miner_generated: true, ai_edge_miner_assigned: { $ne: true }, name: { $in: ELIGIBLE_NODE_TYPES } },
          { $set: { ai_edge_miner_assigned: true, assigned_ai_edge_miner_id: ch.childId } },
          { sort: { created_at: 1 }, returnDocument: 'after' }
        );
        if (availableParent) {
          await DeviceModel.updateOne({ _id: ch.childId }, { $set: { parent_device_id: availableParent._id, parent_device_name: availableParent.name, parent_device_miner_key: availableParent.miner_key } });
          fixedDuplicates++;
        } else {
          await DeviceModel.updateOne({ _id: ch.childId }, { $unset: { parent_device_id: 1, parent_device_name: 1, parent_device_miner_key: 1 } });
        }
      }
    }
  }

  const success = duplicateParentAssignments.length === 0 && orphanedAIEdgeMiners.length === 0 && invalidParentReferences.length === 0;
  const message = success ? 'All parent-child relationships are valid' : `Found ${duplicateParentAssignments.length} duplicate parent assignments, ${orphanedAIEdgeMiners.length} orphaned children, ${invalidParentReferences.length} invalid references`;
  if (success) log.success(message); else log.warning(message);
  return { success, totalAIEdgeMiners: aiEdgeMiners.length, totalParentDevices: assignedParents.length, duplicateParentAssignments, orphanedAIEdgeMiners, invalidParentReferences, fixedDuplicates, message };
}

export async function generateParentChildAssignmentReport(options: { emails?: string[]; orders?: string[]; includeDetails?: boolean } = {}) {
  const { emails, orders, includeDetails = true } = options;
  await connect();
  let base: any = {};
  if (emails && emails.length) base.email = { $in: emails };
  if (orders && orders.length) base.order = { $in: orders };
  const all = await DeviceModel.find({ ...base, $or: [ { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ } }, { name: { $in: ELIGIBLE_NODE_TYPES }, ai_miner_generated: true } ] }).select('_id miner_key name email order ai_miner_generated ai_edge_miner_assigned assigned_ai_edge_miner_id parent_device_id parent_device_name parent_device_miner_key').lean();
  const byUser = all.reduce<Record<string, any[]>>((acc, d) => { const k = `${d.email}|${d.order}`; if (!acc[k]) acc[k] = []; acc[k].push(d); return acc; }, {});
  const breakdown: any[] = [];
  let perfect = 0, problematic = 0, multipleNodes = 0;
  for (const [key, list] of Object.entries(byUser)) {
    const [email, order] = key.split('|');
    const parents = list.filter(d => ELIGIBLE_NODE_TYPES.some(t => d.name?.includes(t)) && d.ai_miner_generated === true);
    const children = list.filter(d => d.name === '$FRY AI Edge Miner' && (d.miner_key || '').startsWith('AEM-'));
    if (parents.length > 1) multipleNodes++;
    const parentDetails = parents.map(p => ({ id: p._id.toString(), name: p.name || '', key: redactKey(p.miner_key || ''), assigned: p.ai_edge_miner_assigned === true, assignedToChild: p.assigned_ai_edge_miner_id?.toString() }));
    const childDetails = children.map(a => ({ id: a._id.toString(), key: redactKey(a.miner_key || ''), parentId: a.parent_device_id?.toString(), parentName: a.parent_device_name, parentKey: a.parent_device_miner_key ? redactKey(a.parent_device_miner_key) : undefined }));
    const issues: string[] = [];
    let status: 'perfect' | 'duplicate_parents' | 'orphaned_children' | 'no_parents' | 'no_children' = 'perfect';
    if (parents.length === 0 && children.length > 0) { status = 'no_parents'; issues.push('AI Edge Miners exist but no parent devices found'); }
    else if (children.length === 0 && parents.length > 0) { status = 'no_children'; issues.push('Parent devices exist but no AI Edge Miners found'); }
    else if (parents.length > 0 && children.length > 0) {
      const orphaned = children.filter(a => !a.parentId);
      if (orphaned.length > 0) { status = 'orphaned_children'; issues.push(`${orphaned.length} AI Edge Miners without parent assignment`); }
      const parentAssignments = children.reduce<Record<string, number>>((acc, a) => { if (a.parentId) acc[a.parentId] = (acc[a.parentId] || 0) + 1; return acc; }, {});
      const dupParents = Object.entries(parentAssignments).filter(([_, c]) => c > 1);
      if (dupParents.length > 0) { status = 'duplicate_parents'; issues.push(`${dupParents.length} parent devices assigned to multiple children`); }
      const unassignedParents = parentDetails.filter(p => !p.assigned);
      if (unassignedParents.length > 0) issues.push(`${unassignedParents.length} parent devices not marked as assigned`);
      for (const a of childDetails) {
        if (a.parentId) {
          const pd = parents.find(p => p._id.toString() === a.parentId);
          if (pd && pd.assigned_ai_edge_miner_id?.toString() !== a.id) issues.push(`AI Edge Miner ${a.key} parent assignment mismatch`);
        }
      }
    }
    if (issues.length === 0 && parents.length > 0 && children.length > 0) perfect++; else if (issues.length > 0) problematic++;
    breakdown.push({ email: redactEmail(email), order, parentDevices: includeDetails ? parentDetails : [], aiEdgeMiners: includeDetails ? childDetails : [], status, issues });
  }
  return { summary: { totalUsers: Object.keys(byUser).length, totalAIEdgeMiners: all.filter(d => d.name === '$FRY AI Edge Miner' && (d.miner_key || '').startsWith('AEM-')).length, totalParentDevices: all.filter(d => ELIGIBLE_NODE_TYPES.some(t => d.name?.includes(t)) && d.ai_miner_generated === true).length, usersWithMultipleNodes: multipleNodes, perfectAssignments: perfect, problematicAssignments: problematic }, userBreakdown: breakdown };
}

export async function quickHealthCheck() {
  await connect();
  const totalAIEdgeMiners = await DeviceModel.countDocuments({ name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ } });
  const totalParentDevices = await DeviceModel.countDocuments({ ai_edge_miner_assigned: true });
  const dupAgg = await DeviceModel.aggregate([ { $match: { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, parent_device_id: { $exists: true } } }, { $group: { _id: '$parent_device_id', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } } ]);
  const orphaned = await DeviceModel.countDocuments({ name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, parent_device_id: { $exists: false } });
  const healthy = dupAgg.length === 0 && orphaned === 0;
  const message = healthy ? '✅ Healthy' : `⚠️ Duplicates=${dupAgg.length} Orphaned=${orphaned}`;
  return { healthy, totalAIEdgeMiners, totalParentDevices, duplicateAssignments: dupAgg.length, orphanedChildren: orphaned, message };
}

