import { DeviceModel } from '../../db/devices-schema.js';
import { log } from '../common/log.js';
import { findAvailableParentDevices } from '../assignment/parent.js';
import { sendMail } from '../../MailProcessor.js';
import { redactEmail } from '../../redact-utils.js';
import UserModel from '../../db/users-schema.js';

export async function getEmailQueueStats(): Promise<{ totalPendingEmails: number; uniqueRecipients: number; emailsByRecipient: Record<string, number>; oldestPendingDevice: Date | null; newestPendingDevice: Date | null; }> {
  let pending = await DeviceModel.find({ name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, email_sent: false, email: { $exists: true, $ne: '' } }).select('email created_at').lean();
  const emails = [...new Set(pending.map(d => (d.email || '').trim().toLowerCase()).filter(Boolean))];
  if (emails.length) {
    const unsub = await UserModel.find({ email: { $in: emails }, do_not_email: true }).select('email').lean();
    const unsubSet = new Set(unsub.map(u => (u.email || '').trim().toLowerCase()));
    if (unsubSet.size) pending = pending.filter(d => !unsubSet.has((d.email || '').trim().toLowerCase()));
  }
  const byEmail = pending.reduce<Record<string, number>>((acc, d) => { const e = (d.email || '').trim().toLowerCase(); if (!e) return acc; acc[e] = (acc[e] || 0) + 1; return acc; }, {});
  const sorted = pending.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  const result = {
    totalPendingEmails: pending.length,
    uniqueRecipients: Object.keys(byEmail).length,
    emailsByRecipient: byEmail,
    oldestPendingDevice: sorted[0]?.created_at || null,
    newestPendingDevice: sorted[sorted.length - 1]?.created_at || null
  };
  log.success('Queue stats', result);
  return result;
}

export async function previewEmailQueue(options: { limit?: number; emails?: string[] } = {}) {
  const { limit, emails } = options;
  const q: any = { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, email_sent: false, email: { $exists: true, $ne: '' } };
  if (emails && emails.length) q.email = { $in: emails.map(e => e.trim().toLowerCase()) };
  let pending = await DeviceModel.find(q).select('_id email miner_key created_at order parent_device_id parent_device_name parent_device_miner_key').lean();
  const emailsAll = [...new Set(pending.map(d => (d.email || '').trim().toLowerCase()).filter(Boolean))];
  if (emailsAll.length) {
    const unsub = await UserModel.find({ email: { $in: emailsAll }, do_not_email: true }).select('email').lean();
    const unsubSet = new Set(unsub.map(u => (u.email || '').trim().toLowerCase()));
    if (unsubSet.size) pending = pending.filter(d => !unsubSet.has((d.email || '').trim().toLowerCase()));
  }
  const byEmail = pending.reduce<Record<string, any[]>>((acc, d) => { const e = (d.email || '').trim().toLowerCase(); if (!acc[e]) acc[e] = []; acc[e].push(d); return acc; }, {});

  let emailsToSend = await Promise.all(Object.entries(byEmail).map(async ([email, devices]) => {
    const enhanced = await Promise.all(devices.map(async (d: any) => {
      let parentDeviceName = d.parent_device_name;
      let parentDeviceKey = d.parent_device_miner_key;
      if (!parentDeviceName || !parentDeviceKey) {
        const parents = await findAvailableParentDevices(d.email, d.order);
        if (parents.length > 0) {
          parentDeviceName = parents[0].name;
          parentDeviceKey = parents[0].miner_key;
        }
      }
      return { _id: d._id, miner_key: d.miner_key, created_at: d.created_at, parentDeviceName, parentDeviceKey };
    }));
    return { email, deviceCount: enhanced.length, devices: enhanced };
  }));

  emailsToSend.sort((a, b) => (b.deviceCount - a.deviceCount) || a.email.localeCompare(b.email));
  if (limit && limit > 0) emailsToSend = emailsToSend.slice(0, limit);
  const totalDevices = emailsToSend.reduce((s, i) => s + i.deviceCount, 0);
  return { emailsToSend, totalDevices, totalRecipients: emailsToSend.length };
}

