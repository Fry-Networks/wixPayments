#!/usr/bin/env node
import readline from 'readline';
import { connect as connectDb } from '../../db/connect.js';
import { DeviceModel } from '../../db/devices-schema.js';
import { redactKey } from '../../redact-utils.js';
import { getEmailQueueStats, previewEmailQueue, sendPendingEmailsBatch, getEmailSendingHistory, resetEmailQueueStatus } from '../service/email-queue.js';
import { generateAIMinerKeysForEligibleUsers, generateAIMinerKeysBatch, getEligibilityStats, generateAndSendAIMinerKeyByMinerKey, addAIMinerFieldToDevice } from '../service/keys.js';
import { monitorNewRegistrationsAndGenerateAIMinersAtomic } from '../service/monitor.js';
import { migrateDeviceFields } from '../migration/migrate-fields.js';
import { migrateAIEdgeMinerPrefix } from '../migration/migrate-prefix.js';
import { resetParentAssignmentTracking } from '../migration/reset.js';
import { validateParentChildRelationships, generateParentChildAssignmentReport, quickHealthCheck } from '../validation/relationships.js';
import { simulateAIMinerGeneration } from '../service/simulation.js';
import { ELIGIBLE_NODE_TYPES } from '../common/constants.js';
import { sendMail } from '../../MailProcessor.js';

