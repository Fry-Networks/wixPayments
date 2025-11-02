import { connect } from '../../db/connect.js';
import { DeviceModel } from '../../db/devices-schema.js';
import { log } from '../common/log.js';

export async function migrateDeviceFields(): Promise<void> {
  log.info('Starting migration to add ai_miner_generated field to existing devices...');
  await connect();
  const res = await DeviceModel.updateMany({ ai_miner_generated: { $exists: false } }, { $set: { ai_miner_generated: false } });
  log.success(`Added ai_miner_generated to ${res.modifiedCount} devices`);
}

