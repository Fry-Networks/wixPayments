import { DeviceModel, Device } from '../../db/devices-schema.js';
import mongoose from 'mongoose';
import { generateMinerKey } from '../../db/utils.js';
import { redactEmail, redactKey } from '../../redact-utils.js';
import { AI_MINER_PREFIX, ELIGIBLE_NODE_TYPES, ORDER_NUMBER_CUTOFF, ELIGIBLE_ORDER_STRINGS } from '../common/constants.js';
import { log } from '../common/log.js';
import { assignParentDeviceAtomic } from '../assignment/parent.js';
import { isDeviceEligible } from './eligibility.js';
import { sendMail } from '../../MailProcessor.js';

export async function generateAIMinerKey(device: Device): Promise<{
  success: boolean;
  aiMinerDevice?: any;
  parentDevice?: any;
  message: string;
}> {
  const session = await mongoose.startSession();
  const txId = `gen_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  log.info(`[${txId}] Generating AI miner key for device ${device._id} (Order: ${device.order}, Email: ${redactEmail(device.email)})`);

  try {
    let aiMinerDevice: any;
    let parentDevice: any = null;

    await session.withTransaction(async () => {
      // 1) Generate key and create child record first to get child id
      const rawKey = await generateMinerKey(AI_MINER_PREFIX);
      const aemDoc = {
        miner_key: rawKey,
        email: device.email || '',
        name: "$FRY AI Edge Miner",
        created_at: new Date(),
        is_registered: false,
        order: device.order || '',
        byod: "",
        email_sent: false
      } as any;

      const created = await DeviceModel.create([aemDoc], { session });
      aiMinerDevice = created[0];
      log.success(`[${txId}] Created AEM child ${aiMinerDevice._id} with key ${redactKey(rawKey)}`);

      // 2) Mark original device as granted BEFORE attempting parent assignment
      const upd = await DeviceModel.updateOne(
        { _id: device._id },
        { $set: { ai_miner_generated: true } },
        { session }
      );
      if (upd.modifiedCount !== 1) {
        throw new Error(`Failed to mark original device ${device._id} as ai_miner_generated`);
      }

      // 3) Claim parent atomically to point to this child id
      const assignment = await assignParentDeviceAtomic(
        device.email || '',
        device.order || '',
        aiMinerDevice._id.toString(),
        txId,
        session
      );
      if (assignment.success && assignment.parentDevice) {
        parentDevice = assignment.parentDevice;
        // Update child with parent refs
        await DeviceModel.updateOne(
          { _id: aiMinerDevice._id },
          {
            $set: {
              parent_device_id: parentDevice._id,
              parent_device_name: parentDevice.name,
              parent_device_miner_key: parentDevice.miner_key
            }
          },
          { session }
        );
        log.success(`[${txId}] Linked child ${aiMinerDevice._id} to parent ${parentDevice._id}`);
      } else {
        log.warning(`[${txId}] No available parent for child ${aiMinerDevice._id}`);
      }
    });

    const message = `Generated AI miner for device ${device._id}${parentDevice ? ' with parent assignment' : ''}.`;
    log.success(`[${txId}] ${message}`);
    return {
      success: true,
      aiMinerDevice: {
        _id: aiMinerDevice._id,
        miner_key: redactKey(aiMinerDevice.miner_key),
        name: aiMinerDevice.name,
        email: redactEmail(aiMinerDevice.email),
        order: aiMinerDevice.order,
        created_at: aiMinerDevice.created_at,
        parent_device_id: aiMinerDevice.parent_device_id,
        parent_device_name: aiMinerDevice.parent_device_name,
        parent_device_miner_key: aiMinerDevice.parent_device_miner_key ? redactKey(aiMinerDevice.parent_device_miner_key) : undefined
      },
      parentDevice: parentDevice ? {
        _id: parentDevice._id,
        name: parentDevice.name,
        miner_key: redactKey(parentDevice.miner_key),
        email: redactEmail(parentDevice.email),
        order: parentDevice.order
      } : null,
      message
    };
  } catch (error) {
    const message = `Failed to generate AI miner for device ${device._id}`;
    log.error(message, error);
    return { success: false, message: `${message}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await session.endSession();
  }
}

