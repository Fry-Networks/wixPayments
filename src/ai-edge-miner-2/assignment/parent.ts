import { DeviceModel } from '../../db/devices-schema.js';
import mongoose from 'mongoose';
import { ELIGIBLE_NODE_TYPES } from '../common/constants.js';
import { log } from '../common/log.js';

export interface ParentAssignmentResult {
  success: boolean;
  parentDevice?: any;
  message: string;
  transactionId: string;
}

/**
 * Atomically assigns a parent device (eligible node) to the provided AEM child id.
 * Uses findOneAndUpdate with session to set parent flags and link to child.
 */
export async function assignParentDeviceAtomic(
  email: string,
  order: string,
  childDeviceId: string,
  transactionId?: string,
  session?: mongoose.ClientSession
): Promise<ParentAssignmentResult> {
  const txId = transactionId || `pa_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  log.info(`🔗 PARENT ASSIGNMENT [${txId}] Starting atomic parent claim`, { email, order, childDeviceId });

  try {
    const claimedParent = await DeviceModel.findOneAndUpdate(
      {
        email,
        order,
        ai_miner_generated: true,
        ai_edge_miner_assigned: { $ne: true },
        name: { $in: ELIGIBLE_NODE_TYPES }
      },
      {
        $set: {
          ai_edge_miner_assigned: true,
          assigned_ai_edge_miner_id: childDeviceId
        }
      },
      {
        session,
        sort: { created_at: 1 },
        returnDocument: 'after'
      }
    );

    if (claimedParent) {
      log.success(`🔗 PARENT ASSIGNMENT [${txId}] Claimed parent ${claimedParent._id} for child ${childDeviceId}`);
      return { success: true, parentDevice: claimedParent, message: 'Parent assigned', transactionId: txId };
    }

    const message = `No available parent for ${email}/${order}`;
    log.warning(`🔗 PARENT ASSIGNMENT [${txId}] ${message}`);
    return { success: true, message, transactionId: txId };
  } catch (error) {
    const message = 'Atomic parent assignment failed';
    log.error(`🔗 PARENT ASSIGNMENT [${txId}] ${message}`, error);
    return { success: false, message: `${message}: ${error instanceof Error ? error.message : String(error)}`, transactionId: txId };
  }
}

/** Find all available parents by email/order for fallback display or validation. */
export async function findAvailableParentDevices(email: string, order: string, session?: mongoose.ClientSession): Promise<any[]> {
  return await DeviceModel.find(
    {
      email,
      order,
      ai_miner_generated: true,
      ai_edge_miner_assigned: { $ne: true },
      name: { $in: ELIGIBLE_NODE_TYPES }
    },
    null,
    { session, sort: { created_at: 1 } }
  ).lean();
}

/** Unassign a parent (testing/reset). */
export async function unassignParentDevice(parentDeviceId: string, session?: mongoose.ClientSession): Promise<boolean> {
  try {
    const result = await DeviceModel.updateOne(
      { _id: parentDeviceId },
      { $unset: { ai_edge_miner_assigned: 1, assigned_ai_edge_miner_id: 1 } },
      { session }
    );
    return result.modifiedCount === 1;
  } catch (error) {
    log.error(`Failed to unassign parent ${parentDeviceId}`, error);
    return false;
  }
}

