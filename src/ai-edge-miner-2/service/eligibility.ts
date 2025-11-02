import { ELIGIBLE_NODE_TYPES, ORDER_NUMBER_CUTOFF, ELIGIBLE_ORDER_STRINGS } from '../common/constants.js';
import type { RawDeviceDocument } from '../common/types.js';

/**
 * Eligibility for receiving an AI Edge Miner child key.
 */
export function isDeviceEligible(device: RawDeviceDocument | any, checkOrderNumber = false): boolean {
  const isEligibleNodeType = ELIGIBLE_NODE_TYPES.some(type => device.name && device.name.includes(type));
  const hasRegistrationStake = device.registration && device.registration.amount && device.registration.amount > 0;
  const hasNodeOperationStake = device.node && device.node.amount && device.node.amount > 0;
  const isOfficiallyRegistered = device.is_registered === true;
  const hasNotReceivedAIMiner = ('ai_miner_generated' in device) ? !device.ai_miner_generated : true;
  const hasEmail = device.email && device.email.trim() !== '';

  let isPreCutoffOrder = true;
  if (checkOrderNumber) {
    const orderStr = (device.order || '').toString();
    const orderNum = parseInt(orderStr);
    const isWhitelisted = ELIGIBLE_ORDER_STRINGS.includes(orderStr as any);
    isPreCutoffOrder = isWhitelisted || (!isNaN(orderNum) && orderNum < ORDER_NUMBER_CUTOFF);
  }

  return isEligibleNodeType && hasRegistrationStake && hasNodeOperationStake && isOfficiallyRegistered && hasNotReceivedAIMiner && hasEmail && isPreCutoffOrder;
}