export async function generateAIMinerKeysForEligibleUsers(emails?: string[]): Promise<{ successCount: number; failCount: number; }> {
  let successCount = 0;
  let failCount = 0;
  const filterSet = emails && emails.length ? new Set(emails.map(e => e.trim().toLowerCase())) : undefined;

  const elig = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { "registration.amount": { $gt: 0 } },
      { "node.amount": { $gt: 0 } },
      { is_registered: true },
      { ai_miner_generated: false },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: "" } }
    ]
  });

  const devices = filterSet ? elig.filter(d => (d.email || '').trim().toLowerCase() && filterSet!.has((d.email || '').trim().toLowerCase())) : elig;
  log.info(`Found ${devices.length} eligible devices for one-time generation`);

  for (const d of devices) {
    try {
      const r = await generateAIMinerKey(d);
      r.success ? successCount++ : failCount++;
    } catch {
      failCount++;
    }
  }

  log.success(`One-time AEM generation complete`, { successCount, failCount });
  return { successCount, failCount };
}

export async function generateAIMinerKeysBatch(options: {
  emails?: string[];
  batchSize?: number;
  dryRun?: boolean;
  progressCallback?: (p: { processed: number; total: number; currentDevice: string }) => void;
} = {}): Promise<{
  successCount: number;
  failCount: number;
  processedDevices: string[];
  failedDevices: string[];
  eligibleDevicesCount: number;
  uniqueEmailsCount: number;
}> {
  const { emails, batchSize = 100, dryRun = false, progressCallback } = options;

  let eligibleDevices = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { "registration.amount": { $gt: 0 } },
      { "node.amount": { $gt: 0 } },
      { is_registered: true },
      { ai_miner_generated: false },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: "" } }
    ]
  });

  if (emails && emails.length) {
    const set = new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean));
    eligibleDevices = eligibleDevices.filter(d => set.has((d.email || '').trim().toLowerCase()));
  }

  const uniqueEmails = new Set(eligibleDevices.map(d => (d.email || '').trim().toLowerCase())).size;
  if (dryRun) {
    return {
      successCount: eligibleDevices.length,
      failCount: 0,
      processedDevices: eligibleDevices.map(d => d._id.toString()),
      failedDevices: [],
      eligibleDevicesCount: eligibleDevices.length,
      uniqueEmailsCount: uniqueEmails
    };
  }

  let successCount = 0;
  let failCount = 0;
  const processedDevices: string[] = [];
  const failedDevices: string[] = [];

  for (let i = 0; i < eligibleDevices.length; i += batchSize) {
    const batch = eligibleDevices.slice(i, i + batchSize);
    for (const device of batch) {
      if (progressCallback) {
        progressCallback({ processed: i + batch.indexOf(device) + 1, total: eligibleDevices.length, currentDevice: `${device._id} (${redactEmail(device.email)})` });
      }
      try {
        const r = await generateAIMinerKey(device);
        if (r.success) {
          successCount++;
          processedDevices.push(device._id.toString());
        } else {
          failCount++;
          failedDevices.push(device._id.toString());
        }
      } catch {
        failCount++;
        failedDevices.push(device._id.toString());
      }
      await new Promise(res => setTimeout(res, 50));
    }
    if (i + batchSize < eligibleDevices.length) await new Promise(res => setTimeout(res, 500));
  }

  return { successCount, failCount, processedDevices, failedDevices, eligibleDevicesCount: eligibleDevices.length, uniqueEmailsCount: uniqueEmails };
}

// Eligibility statistics helper (parity with v1)
export async function getEligibilityStats(): Promise<{
  totalEligibleDevices: number;
  uniqueEmails: number;
  devicesByNodeType: Record<string, number>;
  emailsWithMultipleDevices: number;
  averageDevicesPerEmail: number;
}> {
  log.info('Gathering eligibility statistics (v2)...');

  const eligibleDevices = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { 'registration.amount': { $gt: 0 } },
      { 'node.amount': { $gt: 0 } },
      { is_registered: true },
      { ai_miner_generated: false },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: '' } }
    ]
  }).select('name email').lean();

  const devicesByEmail = eligibleDevices.reduce<Record<string, any[]>>((acc, d: any) => {
    const e = (d.email || '').trim().toLowerCase();
    if (!e) return acc;
    if (!acc[e]) acc[e] = [];
    acc[e].push(d);
    return acc;
  }, {});

  const devicesByNodeType = eligibleDevices.reduce<Record<string, number>>((acc, d: any) => {
    const nodeType = ELIGIBLE_NODE_TYPES.find(t => d.name?.includes(t)) || 'Unknown';
    acc[nodeType] = (acc[nodeType] || 0) + 1;
    return acc;
  }, {});

  const uniqueEmails = Object.keys(devicesByEmail).length;
  const emailsWithMultipleDevices = Object.values(devicesByEmail).filter(list => list.length > 1).length;
  const averageDevicesPerEmail = uniqueEmails > 0 ? Math.round((eligibleDevices.length / uniqueEmails) * 100) / 100 : 0;

  const stats = { totalEligibleDevices: eligibleDevices.length, uniqueEmails, devicesByNodeType, emailsWithMultipleDevices, averageDevicesPerEmail };
  log.success('Eligibility statistics gathered (v2)', stats);
  return stats;
}

