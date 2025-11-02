import { DeviceModel } from '../../db/devices-schema.js';
import { ELIGIBLE_NODE_TYPES, ORDER_NUMBER_CUTOFF, ELIGIBLE_ORDER_STRINGS } from '../common/constants.js';
import { log } from '../common/log.js';
import { generateAIMinerKey } from './keys.js';
import { sendMail } from '../../MailProcessor.js';
import { redactEmail } from '../../redact-utils.js';
import UserModel from '../../db/users-schema.js';

/** Atomic monitor: per-device generate via generateAIMinerKey, then consolidated email/send + mark sent. */
export async function monitorNewRegistrationsAndGenerateAIMinersAtomic(): Promise<{ successCount: number; failCount: number; }> {
  let successCount = 0;
  let failCount = 0;

  const newlyEligible = await DeviceModel.find({
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

  const byEmail = newlyEligible.reduce<Record<string, any[]>>((acc, d) => {
    const em = (d.email || '').trim().toLowerCase();
    if (!em) return acc;
    if (!acc[em]) acc[em] = [];
    acc[em].push(d);
    return acc;
  }, {});

  for (const [email, devices] of Object.entries(byEmail)) {
    const createdIds: any[] = [];
    for (const device of devices) {
      try {
        const r = await generateAIMinerKey(device);
        if (r.success && r.aiMinerDevice?._id) {
          successCount++;
          createdIds.push(r.aiMinerDevice._id);
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
        log.error(`Monitor failed for ${device._id}`, e);
      }
      await new Promise(res => setTimeout(res, 30));
    }

    if (createdIds.length > 0) {
      const createdChildren = await DeviceModel.find({ _id: { $in: createdIds } })
        .select('_id miner_key parent_device_name parent_device_miner_key')
        .lean();
      const keys = createdChildren.map(d => ({
        key: d.miner_key,
        name: "$FRY AI Edge Miner",
        parentDeviceName: (d as any).parent_device_name,
        parentDeviceKey: (d as any).parent_device_miner_key
      }));
      try {
        await sendMail(email, keys);
        await DeviceModel.updateMany({ _id: { $in: createdIds } }, { $set: { email_sent: true, email_sent_at: new Date() } });
        log.success(`Sent consolidated email to ${redactEmail(email)} with ${keys.length} key(s)`);
      } catch (err) {
        log.error(`Failed sending consolidated email to ${redactEmail(email)}`, err);
      }
    }
  }

  log.success(`Atomic monitor completed`, { successCount, failCount });
  return { successCount, failCount };
}

