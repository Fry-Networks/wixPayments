import { DeviceModel, Device } from '../../db/devices-schema.js';
import { ELIGIBLE_NODE_TYPES, ORDER_NUMBER_CUTOFF, ELIGIBLE_ORDER_STRINGS } from '../common/constants.js';
import { isDeviceEligible } from './eligibility.js';
import { log } from '../common/log.js';

/**
 * Dry-run which devices would be eligible for AEM generation (no writes, no email).
 */
export async function simulateAIMinerGeneration(): Promise<Device[]> {
  log.info('Starting AI Miner generation simulation (v2)...');
  const eligibleDevices: Device[] = [];

const potential = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { 'registration.amount': { $gt: 0 } },
      { 'node.amount': { $gt: 0 } },
      { is_registered: true },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: '' } }
    ]
  }).select('_id name email order registration.amount node.amount ai_miner_generated is_registered').lean();

  for (const d of potential) {
    if (isDeviceEligible(d, true)) {
      const full = await DeviceModel.findById(d._id);
      if (full) eligibleDevices.push(full);
    }
  }

  log.success(`Simulation complete. Found ${eligibleDevices.length} eligible devices.`);
  return eligibleDevices;
}