// Single-device generate-and-send (parity with v1 helper)
export async function generateAndSendAIMinerKeyByMinerKey(
  minerKey: string,
  options: { dryRun?: boolean; forceGenerate?: boolean; addFieldIfMissing?: boolean; skipEmail?: boolean } = {}
): Promise<{
  success: boolean;
  device?: any;
  aiMinerDevice?: any;
  message: string;
  keyGenerated?: string;
  emailSent?: boolean;
  transactionId?: string;
}> {
  const { dryRun = false, forceGenerate = false, addFieldIfMissing = true, skipEmail = false } = options;
  const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  log.info(`${dryRun ? 'DRY RUN: ' : ''}[${transactionId}] Generate+Send by miner_key ${redactKey(minerKey)}`);

  // Find raw device
  const rawDevice = await DeviceModel.findOne({ miner_key: minerKey }).lean() as any;
  if (!rawDevice) {
    const message = `[${transactionId}] No device found with miner_key ${redactKey(minerKey)}`;
    log.warning(message);
    return { success: false, message, transactionId };
  }

  // Ensure ai_miner_generated field exists
  if (!('ai_miner_generated' in rawDevice)) {
    if (addFieldIfMissing) {
      if (!dryRun) await DeviceModel.updateOne({ miner_key: minerKey }, { $set: { ai_miner_generated: false } });
      rawDevice.ai_miner_generated = false;
      log.info(`[${transactionId}] ${dryRun ? 'Would add' : 'Added'} ai_miner_generated field`);
    } else {
      const message = `[${transactionId}] Missing ai_miner_generated. Set addFieldIfMissing=true`;
      log.warning(message);
      return { success: false, message, transactionId };
    }
  }

  // Already generated?
  if (rawDevice.ai_miner_generated === true && !forceGenerate) {
    const message = `[${transactionId}] Already received AI miner. Use forceGenerate=true to override.`;
    log.warning(message);
    return { success: false, device: { _id: rawDevice._id, name: rawDevice.name, order: rawDevice.order, email: redactEmail(rawDevice.email || ''), ai_miner_generated: rawDevice.ai_miner_generated }, message, transactionId };
  }

  // Eligibility
  if (!forceGenerate && !isDeviceEligible(rawDevice, true)) {
    const message = `[${transactionId}] Device not eligible (pre-check failed).`;
    log.warning(message);
    return { success: false, device: { _id: rawDevice._id, name: rawDevice.name, order: rawDevice.order, email: redactEmail(rawDevice.email || ''), ai_miner_generated: rawDevice.ai_miner_generated }, message, transactionId };
  }

  // Email required
  if (!rawDevice.email || rawDevice.email.trim() === '') {
    const message = `[${transactionId}] No email on device`;
    log.error(message);
    return { success: false, device: { _id: rawDevice._id, name: rawDevice.name, order: rawDevice.order, email: 'NO_EMAIL', ai_miner_generated: rawDevice.ai_miner_generated }, message, transactionId };
  }

  if (dryRun) {
    const aiKey = await generateMinerKey(AI_MINER_PREFIX);
    const message = `[${transactionId}] DRY RUN: Would create AEM child and send email`;
    log.success(message, { key: redactKey(aiKey) });
    return { success: true, device: { _id: rawDevice._id, name: rawDevice.name, order: rawDevice.order, email: redactEmail(rawDevice.email) }, aiMinerDevice: { miner_key: redactKey(aiKey), name: '$FRY AI Edge Miner', email: redactEmail(rawDevice.email), order: rawDevice.order, is_registered: false, enabled: false, ai_miner_generated: false, created_at: new Date() }, message, keyGenerated: redactKey(aiKey), emailSent: false, transactionId };
  }

  // Production: transaction
  const session = await mongoose.startSession();
  let aiMinerKey: string | undefined;
  let aiMinerDevice: any;
  let emailSent = false;
  let parentForEmail: { name?: string; key?: string } = {};
  try {
    await session.withTransaction(async () => {
      aiMinerKey = await generateMinerKey(AI_MINER_PREFIX);
      const childDoc: any = { miner_key: aiMinerKey, email: rawDevice.email || '', name: '$FRY AI Edge Miner', created_at: new Date(), is_registered: false, enabled: false, order: rawDevice.order || '', byod: '', email_sent: false };
      const created = await DeviceModel.create([childDoc], { session });
      aiMinerDevice = created[0];

      // Mark original
      const upd = await DeviceModel.updateOne({ _id: rawDevice._id }, { $set: { ai_miner_generated: true } }, { session });
      if (upd.modifiedCount !== 1) throw new Error('Failed to update original device');

      // Atomic parent assignment
      const assignment = await assignParentDeviceAtomic(rawDevice.email || '', rawDevice.order || '', aiMinerDevice._id.toString(), transactionId, session);
      if (assignment.success && assignment.parentDevice) {
        await DeviceModel.updateOne({ _id: aiMinerDevice._id }, { $set: { parent_device_id: assignment.parentDevice._id, parent_device_name: assignment.parentDevice.name, parent_device_miner_key: assignment.parentDevice.miner_key } }, { session });
        parentForEmail = { name: assignment.parentDevice.name, key: assignment.parentDevice.miner_key };
      }
    });

    // Email send outside the transaction, then mark email_sent in DB
    if (!skipEmail && aiMinerKey && aiMinerDevice?._id) {
      try {
        await sendMail(rawDevice.email || '', [{ key: aiMinerKey, name: '$FRY AI Edge Miner', parentDeviceName: parentForEmail.name, parentDeviceKey: parentForEmail.key }]);
        await DeviceModel.updateOne({ _id: aiMinerDevice._id }, { $set: { email_sent: true, email_sent_at: new Date() } });
        emailSent = true;
      } catch (emailErr) {
        log.error(`[${transactionId}] Email send failed`, emailErr);
      }
    }

    const message = `[${transactionId}] Successfully generated and ${emailSent ? 'sent' : 'prepared'} AI miner key`;
    log.success(message);
    return { success: true, device: { _id: rawDevice._id, name: rawDevice.name, order: rawDevice.order, email: redactEmail(rawDevice.email || ''), ai_miner_generated: true }, aiMinerDevice: { _id: aiMinerDevice._id, miner_key: redactKey(aiMinerDevice.miner_key), name: aiMinerDevice.name, email: redactEmail(aiMinerDevice.email), order: aiMinerDevice.order, is_registered: aiMinerDevice.is_registered, enabled: aiMinerDevice.enabled, ai_miner_generated: aiMinerDevice.ai_miner_generated, created_at: aiMinerDevice.created_at }, message, keyGenerated: redactKey(aiMinerKey || ''), emailSent, transactionId };
  } catch (error) {
    const message = `[${transactionId}] Failed to generate and send`;
    log.error(message, error);
    return { success: false, message: `${message}: ${error instanceof Error ? error.message : String(error)}`, transactionId };
  } finally {
    await session.endSession();
  }
}

// Per-device helper: add ai_miner_generated field (for testing)
export async function addAIMinerFieldToDevice(minerKey: string): Promise<{ success: boolean; device?: any; message: string; }> {
  log.info(`Adding ai_miner_generated field to device ${redactKey(minerKey)} (v2)`);
  const d = await DeviceModel.findOne({ miner_key: minerKey });
  if (!d) return { success: false, message: 'Device not found' };
  if ((d as any).ai_miner_generated !== undefined) {
    return { success: true, device: { _id: d._id, miner_key: redactKey(d.miner_key), ai_miner_generated: (d as any).ai_miner_generated }, message: 'Field already exists' };
  }
  const res = await DeviceModel.updateOne({ _id: d._id }, { $set: { ai_miner_generated: false } });
  if (res.modifiedCount !== 1) return { success: false, message: 'No document modified' };
  const updated = await DeviceModel.findById(d._id).lean();
  return { success: true, device: { _id: updated?._id, miner_key: redactKey(updated?.miner_key || ''), ai_miner_generated: (updated as any)?.ai_miner_generated }, message: 'Field added' };
}
