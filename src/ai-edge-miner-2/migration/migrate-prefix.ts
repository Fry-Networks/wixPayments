import { connect } from '../../db/connect.js';
import { DeviceModel } from '../../db/devices-schema.js';
import { log } from '../common/log.js';
import mongoose from 'mongoose';
import { ELIGIBLE_NODE_TYPES } from '../common/constants.js';
import { assignParentDeviceAtomic } from '../assignment/parent.js';

/**
 * Migrate AI Edge Miner devices from ANM- to AEM-, remove legacy fields, and set parent refs via atomic claim.
 */
export async function migrateAIEdgeMinerPrefix(options: { dryRun?: boolean; batchSize?: number; progressCallback?: (p: { processed: number; total: number; currentDevice: string }) => void; } = {}) {
  const { dryRun = false, batchSize = 100, progressCallback } = options;
  await connect();
  const toMigrate = await DeviceModel.find({ miner_key: { $regex: /^ANM-/ }, name: '$FRY AI Edge Miner' }).select('_id miner_key name email order enabled').lean();
  const total = toMigrate.length;
  if (dryRun) {
    log.info(`DRY RUN: would migrate ${total} devices`);
    return { success: true, totalFound: total, successCount: total, failCount: 0, processedDevices: toMigrate.map(d => d._id.toString()), failedDevices: [], parentDevicesFound: 0, parentDevicesNotFound: 0, message: `DRY RUN complete` };
  }

  let successCount = 0, failCount = 0, parentFound = 0, parentNotFound = 0; const processedDevices: string[] = []; const failedDevices: string[] = [];
  for (let i = 0; i < toMigrate.length; i += batchSize) {
    const batch = toMigrate.slice(i, i + batchSize);
    for (const d of batch) {
      progressCallback?.({ processed: i + batch.indexOf(d) + 1, total, currentDevice: `${d._id} (${d.miner_key})` });
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const newKey = d.miner_key!.replace(/^ANM-/, 'AEM-');
          // atomic parent claim to link to this child
          const claim = await assignParentDeviceAtomic(d.email || '', d.order || '', d._id.toString(), undefined, session);
          if (claim.success && claim.parentDevice) parentFound++; else parentNotFound++;

          const updateOp: any = { $set: { miner_key: newKey }, $unset: { enabled: 1, ai_miner_generated: 1 } };
          if (claim.parentDevice) {
            updateOp.$set.parent_device_id = claim.parentDevice._id;
            updateOp.$set.parent_device_name = claim.parentDevice.name;
            updateOp.$set.parent_device_miner_key = claim.parentDevice.miner_key;
          }
          const upd = await DeviceModel.updateOne({ _id: d._id }, updateOp, { session });
          if (upd.modifiedCount !== 1) throw new Error(`No doc modified for ${d._id}`);
        });
        processedDevices.push(d._id.toString()); successCount++;
      } catch (e) {
        log.error(`Migration failed for ${d._id}`, e);
        failCount++; failedDevices.push(d._id.toString());
      } finally { await session.endSession(); }
      await new Promise(res => setTimeout(res, 20));
    }
  }

  const message = `Migrated ${successCount}/${total} devices from ANM to AEM`;
  log.success(message, { parentFound, parentNotFound, failCount });
  return { success: failCount === 0, totalFound: total, successCount, failCount, processedDevices, failedDevices, parentDevicesFound: parentFound, parentDevicesNotFound: parentNotFound, message };
}

export async function migrateSingleAIEdgeMinerPrefix(minerKey: string, options: { dryRun?: boolean } = {}) {
  const { dryRun = false } = options;
  await connect();
  const raw = await DeviceModel.findOne({ miner_key: minerKey }).lean();
  if (!raw) return { success: false, message: `Device not found` } as any;
  if (raw.name !== '$FRY AI Edge Miner') return { success: false, message: `Not an AI Edge Miner` } as any;
  if (!minerKey.startsWith('ANM-')) return { success: false, message: `Not an ANM key` } as any;
  const newKey = minerKey.replace(/^ANM-/, 'AEM-');
  if (dryRun) return { success: true, device: { _id: raw._id, oldKey: minerKey, newKey }, message: 'DRY RUN' } as any;

  const session = await DeviceModel.db.startSession();
  try {
    let claimedParent: any = null;
    await session.withTransaction(async () => {
      const claim = await assignParentDeviceAtomic(raw.email || '', raw.order || '', raw._id.toString(), undefined, session);
      if (claim.success && claim.parentDevice) claimedParent = claim.parentDevice;
      const updateOp: any = { $set: { miner_key: newKey }, $unset: { enabled: 1, ai_miner_generated: 1 } };
      if (claimedParent) {
        updateOp.$set.parent_device_id = claimedParent._id;
        updateOp.$set.parent_device_name = claimedParent.name;
        updateOp.$set.parent_device_miner_key = claimedParent.miner_key;
      }
      const upd = await DeviceModel.updateOne({ _id: raw._id }, updateOp, { session });
      if (upd.modifiedCount !== 1) throw new Error(`No doc modified for ${raw._id}`);
    });
    return { success: true, device: { _id: raw._id, oldKey: minerKey, newKey }, parentDevice: claimedParent, message: 'Migrated' } as any;
  } catch (e) {
    log.error('Single migration failed', e);
    return { success: false, message: `Failed: ${e instanceof Error ? e.message : String(e)}` } as any;
  } finally { await session.endSession(); }
}

