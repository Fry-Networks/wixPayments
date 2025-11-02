import { connect } from '../../db/connect.js';
import { DeviceModel } from '../../db/devices-schema.js';
import { log } from '../common/log.js';

export async function resetParentAssignmentTracking(options: { dryRun?: boolean; emails?: string[]; orders?: string[] } = {}) {
  const { dryRun = false, emails, orders } = options;
  await connect();
  let parentQuery: any = { ai_edge_miner_assigned: true };
  let childQuery: any = { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, parent_device_id: { $exists: true } };
  if (emails && emails.length) { parentQuery.email = { $in: emails }; childQuery.email = { $in: emails }; }
  if (orders && orders.length) { parentQuery.order = { $in: orders }; childQuery.order = { $in: orders }; }
  if (dryRun) {
    const p = await DeviceModel.countDocuments(parentQuery);
    const c = await DeviceModel.countDocuments(childQuery);
    return { success: true, resetParentDevicesCount: p, resetAIEdgeMinerCount: c, message: 'DRY RUN' };
  }
  const pRes = await DeviceModel.updateMany(parentQuery, { $unset: { ai_edge_miner_assigned: 1, assigned_ai_edge_miner_id: 1 } });
  const cRes = await DeviceModel.updateMany(childQuery, { $unset: { parent_device_id: 1, parent_device_name: 1, parent_device_miner_key: 1 } });
  const message = `Reset parents=${pRes.modifiedCount}, children=${cRes.modifiedCount}`;
  log.success(message);
  return { success: true, resetParentDevicesCount: pRes.modifiedCount, resetAIEdgeMinerCount: cRes.modifiedCount, message };
}

