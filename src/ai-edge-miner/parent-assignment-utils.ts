import { DeviceModel } from '../db/devices-schema.js';
import mongoose from 'mongoose';
import { ELIGIBLE_NODE_TYPES } from './common/constants.js';

// Type for parent assignment result
export interface ParentAssignmentResult {
  success: boolean;
  parentDevice?: any;
  message: string;
  transactionId: string;
}

// Logging utility for parent assignment
const assignmentLog = {
  info: (message: string, transactionId: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔗 PARENT_ASSIGNMENT [${transactionId}]: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, transactionId: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ PARENT_ASSIGNMENT [${transactionId}]: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, transactionId: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ PARENT_ASSIGNMENT [${transactionId}]: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any, txId?: string) => {
    const timestamp = new Date().toISOString();
    const id = txId || 'unknown';
    console.log(`[${timestamp}] ❌ PARENT_ASSIGNMENT [${id}]: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack}`);
    }
  }
};

/**
 * SHARED UTILITY: Atomically assigns a parent device to an AI Edge Miner
 *
 * This function encapsulates the atomic parent device assignment logic that was
 * duplicated between generateAIMinerKey(), migrateAIEdgeMinerPrefix(), and
 * performParentChildAssignment().
 *
 * @param email The email to match parent devices
 * @param order The order number to match parent devices
 * @param childDeviceId The ID of the AI Edge Miner device being assigned
 * @param transactionId Optional transaction ID for logging (auto-generated if not provided)
 * @param session Optional MongoDB session for transactions
 * @returns Promise<ParentAssignmentResult>
 */
export async function assignParentDeviceAtomic(
  email: string,
  order: string,
  childDeviceId: string,
  transactionId?: string,
  session?: mongoose.ClientSession
): Promise<ParentAssignmentResult> {
  // Generate transaction ID if not provided
  const txId = transactionId || `pa_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  assignmentLog.info(`Starting atomic parent device assignment for child: ${childDeviceId}`, txId, { email, order });


  try {
    // ATOMIC PARENT ASSIGNMENT: Find and claim an available parent device within the transaction
    // This prevents race conditions by using findOneAndUpdate with atomic operations
    const claimedParent = await DeviceModel.findOneAndUpdate(
      {
        email: email,
        order: order,
        ai_miner_generated: true,
        ai_edge_miner_assigned: { $ne: true }, // Only unassigned parents
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
        sort: { created_at: 1 }, // Deterministic ordering: oldest first
        returnDocument: 'after' // Return the updated document
      }
    );

    if (claimedParent) {
      assignmentLog.success(`Atomically claimed parent device: ${claimedParent._id} (${claimedParent.name}) for child: ${childDeviceId}`, txId);
      return {
        success: true,
        parentDevice: claimedParent,
        message: `Successfully assigned parent device ${claimedParent._id} (${claimedParent.name}) to AI Edge Miner ${childDeviceId}`,
        transactionId: txId
      };
    } else {
      const message = `No available parent device found for AI Edge Miner ${childDeviceId} (email: ${email}, order: ${order})`;
      assignmentLog.warning(message, txId);
      return {
        success: true, // Not an error condition, just no parent available
        message,
        transactionId: txId
      };
    }

  } catch (error) {
    const message = `Failed to assign parent device for AI Edge Miner ${childDeviceId}`;
    assignmentLog.error(message, error, txId);
    return {
      success: false,
      message: `${message} - Error: ${error instanceof Error ? error.message : String(error)}`,
      transactionId: txId
    };
  }
}

/**
 * SHARED UTILITY: Validates if a device can be assigned as a parent
 *
 * @param device The device to validate
 * @param email Expected email (for additional validation)
 * @param order Expected order number (for additional validation)
 * @returns boolean
 */
export function canDeviceBeParent(device: any, email: string, order: string): boolean {

  return (
    device.email === email &&
    device.order === order &&
    device.ai_miner_generated === true &&
    device.ai_edge_miner_assigned !== true &&
    ELIGIBLE_NODE_TYPES.includes(device.name)
  );
}

/**
 * SHARED UTILITY: Finds all available parent devices for debugging/validation
 *
 * @param email The email to match
 * @param order The order number to match
 * @param session Optional MongoDB session
 * @returns Promise<any[]>
 */
export async function findAvailableParentDevices(
  email: string,
  order: string,
  session?: mongoose.ClientSession
): Promise<any[]> {

  return await DeviceModel.find(
    {
      email: email,
      order: order,
      ai_miner_generated: true,
      ai_edge_miner_assigned: { $ne: true },
      name: { $in: ELIGIBLE_NODE_TYPES }
    },
    null,
    { session, sort: { created_at: 1 } }
  ).lean();
}

/**
 * SHARED UTILITY: Unassigns a parent device (used for resets/cleanup)
 *
 * @param parentDeviceId The ID of the parent device to unassign
 * @param session Optional MongoDB session
 * @returns Promise<boolean>
 */
export async function unassignParentDevice(
  parentDeviceId: string,
  session?: mongoose.ClientSession
): Promise<boolean> {
  try {
    const result = await DeviceModel.updateOne(
      { _id: parentDeviceId },
      {
        $unset: {
          ai_edge_miner_assigned: 1,
          assigned_ai_edge_miner_id: 1
        }
      },
      { session }
    );

    return result.modifiedCount === 1;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    assignmentLog.error(`Failed to unassign parent device ${parentDeviceId}`, error, 'unknown');
    return false;
  }
}