const colors = { reset: '\x1b[0m', bright: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m' };
const emojis = { robot: '🤖', stats: '📊', email: '📧', batch: '⚡', clock: '⏰', gear: '⚙️', check: '✅', warn: '⚠️', error: '❌', test: '🧪' };

class AEM2CLI {
  private rl: readline.Interface;
  private connected = false;
  constructor() { this.rl = readline.createInterface({ input: process.stdin, output: process.stdout }); }
  private async ensureConn() { if (this.connected) return true; await connectDb(); this.connected = true; return true; }
  private async prompt(q: string) { return new Promise<string>(r => this.rl.question(`${colors.yellow}${q}${colors.reset} `, r)); }
  private header(t: string) { const line = '═'.repeat(60); console.log(`\n${colors.bright}${colors.blue}${line}${colors.reset}`); console.log(`${colors.bright}${colors.blue}${t}${colors.reset}`); console.log(`${colors.bright}${colors.blue}${line}${colors.reset}\n`); }

  async main() {
    await this.ensureConn();
    while (true) {
      this.header(`${emojis.robot} AI Edge Miner v2 CLI`);
      console.log(`1. ${emojis.stats} Quick Health Check`);
      console.log(`2. ${emojis.test} Validate Parent-Child Relationships`);
      console.log(`3. ${emojis.batch} Generate Keys (One-time)`);
      console.log(`4. ${emojis.clock} Run Atomic Monitor Once`);
      console.log(`5. ${emojis.email} Email Queue: Preview/Send/History/Reset`);
      console.log(`6. ${emojis.gear} Migrations (Fields/Prefix/Reset)`);
      console.log(`7. ${emojis.test} Simulation (Dry Run)`);
      console.log(`8. ${emojis.stats} Eligibility Stats`);
      console.log(`9. ${emojis.test} Single Device: Generate+Send by miner_key`);
      console.log(`10. ${emojis.gear} Add ai_miner_generated to device`);
      console.log(`11. ${emojis.email} Verify AEM child email_sent status`);
      console.log(`12. ${emojis.email} Resend AEM email by miner_key (no writes)`);
      console.log(`0. Exit`);
      const choice = parseInt(await this.prompt('Select option')); if (choice === 0) break;
      try {
        if (choice === 1) { const r = await quickHealthCheck(); console.log(r); }
        else if (choice === 2) {
          const fix = (await this.prompt('Attempt to fix duplicates? (y/N)')).toLowerCase().startsWith('y');
          const dry = (await this.prompt('Dry run (no writes)? (Y/n)')).toLowerCase().startsWith('n') ? false : true;
          const r = await validateParentChildRelationships({ dryRun: dry, fixDuplicates: fix });
          console.log(r);
        }
        else if (choice === 3) { const emailsRaw = await this.prompt('Filter emails (comma-separated, optional)'); const emails = emailsRaw ? emailsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined; const res = await generateAIMinerKeysForEligibleUsers(emails); console.log(res); }
        else if (choice === 4) { const res = await monitorNewRegistrationsAndGenerateAIMinersAtomic(); console.log(res); }
        else if (choice === 5) { await this.emailMenu(); }
        else if (choice === 6) { await this.migrationMenu(); }
        else if (choice === 7) { await this.runSimulation(); }
        else if (choice === 8) { await this.showEligibilityStats(); }
        else if (choice === 9) { await this.singleDeviceGenerateSend(); }
        else if (choice === 10) { await this.addAIMinerField(); }
        else if (choice === 11) { await this.verifyChildEmailStatus(); }
        else if (choice === 12) { await this.resendEmailByMinerKey(); }
      } catch (e) { console.error('Operation failed', e); }
    }
    this.rl.close();
  }

  private async emailMenu() {
    this.header(`${emojis.email} Email Queue`);
    console.log(`1. Stats`); console.log(`2. Preview`); console.log(`3. Send Batch`); console.log(`4. History`); console.log(`5. Reset Sent → Pending`); console.log(`0. Back`);
    const c = parseInt(await this.prompt('Select')); if (c === 0) return;
    if (c === 1) { await getEmailQueueStats(); }
    if (c === 2) { const limit = parseInt(await this.prompt('Limit (0 for all)')); const emailsRaw = await this.prompt('Filter emails (comma, optional)'); const emails = emailsRaw ? emailsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined; console.log(await previewEmailQueue({ limit: isNaN(limit) ? undefined : limit, emails })); }
    if (c === 3) { const size = parseInt(await this.prompt('Batch size (default 20)')); const delay = parseInt(await this.prompt('Delay ms between batches (default 15000)')); const res = await sendPendingEmailsBatch({ batchSize: isNaN(size) ? undefined : size, delayBetweenBatches: isNaN(delay) ? undefined : delay }); console.log(res); }
    if (c === 4) { const days = parseInt(await this.prompt('Days back (default 30)')); const limit = parseInt(await this.prompt('Limit (default 100)')); console.log(await getEmailSendingHistory({ days: isNaN(days) ? undefined : days, limit: isNaN(limit) ? undefined : limit })); }
    if (c === 5) { const emailsRaw = await this.prompt('Filter emails (comma, optional)'); const emails = emailsRaw ? emailsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined; console.log(await resetEmailQueueStatus({ emails })); }
  }

  private async migrationMenu() {
    this.header(`${emojis.gear} Migrations`);
    console.log(`1. Add ai_miner_generated to devices`);
    console.log(`2. Migrate ANM→AEM for AEM children`);
    console.log(`3. Reset parent-child tracking`);
    console.log(`0. Back`);
    const c = parseInt(await this.prompt('Select'));
    if (c === 0) return;
    if (c === 1) { await migrateDeviceFields(); console.log({ done: true }); }
    if (c === 2) { const dry = (await this.prompt('Dry run? (y/N)')).toLowerCase().startsWith('y'); console.log(await migrateAIEdgeMinerPrefix({ dryRun: dry })); }
    if (c === 3) { const dry = (await this.prompt('Dry run? (y/N)')).toLowerCase().startsWith('y'); console.log(await resetParentAssignmentTracking({ dryRun: dry })); }
  }

  private async runSimulation() {
    this.header(`${emojis.test} Simulation (Dry Run)`);
    const devices = await simulateAIMinerGeneration();
    const grouped = devices.reduce((acc: Record<string, { email: string; count: number; devices: Array<{ id: any; name: string; order: string }> }>, d: any) => {
      const em = (d.email || '').trim().toLowerCase();
      if (!em) return acc;
      if (!acc[em]) acc[em] = { email: em, count: 0, devices: [] };
      acc[em].count += 1;
      acc[em].devices.push({ id: d._id, name: d.name, order: d.order });
      return acc;
    }, {});

    const summary = {
      totalEligibleDevices: devices.length,
      totalUniqueEmails: Object.keys(grouped).length,
      deviceBreakdown: devices.reduce((acc: Record<string, number>, d: any) => { const t = d.name; acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
      groupedByEmail: Object.values(grouped)
    };
    console.log(summary);
  }

  private async showEligibilityStats() {
    this.header(`${emojis.stats} Eligibility Stats`);
    const stats = await getEligibilityStats();
    console.log(stats);
  }

  private async singleDeviceGenerateSend() {
    this.header(`${emojis.test} Single Device: Generate+Send`);
    const minerKey = await this.prompt('Enter existing device miner_key');
    if (!minerKey || !minerKey.trim()) { console.log('miner_key required'); return; }
    const force = (await this.prompt('Force generate if already generated? (y/N)')).toLowerCase().startsWith('y');
    const addField = (await this.prompt('Add ai_miner_generated if missing? (Y/n)')).toLowerCase().startsWith('n') ? false : true;
    const skipEmail = (await this.prompt('Skip email send? (y/N)')).toLowerCase().startsWith('y');
    const res = await generateAndSendAIMinerKeyByMinerKey(minerKey.trim(), { forceGenerate: force, addFieldIfMissing: addField, skipEmail });
    console.log(res);

    // Verify email_sent on created child, if any
    const childId = (res as any)?.aiMinerDevice?._id;
    if (childId) {
      const doc = await DeviceModel.findById(childId).select('_id miner_key email_sent email_sent_at parent_device_id parent_device_name parent_device_miner_key').lean();
      console.log({
        verify: 'email_sent status',
        _id: doc?._id,
        miner_key: doc?.miner_key ? redactKey(doc.miner_key) : undefined,
        email_sent: doc?.email_sent,
        email_sent_at: doc?.email_sent_at,
        parent_device_id: doc?.parent_device_id,
        parent_device_name: doc?.parent_device_name,
        parent_device_miner_key: doc?.parent_device_miner_key ? redactKey(doc.parent_device_miner_key) : undefined
      });
    }
  }

  private async addAIMinerField() {
    this.header(`${emojis.gear} Add ai_miner_generated to device`);
    const minerKey = await this.prompt('Enter device miner_key');
    if (!minerKey || !minerKey.trim()) { console.log('miner_key required'); return; }
    const res = await addAIMinerFieldToDevice(minerKey.trim());
    console.log(res);
  }

  private async verifyChildEmailStatus() {
    this.header(`${emojis.email} Verify AEM child email_sent status`);
    const input = await this.prompt('Enter AEM child _id or AEM miner_key');
    if (!input || !input.trim()) { console.log('Input required'); return; }
    const trimmed = input.trim();
    const query: any = trimmed.startsWith('AEM-') ? { miner_key: trimmed } : { _id: trimmed };
    const doc = await DeviceModel.findOne(query).select('_id miner_key email_sent email_sent_at parent_device_id parent_device_name parent_device_miner_key').lean();
    if (!doc) { console.log('No matching AEM device found'); return; }
    console.log({
      _id: doc._id,
      miner_key: doc.miner_key ? redactKey(doc.miner_key) : undefined,
      email_sent: doc.email_sent,
      email_sent_at: doc.email_sent_at,
      parent_device_id: doc.parent_device_id,
      parent_device_name: doc.parent_device_name,
      parent_device_miner_key: doc.parent_device_miner_key ? redactKey(doc.parent_device_miner_key) : undefined
    });
  }

  private async resendEmailByMinerKey() {
    this.header(`${emojis.email} Resend AEM Email (no DB writes)`);
    const input = await this.prompt('Enter miner_key (parent or AEM)');
    if (!input || !input.trim()) { console.log('miner_key required'); return; }
    const minerKey = input.trim();
    const device = await DeviceModel.findOne({ miner_key: minerKey }).lean();
    if (!device) { console.log('No device found with that miner_key'); return; }
    const email = (device.email || '').trim();
    if (!email) { console.log('Device has no email on record'); return; }

    // If input is an AEM child
    if (device.name === '$FRY AI Edge Miner' || minerKey.startsWith('AEM-')) {
      let parentName = (device as any).parent_device_name as string | undefined;
      let parentKey = (device as any).parent_device_miner_key as string | undefined;

      // Resolve parent if missing
      if ((!parentName || !parentKey) && (device as any).parent_device_id) {
        const parentDoc = await DeviceModel.findById((device as any).parent_device_id).select('name miner_key').lean();
        if (parentDoc) { parentName = parentDoc.name; parentKey = parentDoc.miner_key; }
      }
      if (!parentName || !parentKey) {
        const parentDoc = await DeviceModel.findOne({
          email: device.email,
          order: device.order,
          name: { $in: ELIGIBLE_NODE_TYPES as unknown as string[] },
          ai_miner_generated: true
        }).sort({ created_at: 1 }).select('name miner_key').lean();
        if (parentDoc) { parentName = parentDoc.name; parentKey = parentDoc.miner_key; }
      }
      const keys = [{ key: device.miner_key, name: '$FRY AI Edge Miner', parentDeviceName: parentName, parentDeviceKey: parentKey }];
      console.log({ resend: 'AEM child', to: email, keyCount: 1, parentIncluded: !!(parentName && parentKey) });
      await sendMail(email, keys);
      console.log({ status: 'email sent' });
      return;
    }

    // Otherwise treat as parent (RDN/SVN/SDN/CN)
    const parent = device;

    // Prefer linked child via assigned_ai_edge_miner_id
    let children = [] as any[];
    if ((parent as any).assigned_ai_edge_miner_id) {
      const child = await DeviceModel.findById((parent as any).assigned_ai_edge_miner_id).select('_id miner_key').lean();
      if (child) children.push(child);
    }

    // Fallback by child backrefs
    if (children.length === 0) {
      children = await DeviceModel.find({
        $or: [
          { parent_device_id: parent._id },
          { parent_device_miner_key: parent.miner_key },
          { email: parent.email, order: parent.order, name: '$FRY AI Edge Miner' }
        ]
      }).select('_id miner_key').lean();
    }

    if (!children.length) { console.log('No AEM children found for this parent'); return; }
    
    const keys = children.map(ch => ({ key: ch.miner_key, name: '$FRY AI Edge Miner', parentDeviceName: parent.name, parentDeviceKey: parent.miner_key }));
    console.log({ resend: 'parent', to: email, keyCount: keys.length, parentIncluded: true });
    await sendMail(email, keys);
    console.log({ status: 'email sent' });
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  new AEM2CLI().main().catch(err => { console.error(err); process.exit(1); });
}

export default AEM2CLI;