export async function sendPendingEmailsBatch(options: {
  batchSize?: number;
  delayBetweenBatches?: number;
  emails?: string[];
  dryRun?: boolean;
  progressCallback?: (p: { processed: number; total: number; currentEmail: string; currentBatch: number; totalBatches: number; }) => void;
  retryCallback?: (email: string, error: any) => Promise<'retry' | 'skip' | 'abort'>;
} = {}) {
  const { batchSize = 20, delayBetweenBatches = 15000, emails, dryRun = false, progressCallback, retryCallback } = options;
  const preview = await previewEmailQueue({ emails });
  const toProcess = preview.emailsToSend;
  if (toProcess.length === 0) return { successCount: 0, failCount: 0, processedEmails: [], failedEmails: [], skippedEmails: [], aborted: false };
  if (dryRun) return { successCount: preview.totalDevices, failCount: 0, processedEmails: toProcess.map(e => e.email), failedEmails: [], skippedEmails: [], aborted: false };

  let successCount = 0, failCount = 0; const processedEmails: string[] = []; const failedEmails: string[] = []; const skippedEmails: string[] = [];
  const totalBatches = Math.ceil(toProcess.length / batchSize);
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);
    for (const item of batch) {
      const idx = i + batch.indexOf(item) + 1;
      progressCallback?.({ processed: idx, total: toProcess.length, currentEmail: item.email, currentBatch: Math.floor(i / batchSize) + 1, totalBatches });
      try {
        await sendMail(item.email, item.devices.map(d => ({ key: d.miner_key, name: '$FRY AI Edge Miner', parentDeviceName: d.parentDeviceName, parentDeviceKey: d.parentDeviceKey })));
        processedEmails.push(item.email);
        successCount += item.deviceCount;
        const ids = item.devices.map(d => d._id);
        await DeviceModel.updateMany({ _id: { $in: ids } }, { $set: { email_sent: true, email_sent_at: new Date() } });
      } catch (err) {
        if (retryCallback) {
          const action = await retryCallback(item.email, err);
          if (action === 'retry') { i -= batchSize; break; }
          if (action === 'skip') { skippedEmails.push(item.email); continue; }
          if (action === 'abort') return { successCount, failCount, processedEmails, failedEmails, skippedEmails, aborted: true };
        }
        failedEmails.push(item.email);
        failCount += item.deviceCount;
      }
      await new Promise(res => setTimeout(res, 50));
    }
    if (i + batchSize < toProcess.length) await new Promise(res => setTimeout(res, delayBetweenBatches));
  }
  return { successCount, failCount, processedEmails, failedEmails, skippedEmails, aborted: false };
}

export async function getEmailSendingHistory(options: { limit?: number; days?: number } = {}) {
  const { limit = 100, days = 30 } = options;
  const from = new Date(); from.setDate(from.getDate() - days);
  const sentDevices = await DeviceModel.find({ name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, email_sent: true, email_sent_at: { $gte: from }, email: { $exists: true, $ne: '' } }).select('_id email miner_key email_sent_at order parent_device_id parent_device_name parent_device_miner_key').sort({ email_sent_at: -1 }).lean();
  const byEmailAndHour = sentDevices.reduce<Record<string, any[]>>((acc, d) => { const e = (d.email || '').trim().toLowerCase(); const t = new Date(d.email_sent_at || 0); const hour = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours()).getTime(); const key = `${e}|${hour}`; if (!acc[key]) acc[key] = []; acc[key].push(d); return acc; }, {});
  let sentEmails = await Promise.all(Object.entries(byEmailAndHour).map(async ([k, list]) => {
    const [email, ts] = k.split('|');
    const sentAt = new Date(parseInt(ts));
    const enhanced = await Promise.all(list.map(async (d: any) => {
      let parentDeviceName = d.parent_device_name;
      let parentDeviceKey = d.parent_device_miner_key;
      if (!parentDeviceName || !parentDeviceKey) {
        const parents = await findAvailableParentDevices(d.email, d.order);
        if (parents.length > 0) { parentDeviceName = parents[0].name; parentDeviceKey = parents[0].miner_key; }
      }
      return { _id: d._id, miner_key: d.miner_key, email_sent_at: d.email_sent_at, parentDeviceName, parentDeviceKey };
    }));
    return { email, deviceCount: enhanced.length, sentAt, devices: enhanced };
  }));
  sentEmails.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  if (limit > 0) sentEmails = sentEmails.slice(0, limit);
  const totalSentDevices = sentEmails.reduce((s, i) => s + i.deviceCount, 0);
  return { sentEmails, totalSentDevices, totalSentRecipients: sentEmails.length, dateRange: { from, to: new Date() } };
}

export async function resetEmailQueueStatus(options: { emails?: string[]; dryRun?: boolean } = {}) {
  const { emails, dryRun = false } = options;
  const q: any = { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ }, email_sent: true };
  if (emails && emails.length) q.email = { $in: emails.map(e => e.trim().toLowerCase()) };
  if (dryRun) {
    const toReset = await DeviceModel.find(q).select('email').lean();
    const affected = [...new Set(toReset.map(d => d.email).filter(Boolean))];
    return { resetCount: toReset.length, affectedEmails: affected };
  }
  const affectedDocs = await DeviceModel.find(q).select('email').lean();
  const affectedEmails = [...new Set(affectedDocs.map(d => d.email).filter(Boolean))];
  const upd = await DeviceModel.updateMany(q, { $set: { email_sent: false }, $unset: { email_sent_at: 1 } });
  return { resetCount: upd.modifiedCount, affectedEmails };
}

