import { DeviceModel, Device } from '../db/devices-schema.js';
import { generateMinerKey } from '../db/utils.js';
import { sendMail } from '../MailProcessor.js';
import { redactEmail, redactKey } from '../redact-utils.js';
import mongoose from 'mongoose';
import { AI_MINER_PREFIX, ORDER_NUMBER_CUTOFF, ELIGIBLE_NODE_TYPES, ELIGIBLE_ORDER_STRINGS } from './common/constants.js';
import { assignParentDeviceAtomic, findAvailableParentDevices } from './parent-assignment-utils.js';
import { secrets } from '../config/secrets.js';

// Type for raw device documents from .lean() queries
type RawDeviceDocument = {
  _id: any;
  user_id?: any;
  miner_key?: string;
  name?: string;
  order?: string;
  email?: string;
  created_at?: Date;
  is_registered?: boolean;
  enabled?: boolean;
  registered_at?: Date;
  registration?: {
    amount?: number;
    asset_id?: string;
    time?: Date;
    txId?: string;
  };
  node?: {
    amount?: number;
    asset_id?: string;
    time?: Date;
    txId?: string;
  };
  ai_miner_generated?: boolean;
};


// Email batch configuration
const EMAIL_BATCH_CONFIG = {
  batchSize: 20,
  delayBetweenBatches: 15000, // 15 seconds
  retryPrompt: true // Manual retry/skip for failures
};

// Enhanced logging utility for AI Miner Service
const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🤖 INFO: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅🤖 SUCCESS: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️🤖 WARNING: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌🤖 ERROR: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack && secrets.nodeEnv === 'development') console.log(`   Stack: ${error.stack}`);
    }
  }
};

/**
 * Checks if a device is eligible for an AI miner key.
 * Works with both raw MongoDB documents (from .lean()) and Mongoose documents.
 * Eligibility criteria:
 * - Node type contains "Rewards Decentralization Node", "Storage Decentralization Node", or "Storage Validator Node"
 * - Has completed both registration and node operation staking
 * - Is officially registered (is_registered: true)
 * - Has not already received an AI miner key
 * - Order number is below the cutoff (for future registrations)
 * @param device The device to check (can be raw document or Mongoose document).
 * @param checkOrderNumber If true, checks if the order number is below the cutoff.
 * @returns True if the device is eligible, false otherwise.
 */
export function isDeviceEligible(device: Device | any, checkOrderNumber: boolean = false): boolean {
  const isEligibleNodeType = ELIGIBLE_NODE_TYPES.some(type => device.name && device.name.includes(type));
  const hasRegistrationStake = device.registration && device.registration.amount && device.registration.amount > 0;
  const hasNodeOperationStake = device.node && device.node.amount && device.node.amount > 0;
  const isOfficiallyRegistered = device.is_registered === true;
  
  // Handle ai_miner_generated field for both raw documents and Mongoose documents
  // For raw documents, check if field exists and its value
  // For Mongoose documents, the schema default will apply
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

/**
 * Generates an AI miner key for a given device (without sending email).
 * Email sending is now handled separately through the email queue system.
 * Now includes atomic parent device assignment to ensure 1:1 relationships.
 * @param device The device for which to generate the key.
 * @returns Object with success status and created AI miner device info.
 */
export async function generateAIMinerKey(device: Device): Promise<{
  success: boolean;
  aiMinerDevice?: any;
  parentDevice?: any;
  message: string;
}> {
  log.info(`Generating AI miner key for device: ${device._id} (Order: ${device.order}, Email: ${redactEmail(device.email)})`);

  const session = await mongoose.startSession();
  
  try {
    let aiMinerDevice: any;
    let parentDevice: any = null;
    
    await session.withTransaction(async () => {
      // ATOMIC PARENT ASSIGNMENT: Find and claim an available parent device within the transaction
      // This prevents race conditions by using findOneAndUpdate with atomic operations
      const claimedParent = await DeviceModel.findOneAndUpdate(
        {
          email: device.email,
          order: device.order,
          ai_miner_generated: true,
          ai_edge_miner_assigned: { $ne: true }, // Only unassigned parents
          name: { $in: ELIGIBLE_NODE_TYPES }
        },
        { 
          $set: { 
            ai_edge_miner_assigned: true,
            assigned_ai_edge_miner_id: device._id
          }
        },
        { 
          session,
          sort: { created_at: 1 }, // Deterministic ordering: oldest first
          returnDocument: 'after' // Return the updated document
        }
      );

      if (claimedParent) {
        parentDevice = claimedParent;
        log.info(`Atomically claimed parent device: ${parentDevice._id} (${parentDevice.name}, key: ${redactKey(parentDevice.miner_key)})`);
      } else {
        log.warning(`No available parent device found for AI Edge Miner generation from device ${device._id} (email: ${redactEmail(device.email)}, order: ${device.order})`);
      }

      // Generate AI miner key
      const minerKey = await generateMinerKey(AI_MINER_PREFIX);
      log.success(`Generated new AI miner key: ${redactKey(minerKey)} for device ${device._id}`);

      // Create new AI miner device document with parent references
      const aiMinerDeviceData: any = {
        miner_key: minerKey,
        email: device.email || '',
        name: "$FRY AI Edge Miner",
        created_at: new Date(),
        is_registered: false,
        order: device.order || '',
        byod: "",
        // Email tracking fields for AI miner documents
        email_sent: false
      };

      // Add parent device references if parent was claimed
      if (parentDevice) {
        aiMinerDeviceData.parent_device_id = parentDevice._id;
        aiMinerDeviceData.parent_device_name = parentDevice.name;
        aiMinerDeviceData.parent_device_miner_key = parentDevice.miner_key;
        log.info(`Adding parent device references to AI miner: ${parentDevice._id} (${parentDevice.name}, ${redactKey(parentDevice.miner_key)})`);
      }

      const createdDevices = await DeviceModel.create([aiMinerDeviceData], { session });
      aiMinerDevice = createdDevices[0];
      log.success(`Created new AI miner device: ${aiMinerDevice._id} with key: ${redactKey(minerKey)}${parentDevice ? ' and parent assignment' : ''}`);

      // Update original device to mark as ai_miner_generated
      const updateResult = await DeviceModel.updateOne(
        { _id: device._id },
        { $set: { ai_miner_generated: true } },
        { session }
      );

      if (updateResult.modifiedCount === 0) {
        throw new Error(`Failed to update original device ${device._id} - no documents modified`);
      }

      log.success(`Original device ${device._id} marked as ai_miner_generated: true`);
    });

    const message = `Successfully generated AI miner key for device ${device._id}${parentDevice ? ' with atomic parent assignment' : ''}. Email will be sent separately.`;
    log.success(message);

    return {
      success: true,
      aiMinerDevice: {
        _id: aiMinerDevice._id,
        miner_key: redactKey(aiMinerDevice.miner_key),
        name: aiMinerDevice.name,
        email: redactEmail(aiMinerDevice.email),
        order: aiMinerDevice.order,
        email_sent: aiMinerDevice.email_sent,
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
    const message = `Failed to generate AI miner key for device ${device._id} (Order: ${device.order}, Email: ${redactEmail(device.email)})`;
    log.error(message, error);
    return {
      success: false,
      message: `${message} - Error: ${error}`
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Performs a dry run to identify eligible devices without generating keys or sending emails.
 * Optimized to work with raw documents and avoid unnecessary database re-fetching.
 * @returns A list of eligible devices.
 */
export async function simulateAIMinerGeneration(): Promise<Device[]> {
  log.info('Starting AI Miner generation simulation...');
  const eligibleDevices: Device[] = [];

  // Find all devices that could potentially be eligible using optimized query
  const potentialDevices = await DeviceModel.find({
    $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })),
    $and: [
      { "registration.amount": { $gt: 0 } },
      { "node.amount": { $gt: 0 } },
      { is_registered: true },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: "" } }
    ]
  }).select('_id name email order registration.amount node.amount ai_miner_generated is_registered').lean();

  log.info(`Found ${potentialDevices.length} potential devices for simulation.`);

  // Filter using improved isDeviceEligible that works with raw documents
  for (const deviceData of potentialDevices) {
    if (isDeviceEligible(deviceData, true)) { // Check order number for simulation
      // Convert to Mongoose document for return type compatibility
      const device = await DeviceModel.findById(deviceData._id);
      if (device) {
        eligibleDevices.push(device);
        log.info(`Eligible device found in simulation: ${device._id} (Order: ${device.order}, Email: ${redactEmail(device.email)})`);
      }
    }
  }

  log.success(`AI Miner generation simulation complete. Found ${eligibleDevices.length} eligible devices.`);
  return eligibleDevices;
}

/**
 * One-time function to generate AI miner keys for existing eligible node runners.
 * This function only generates keys and creates AI miner documents - NO EMAIL SENDING.
 * Email sending is handled separately through the email queue system.
 */
export async function generateAIMinerKeysForEligibleUsers(emails?: string[]): Promise<{ successCount: number, failCount: number }> {
  log.info('Starting one-time generation of AI Miner keys for existing eligible users (NO EMAIL SENDING).');
  let successCount = 0;
  let failCount = 0;

  // Find all eligible devices that haven't received an AI miner yet and have a valid email
  const eligibleDevices = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { "registration.amount": { $gt: 0 } },
      { "node.amount": { $gt: 0 } },
      { is_registered: true },
      { ai_miner_generated: false },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] }, // Include whitelisted order strings
      { email: { $exists: true, $ne: "" } }
    ]
  });

  log.info(`Found ${eligibleDevices.length} existing eligible devices for key generation.`);

  // Optional filter: if emails are provided, only process those
  if (emails && emails.length > 0) {
    const filterSet = new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean));
    const filteredDevices = eligibleDevices.filter(device => {
      const email = (device.email || '').trim().toLowerCase();
      return filterSet.has(email);
    });
    log.info(`Filtered to ${filteredDevices.length} devices based on email filter.`);
  }

  for (const device of eligibleDevices) {
    try {
      // Use the existing generateAIMinerKey function which creates AI miner documents without sending emails
      const result = await generateAIMinerKey(device);
      
      if (result.success) {
        successCount++;
        log.success(`Generated AI miner key for device ${device._id} (Order: ${device.order})`);
      } else {
        failCount++;
        log.error(`Failed to generate AI miner key for device ${device._id}: ${result.message}`);
      }
    } catch (error) {
      failCount++;
      log.error(`Failed to process device ${device._id}`, error);
    }
  }

  log.success(`AI Miner key generation complete. Successfully generated: ${successCount}, Failed: ${failCount}`);
  log.info(`📧 To send emails for these keys, use the Email Distribution Management system in the CLI.`);
  return { successCount, failCount };
}

/**
 * @deprecated Use generateAIMinerKeysForEligibleUsers instead. This function still contains email logic.
 */
export async function generateFreeAIMinersForExistingUsers(emails?: string[]): Promise<{ successCount: number, failCount: number }> {
  log.warning('⚠️ DEPRECATED: generateFreeAIMinersForExistingUsers contains email logic. Use generateAIMinerKeysForEligibleUsers instead.');
  return generateAIMinerKeysForEligibleUsers(emails);
}

/**
 * Enhanced batch processing function for generating AI miner keys (NO EMAIL SENDING)
 * This function only generates keys and creates AI miner documents.
 * Email sending is handled separately through the email queue system.
 * Optimized for processing 5k+ devices efficiently
 */
export async function generateAIMinerKeysBatch(
  options: {
    emails?: string[];
    batchSize?: number;
    dryRun?: boolean;
    progressCallback?: (progress: { processed: number; total: number; currentDevice: string }) => void;
  } = {}
): Promise<{ 
  successCount: number; 
  failCount: number; 
  processedDevices: string[];
  failedDevices: string[];
  eligibleDevicesCount: number;
  uniqueEmailsCount: number;
}> {
  const { emails, batchSize = 100, dryRun = false, progressCallback } = options;
  
  log.info(`Starting ${dryRun ? 'DRY RUN' : 'BATCH'} generation of AI Miner keys (NO EMAIL SENDING)`, {
    batchSize,
    emailFilter: emails?.length || 'all',
    dryRun
  });

  let successCount = 0;
  let failCount = 0;
  const processedDevices: string[] = [];
  const failedDevices: string[] = [];

  try {
    // Find all eligible devices with optimized query
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

    log.info(`Found ${eligibleDevices.length} eligible devices for processing`);

    // Filter by emails if specified
    if (emails && emails.length > 0) {
      const filterSet = new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean));
      eligibleDevices = eligibleDevices.filter(device => {
        const email = (device.email || '').trim().toLowerCase();
        return filterSet.has(email);
      });
      log.info(`Filtered to ${eligibleDevices.length} devices based on email filter`);
    }

    // Get unique email count for reporting
    const uniqueEmails = new Set(eligibleDevices.map(d => (d.email || '').trim().toLowerCase())).size;

    if (dryRun) {
      log.warning('DRY RUN MODE - No keys will be generated');
      return {
        successCount: eligibleDevices.length,
        failCount: 0,
        processedDevices: eligibleDevices.map(d => d._id.toString()),
        failedDevices: [],
        eligibleDevicesCount: eligibleDevices.length,
        uniqueEmailsCount: uniqueEmails
      };
    }

    // Process in batches
    for (let i = 0; i < eligibleDevices.length; i += batchSize) {
      const batch = eligibleDevices.slice(i, i + batchSize);
      
      log.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eligibleDevices.length / batchSize)} (${batch.length} devices)`);

      // Process each device in the batch
      for (const device of batch) {
        // Report progress
        if (progressCallback) {
          progressCallback({
            processed: i + batch.indexOf(device) + 1,
            total: eligibleDevices.length,
            currentDevice: `${device._id} (${redactEmail(device.email)})`
          });
        }

        try {
          // Use the existing generateAIMinerKey function which creates AI miner documents without sending emails
          const result = await generateAIMinerKey(device);
          
          if (result.success) {
            successCount++;
            processedDevices.push(device._id.toString());
            log.success(`Generated AI miner key for device ${device._id} (Order: ${device.order})`);
          } else {
            failCount++;
            failedDevices.push(device._id.toString());
            log.error(`Failed to generate AI miner key for device ${device._id}: ${result.message}`);
          }
        } catch (error) {
          failCount++;
          failedDevices.push(device._id.toString());
          log.error(`Failed to process device ${device._id}`, error);
        }

        // Small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Longer delay between batches
      if (i + batchSize < eligibleDevices.length) {
        log.info(`Batch complete. Waiting 2 seconds before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    log.success(`Batch AI miner key generation complete!`, {
      successCount,
      failCount,
      processedDevices: processedDevices.length,
      failedDevices: failedDevices.length
    });

    log.info(`📧 To send emails for these keys, use the Email Distribution Management system in the CLI.`);

    return {
      successCount,
      failCount,
      processedDevices,
      failedDevices,
      eligibleDevicesCount: eligibleDevices.length,
      uniqueEmailsCount: uniqueEmails
    };

  } catch (error) {
    log.error('Batch processing failed with critical error', error);
    throw error;
  }
}

/**
 * @deprecated Use generateAIMinerKeysBatch instead. This function still contains email logic.
 */
export async function generateFreeAIMinersForExistingUsersBatch(
  options: {
    emails?: string[];
    batchSize?: number;
    dryRun?: boolean;
    progressCallback?: (progress: { processed: number; total: number; currentEmail: string }) => void;
  } = {}
): Promise<{ 
  successCount: number; 
  failCount: number; 
  processedEmails: string[];
  failedEmails: string[];
  eligibleDevicesCount: number;
  uniqueEmailsCount: number;
}> {
  log.warning('⚠️ DEPRECATED: generateFreeAIMinersForExistingUsersBatch contains email logic. Use generateAIMinerKeysBatch instead.');
  
  // Convert the new function's response to match the old interface
  const result = await generateAIMinerKeysBatch({
    emails: options.emails,
    batchSize: options.batchSize,
    dryRun: options.dryRun,
    progressCallback: options.progressCallback ? (progress) => {
      options.progressCallback!({
        processed: progress.processed,
        total: progress.total,
        currentEmail: progress.currentDevice
      });
    } : undefined
  });

  return {
    successCount: result.successCount,
    failCount: result.failCount,
    processedEmails: [], // No longer relevant since we don't send emails
    failedEmails: [], // No longer relevant since we don't send emails
    eligibleDevicesCount: result.eligibleDevicesCount,
    uniqueEmailsCount: result.uniqueEmailsCount
  };
}

/**
 * Get statistics about eligible devices without processing them
 */
export async function getEligibilityStats(): Promise<{
  totalEligibleDevices: number;
  uniqueEmails: number;
  devicesByNodeType: Record<string, number>;
  emailsWithMultipleDevices: number;
  averageDevicesPerEmail: number;
}> {
  log.info('Gathering eligibility statistics...');

  const eligibleDevices = await DeviceModel.find({
    $and: [
      { $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) },
      { "registration.amount": { $gt: 0 } },
      { "node.amount": { $gt: 0 } },
      { is_registered: true },
      { ai_miner_generated: false },
      { $or: [ { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } }, { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } } ] },
      { email: { $exists: true, $ne: "" } }
    ]
  }).select('name email').lean();

  const devicesByEmail = eligibleDevices.reduce<Record<string, any[]>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    if (!email) return acc;
    if (!acc[email]) acc[email] = [];
    acc[email].push(device);
    return acc;
  }, {});

  const devicesByNodeType = eligibleDevices.reduce<Record<string, number>>((acc, device) => {
    // Find the matching node type by checking if device name includes any of the eligible types
    const nodeType = ELIGIBLE_NODE_TYPES.find(type => device.name?.includes(type)) || 'Unknown';
    acc[nodeType] = (acc[nodeType] || 0) + 1;
    return acc;
  }, {});

  const uniqueEmails = Object.keys(devicesByEmail).length;
  const emailsWithMultipleDevices = Object.values(devicesByEmail).filter(devices => devices.length > 1).length;
  const averageDevicesPerEmail = uniqueEmails > 0 ? eligibleDevices.length / uniqueEmails : 0;

  const stats = {
    totalEligibleDevices: eligibleDevices.length,
    uniqueEmails,
    devicesByNodeType,
    emailsWithMultipleDevices,
    averageDevicesPerEmail: Math.round(averageDevicesPerEmail * 100) / 100
  };

  log.success('Eligibility statistics gathered', stats);
  return stats;
}

/**
 * Generate and send AI miner key to a specific device by miner_key
 * This is for testing individual devices before running batch operations
 * FIXED: Now creates new AI miner device documents with transaction support
 * @param minerKey The existing miner_key to search for
 * @param options Configuration options for the operation
 * @returns Result of the operation
 */
export async function generateAndSendAIMinerKeyByMinerKey(
  minerKey: string, 
  options: {
    dryRun?: boolean;
    forceGenerate?: boolean;
    addFieldIfMissing?: boolean;
    skipEmail?: boolean;
  } = {}
): Promise<{
  success: boolean;
  device?: any;
  aiMinerDevice?: any; // NEW: Return the created AI miner device
  message: string;
  keyGenerated?: string;
  emailSent?: boolean;
  transactionId?: string; // NEW: For tracking
}> {
  const { dryRun = false, forceGenerate = false, addFieldIfMissing = true, skipEmail = false } = options;
  const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  log.info(`${dryRun ? 'DRY RUN: ' : ''}[${transactionId}] Generating and sending AI miner key for device with miner_key: ${redactKey(minerKey)}`, {
    dryRun,
    forceGenerate,
    addFieldIfMissing,
    transactionId
  });

  try {
    // First, find the device using lean query to get raw document
    const rawDevice = await DeviceModel.findOne({ miner_key: minerKey }).lean() as RawDeviceDocument | null;

    if (!rawDevice) {
      const message = `[${transactionId}] No device found with miner_key: ${redactKey(minerKey)}`;
      log.warning(message);
      return {
        success: false,
        message,
        transactionId
      };
    }

    log.info(`[${transactionId}] Found original device: ${rawDevice._id} (Order: ${rawDevice.order}, Email: ${redactEmail(rawDevice.email || '')})`);

    // Check if ai_miner_generated field exists, add it if missing and requested
    if (!('ai_miner_generated' in rawDevice)) {
      if (addFieldIfMissing) {
        if (!dryRun) {
          await DeviceModel.updateOne(
            { miner_key: minerKey },
            { $set: { ai_miner_generated: false } }
          );
          log.info(`[${transactionId}] Added ai_miner_generated field to device ${rawDevice._id}`);
        } else {
          log.info(`[${transactionId}] DRY RUN: Would add ai_miner_generated field to device ${rawDevice._id}`);
        }
        // Update the raw device object for eligibility checking
        rawDevice.ai_miner_generated = false;
      } else {
        const message = `[${transactionId}] Device with miner_key ${redactKey(minerKey)} is missing ai_miner_generated field. Set addFieldIfMissing=true to add it.`;
        log.warning(message);
        return {
          success: false,
          device: {
            _id: rawDevice._id,
            name: rawDevice.name,
            order: rawDevice.order,
            email: redactEmail(rawDevice.email || ''),
            ai_miner_generated: 'MISSING'
          },
          message,
          transactionId
        };
      }
    }

    // Check if device has already received an AI miner key
    if (rawDevice.ai_miner_generated === true && !forceGenerate) {
      const message = `[${transactionId}] Device with miner_key ${redactKey(minerKey)} has already received an AI miner key. Set forceGenerate=true to override.`;
      log.warning(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: redactEmail(rawDevice.email || ''),
          ai_miner_generated: rawDevice.ai_miner_generated
        },
        message,
        transactionId
      };
    }

    // Check device eligibility (unless forcing)
    if (!forceGenerate && !isDeviceEligible(rawDevice, true)) {
      const message = `[${transactionId}] Device with miner_key ${redactKey(minerKey)} is not eligible for AI miner key. Set forceGenerate=true to override eligibility checks.`;
      log.warning(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: redactEmail(rawDevice.email || ''),
          ai_miner_generated: rawDevice.ai_miner_generated,
          is_registered: rawDevice.is_registered,
          registration_amount: rawDevice.registration?.amount || 0,
          node_amount: rawDevice.node?.amount || 0
        },
        message,
        transactionId
      };
    }

    // Validate email before proceeding
    if (!rawDevice.email || rawDevice.email.trim() === '') {
      const message = `[${transactionId}] Device with miner_key ${redactKey(minerKey)} has no email address`;
      log.error(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: 'NO_EMAIL',
          ai_miner_generated: rawDevice.ai_miner_generated
        },
        message,
        transactionId
      };
    }

    if (dryRun) {
      // Generate the AI miner key for dry run (but don't create documents)
      const aiMinerKey = await generateMinerKey(AI_MINER_PREFIX);
      log.success(`[${transactionId}] DRY RUN: Generated AI miner key: ${redactKey(aiMinerKey)} for device ${rawDevice._id}`);
      
      const message = `[${transactionId}] DRY RUN: Would create new AI miner device and update original device, but skipped due to dry run mode`;
      log.success(message);
      return {
        success: true,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: redactEmail(rawDevice.email),
          ai_miner_generated: rawDevice.ai_miner_generated
        },
        aiMinerDevice: {
          miner_key: redactKey(aiMinerKey),
          name: "$FRY AI Edge Miner",
          email: redactEmail(rawDevice.email),
          order: rawDevice.order,
          is_registered: false,
          enabled: false,
          ai_miner_generated: false,
          created_at: new Date()
        },
        message,
        keyGenerated: redactKey(aiMinerKey),
        emailSent: false,
        transactionId
      };
    }

    // Start MongoDB transaction for production operations
    const session = await mongoose.startSession();
    let aiMinerKey: string | undefined;
    let aiMinerDevice: any;
    let originalDeviceUpdated = false;
    let emailSent = false;
    let parentForEmail: { name?: string; key?: string } = {};

    try {
      await session.withTransaction(async () => {
        log.info(`[${transactionId}] Starting MongoDB transaction`);

        // Step 1: Generate AI miner key
        aiMinerKey = await generateMinerKey(AI_MINER_PREFIX);
        log.success(`[${transactionId}] Generated new AI miner key: ${redactKey(aiMinerKey)}`);

        // Step 2: Create new AI miner device document
        log.info(`[${transactionId}] Creating new AI miner device document`);
        const aiMinerDeviceData = {
          miner_key: aiMinerKey,
          email: rawDevice.email || '',
          name: "$FRY AI Edge Miner",
          created_at: new Date(),
          is_registered: false,
          enabled: false,
          order: rawDevice.order || '',
          byod: "",
          // Email tracking fields for AI miner documents
          email_sent: false
          // Note: No "registration", "node", or "ai_miner_generated" fields for AI miner documents
        };

        const createdDevices = await DeviceModel.create([aiMinerDeviceData], { session });
        aiMinerDevice = createdDevices[0];
        log.success(`[${transactionId}] Created new AI miner device: ${aiMinerDevice._id} with key: ${redactKey(aiMinerKey)}`);

        // Step 3: Update original device to mark as ai_miner_generated
        log.info(`[${transactionId}] Updating original device ${rawDevice._id} to mark as ai_miner_generated: true`);
        const updateResult = await DeviceModel.updateOne(
          { miner_key: minerKey },
          { $set: { ai_miner_generated: true } },
          { session }
        );

        if (updateResult.modifiedCount === 0) {
          throw new Error(`Failed to update original device ${rawDevice._id} - no documents modified`);
        }

        originalDeviceUpdated = true;
        log.success(`[${transactionId}] Original device ${rawDevice._id} marked as ai_miner_generated: true`);

        // Step 3.5: Atomic parent assignment and child linkage
        log.info(`[${transactionId}] Attempting atomic parent assignment for new AI Edge Miner ${aiMinerDevice._id}`);
        const parentAssignment = await assignParentDeviceAtomic(
          rawDevice.email || '',
          rawDevice.order || '',
          aiMinerDevice._id.toString(),
          transactionId,
          session
        );

        if (parentAssignment.success && parentAssignment.parentDevice) {
          await DeviceModel.updateOne(
            { _id: aiMinerDevice._id },
            {
              $set: {
                parent_device_id: parentAssignment.parentDevice._id,
                parent_device_name: parentAssignment.parentDevice.name,
                parent_device_miner_key: parentAssignment.parentDevice.miner_key
              }
            },
            { session }
          );
          log.success(
            `[${transactionId}] Linked AI Edge Miner ${aiMinerDevice._id} to parent ${parentAssignment.parentDevice._id}`
          );
          parentForEmail = { name: parentAssignment.parentDevice.name, key: parentAssignment.parentDevice.miner_key };
        } else {
          log.warning(
            `[${transactionId}] No available parent device to link for AI Edge Miner ${aiMinerDevice._id}`
          );
        }

        // Step 4: Send email (outside of transaction but before commit) - only if not skipping
        if (!skipEmail) {
          log.info(`[${transactionId}] Sending AI miner key email to ${redactEmail(rawDevice.email || '')}`);
          await sendMail(rawDevice.email || '', [{ 
            key: aiMinerKey,
            name: "$FRY AI Edge Miner",
            parentDeviceName: parentForEmail.name,
            parentDeviceKey: parentForEmail.key
          }]);
          emailSent = true;
          log.success(`[${transactionId}] AI miner key email sent successfully to ${redactEmail(rawDevice.email || '')}`);
        } else {
          log.info(`[${transactionId}] Skipping email sending as requested (skipEmail=true)`);
          emailSent = false;
        }

        log.success(`[${transactionId}] All transaction steps completed successfully`);
      });

      // Transaction committed successfully
      log.success(`[${transactionId}] MongoDB transaction committed successfully`);

      const message = `[${transactionId}] Successfully generated AI miner key and created new device document for miner_key: ${redactKey(minerKey)}`;
      log.success(message);

      return {
        success: true,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: redactEmail(rawDevice.email || ''),
          ai_miner_generated: true
        },
        aiMinerDevice: {
          _id: aiMinerDevice._id,
          miner_key: redactKey(aiMinerKey || ''),
          name: aiMinerDevice.name,
          email: redactEmail(aiMinerDevice.email),
          order: aiMinerDevice.order,
          is_registered: aiMinerDevice.is_registered,
          enabled: aiMinerDevice.enabled,
          ai_miner_generated: aiMinerDevice.ai_miner_generated,
          created_at: aiMinerDevice.created_at
        },
        message,
        keyGenerated: redactKey(aiMinerKey || ''),
        emailSent: true,
        transactionId
      };

    } catch (transactionError) {
      // Transaction will automatically rollback
      log.error(`[${transactionId}] Transaction failed and rolled back`, transactionError);
      
      // Log what was attempted
      if (aiMinerKey) {
        log.warning(`[${transactionId}] Generated key ${redactKey(aiMinerKey)} was not saved due to rollback`);
      }
      if (originalDeviceUpdated) {
        log.warning(`[${transactionId}] Original device update was rolled back`);
      }
      if (emailSent) {
        log.warning(`[${transactionId}] Email was sent but database changes were rolled back - this may require manual cleanup`);
      }

      throw transactionError;
    } finally {
      await session.endSession();
      log.info(`[${transactionId}] MongoDB session ended`);
    }

  } catch (error) {
    const message = `[${transactionId}] Failed to generate and send AI miner key for device with miner_key: ${redactKey(minerKey)}`;
    log.error(message, error);
    return {
      success: false,
      message: `${message} - Error: ${error}`,
      transactionId
    };
  }
}

/**
 * Add ai_miner_generated field (set to false) to a specific device by miner_key
 * This is for testing before running the full migration on all devices
 * @param minerKey The existing miner_key to search for
 * @returns Result of the operation
 */
export async function addAIMinerFieldToDevice(minerKey: string): Promise<{
  success: boolean;
  device?: any;
  message: string;
}> {
  log.info(`Adding ai_miner_generated field to device with miner_key: ${redactKey(minerKey)}`);

  try {
    // First, check if device exists using lean query to get raw document
    const rawDevice = await DeviceModel.findOne({ miner_key: minerKey }).lean();

    if (!rawDevice) {
      const message = `No device found with miner_key: ${redactKey(minerKey)}`;
      log.warning(message);
      return {
        success: false,
        message
      };
    }

    // Check if ai_miner_generated field actually exists in the raw document
    // This ignores Mongoose schema defaults and checks the actual MongoDB document
    if ('ai_miner_generated' in rawDevice) {
      const message = `Device with miner_key ${redactKey(minerKey)} already has ai_miner_generated field (value: ${rawDevice.ai_miner_generated})`;
      log.warning(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          order: rawDevice.order,
          email: redactEmail(rawDevice.email),
          ai_miner_generated: rawDevice.ai_miner_generated
        },
        message
      };
    }

    // Field doesn't exist, so add it using direct MongoDB update to avoid creating other fields
    const updateResult = await DeviceModel.updateOne(
      { miner_key: minerKey },
      { $set: { ai_miner_generated: false } }
    );

    if (updateResult.matchedCount === 0) {
      const message = `Device not found when trying to update: ${redactKey(minerKey)}`;
      log.error(message);
      return {
        success: false,
        message
      };
    }

    if (updateResult.modifiedCount === 0) {
      const message = `Failed to update device with miner_key: ${redactKey(minerKey)}`;
      log.error(message);
      return {
        success: false,
        message
      };
    }

    // Get the updated device for response (using lean to avoid schema defaults)
    const updatedDevice = await DeviceModel.findOne({ miner_key: minerKey }).lean();

    const message = `Successfully added ai_miner_generated=false field to device with miner_key: ${redactKey(minerKey)}`;
    log.success(message, {
      deviceId: updatedDevice?._id,
      name: updatedDevice?.name,
      order: updatedDevice?.order,
      email: redactEmail(updatedDevice?.email || '')
    });

    return {
      success: true,
      device: {
        _id: updatedDevice?._id,
        name: updatedDevice?.name,
        order: updatedDevice?.order,
        email: redactEmail(updatedDevice?.email || ''),
        ai_miner_generated: updatedDevice?.ai_miner_generated
      },
      message
    };

  } catch (error) {
    const message = `Failed to add ai_miner_generated field to device with miner_key: ${redactKey(minerKey)}`;
    log.error(message, error);
    return {
      success: false,
      message: `${message} - Error: ${error}`
    };
  }
}

/**
 * Scheduled job to monitor for newly completed registrations and generate AI miner keys.
 * This function generates keys AND sends emails immediately for newly eligible users.
 * This should run periodically (e.g., hourly).
 */
export async function monitorNewRegistrationsAndGenerateAIMiners(): Promise<{ successCount: number, failCount: number }> {
  log.info('Starting scheduled monitoring for new registrations and AI Miner generation with immediate email sending.');
  let successCount = 0;
  let failCount = 0;

  // Find devices that have completed staking, are pre-cutoff orders, and haven't received an AI miner yet
  const newlyEligibleDevices = await DeviceModel.find({
    $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })),
    "registration.amount": { $gt: 0 },
    "node.amount": { $gt: 0 },
    is_registered: true,
    ai_miner_generated: false,
    order: { $lt: ORDER_NUMBER_CUTOFF.toString() },
    email: { $exists: true, $ne: "" }
  });

  log.info(`Found ${newlyEligibleDevices.length} newly eligible devices for scheduled generation.`);

  // Group devices by email to send consolidated emails
  const devicesByEmail = newlyEligibleDevices.reduce<Record<string, Device[]>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    if (!email) return acc;
    if (!acc[email]) acc[email] = [];
    acc[email].push(device);
    return acc;
  }, {});

  const uniqueRecipients = Object.keys(devicesByEmail);
  log.info(`Processing ${uniqueRecipients.length} unique recipients for immediate email sending.`);

  for (const email of uniqueRecipients) {
    const devices = devicesByEmail[email];
    log.info(`Processing ${devices.length} device(s) for ${redactEmail(email)} with immediate email sending.`);

    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Generate AI miner keys for all devices for this recipient
        const keys: { key: string; name: string }[] = [];
        const aiMinerDevices: any[] = [];

        for (const device of devices) {
          // Generate AI miner key
          const minerKey = await generateMinerKey(AI_MINER_PREFIX);
          keys.push({ key: minerKey, name: "$FRY AI Edge Miner" });

          // Create new AI miner device document
          const aiMinerDeviceData = {
            miner_key: minerKey,
            email: device.email || '',
            name: "$FRY AI Edge Miner",
            created_at: new Date(),
            is_registered: false,
            order: device.order || '',
            byod: "",
            // Email tracking fields for AI miner documents
            email_sent: false
          };

          const createdDevices = await DeviceModel.create([aiMinerDeviceData], { session });
          aiMinerDevices.push(createdDevices[0]);
          log.success(`Created new AI miner device: ${createdDevices[0]._id} with key: ${redactKey(minerKey)}`);

          // Update original device to mark as ai_miner_generated
          const updateResult = await DeviceModel.updateOne(
            { _id: device._id },
            { $set: { ai_miner_generated: true } },
            { session }
          );

          if (updateResult.modifiedCount === 0) {
            throw new Error(`Failed to update original device ${device._id} - no documents modified`);
          }

          log.success(`Original device ${device._id} marked as ai_miner_generated: true`);
        }

        // Send consolidated email with all keys for this recipient
        await sendMail(email, keys);
        log.success(`Consolidated AI miner email sent to ${redactEmail(email)} with ${keys.length} key(s).`);

        // Mark all AI miner devices as email_sent = true
        const aiMinerDeviceIds = aiMinerDevices.map(d => d._id);
        const emailUpdateResult = await DeviceModel.updateMany(
          { _id: { $in: aiMinerDeviceIds } },
          { 
            $set: { 
              email_sent: true,
              email_sent_at: new Date()
            }
          },
          { session }
        );

        log.success(`Marked ${emailUpdateResult.modifiedCount} AI miner devices as email_sent for ${redactEmail(email)}`);
        
        successCount += devices.length;
      });

    } catch (error) {
      log.error(`Failed processing for ${redactEmail(email)} during scheduled monitoring. Rolling back changes.`, error);
      failCount += devices.length;
    } finally {
      await session.endSession();
    }
  }

  log.success(`Scheduled AI Miner generation complete. Successfully generated: ${successCount}, Failed: ${failCount}`);
  return { successCount, failCount };
}

/**
 * Atomic monitoring job: generate AEM with parent assignment and send consolidated emails.
 * Uses generateAIMinerKey() per device, fetches raw keys for email, and marks email_sent.
 */
export async function monitorNewRegistrationsAndGenerateAIMinersAtomic(): Promise<{ successCount: number, failCount: number }> {
  log.info('Starting scheduled monitoring (ATOMIC) for new registrations with consolidated email sending.');
  let successCount = 0;
  let failCount = 0;

  // Find devices that have completed staking, are pre-cutoff orders, and haven't received an AI miner yet
  const newlyEligibleDevices = await DeviceModel.find({
    $or: ELIGIBLE_NODE_TYPES.map(type => ({ name: { $regex: type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })),
    "registration.amount": { $gt: 0 },
    "node.amount": { $gt: 0 },
    is_registered: true,
    ai_miner_generated: false,
    order: { $lt: ORDER_NUMBER_CUTOFF.toString() },
    email: { $exists: true, $ne: "" }
  });

  log.info(`Found ${newlyEligibleDevices.length} newly eligible devices for scheduled generation (atomic).`);

  // Group devices by email to send consolidated emails
  const devicesByEmail = newlyEligibleDevices.reduce<Record<string, Device[]>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    if (!email) return acc;
    if (!acc[email]) acc[email] = [];
    acc[email].push(device);
    return acc;
  }, {});

  const uniqueRecipients = Object.keys(devicesByEmail);
  log.info(`Processing ${uniqueRecipients.length} unique recipients (atomic flow).`);

  for (const email of uniqueRecipients) {
    const devices = devicesByEmail[email];
    log.info(`Processing ${devices.length} device(s) for ${redactEmail(email)} with atomic parent assignment.`);

    const createdIds: any[] = [];
    const correctionOps: Array<Promise<any>> = [];

    for (const device of devices) {
      try {
        // Generate AI miner with atomic assignment via generateAIMinerKey
        const result = await generateAIMinerKey(device);

        if (result.success && result.aiMinerDevice?._id) {
          createdIds.push(result.aiMinerDevice._id);
          successCount++;

          // Safety correction: ensure parent points to child id if parent exists
          if (result.parentDevice?._id) {
            correctionOps.push(
              DeviceModel.updateOne(
                { _id: result.parentDevice._id },
                {
                  $set: {
                    ai_edge_miner_assigned: true,
                    assigned_ai_edge_miner_id: result.aiMinerDevice._id
                  }
                }
              )
            );
          }
        } else {
          failCount++;
          log.error(`Failed to generate AI miner for device ${device._id}: ${result.message}`);
        }
      } catch (error) {
        failCount++;
        log.error(`Failed to process device ${device._id} in atomic monitoring`, error);
      }

      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Apply any parent correction updates
    if (correctionOps.length > 0) {
      try {
        await Promise.allSettled(correctionOps);
      } catch (e) {
        log.warning(`Parent correction updates encountered issues for ${redactEmail(email)}`);
      }
    }

    // Fetch created AEM devices for this recipient to get raw keys
    if (createdIds.length > 0) {
      const createdAIMiners = await DeviceModel.find({ _id: { $in: createdIds } })
        .select('_id miner_key parent_device_name parent_device_miner_key')
        .lean();

      const keys = createdAIMiners.map(d => ({
        key: d.miner_key,
        name: "$FRY AI Edge Miner",
        parentDeviceName: (d as any).parent_device_name,
        parentDeviceKey: (d as any).parent_device_miner_key
      }));

      try {
        await sendMail(email, keys);
        log.success(`Consolidated AI miner email sent to ${redactEmail(email)} with ${keys.length} key(s).`);

        // Mark all created AI miner devices as email_sent = true
        const emailUpdateResult = await DeviceModel.updateMany(
          { _id: { $in: createdIds } },
          {
            $set: {
              email_sent: true,
              email_sent_at: new Date()
            }
          }
        );

        log.success(`Marked ${emailUpdateResult.modifiedCount} AI miner devices as email_sent for ${redactEmail(email)}`);
      } catch (emailError) {
        log.error(`Failed sending consolidated email to ${redactEmail(email)} in atomic monitoring`, emailError);
      }
    }
  }

  log.success(`Scheduled (ATOMIC) AI Miner generation complete. Successfully generated: ${successCount}, Failed: ${failCount}`);
  return { successCount, failCount };
}

// ============================================================================
// EMAIL QUEUE MANAGEMENT SYSTEM
// ============================================================================

/**
 * Get statistics about the email queue (AI miner devices pending email)
 */
export async function getEmailQueueStats(): Promise<{
  totalPendingEmails: number;
  uniqueRecipients: number;
  emailsByRecipient: Record<string, number>;
  oldestPendingDevice: Date | null;
  newestPendingDevice: Date | null;
}> {
  log.info('📊 Gathering email queue statistics...');

  // Find all AI miner devices that haven't had emails sent
  const pendingDevices = await DeviceModel.find({
    name: "$FRY AI Edge Miner",
    miner_key: { $regex: /^AEM-/ },
    email_sent: false,
    email: { $exists: true, $ne: "" }
  }).select('email created_at').lean();

  log.info(`Found ${pendingDevices.length} AI miner devices pending email`);

  // Group by email address
  const emailsByRecipient = pendingDevices.reduce<Record<string, number>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    if (!email) return acc;
    acc[email] = (acc[email] || 0) + 1;
    return acc;
  }, {});

  const uniqueRecipients = Object.keys(emailsByRecipient).length;

  // Find oldest and newest pending devices
  const sortedByDate = pendingDevices.sort((a, b) => 
    new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  );

  const stats = {
    totalPendingEmails: pendingDevices.length,
    uniqueRecipients,
    emailsByRecipient,
    oldestPendingDevice: sortedByDate.length > 0 ? sortedByDate[0].created_at : null,
    newestPendingDevice: sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].created_at : null
  };

  log.success('📊 Email queue statistics gathered', stats);
  return stats;
}

/**
 * Preview what emails would be sent (dry run for email queue)
 */
export async function previewEmailQueue(options: {
  limit?: number;
  emails?: string[];
} = {}): Promise<{
  emailsToSend: Array<{
    email: string;
    deviceCount: number;
    devices: Array<{
      _id: any;
      miner_key: string;
      created_at: Date;
      parentDeviceName?: string;
      parentDeviceKey?: string;
    }>;
  }>;
  totalDevices: number;
  totalRecipients: number;
}> {
  const { limit, emails } = options;
  
  log.info('🔍 Previewing email queue...', { limit, emailFilter: emails?.length || 'all' });

  // Find all AI miner devices that haven't had emails sent
  let query: any = {
    name: "$FRY AI Edge Miner",
    miner_key: { $regex: /^AEM-/ },
    email_sent: false,
    email: { $exists: true, $ne: "" }
  };

  // Filter by specific emails if provided
  if (emails && emails.length > 0) {
    const emailSet = new Set(emails.map(e => e.trim().toLowerCase()));
    query.email = { $in: Array.from(emailSet) };
  }

  const pendingDevices = await DeviceModel.find(query)
    .select('_id email miner_key created_at order parent_device_id parent_device_name parent_device_miner_key')
    .lean();

  log.info(`Found ${pendingDevices.length} AI miner devices pending email`);

  // Group by email address and enhance with parent device information
  const devicesByEmail = pendingDevices.reduce<Record<string, any[]>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    if (!email) return acc;
    if (!acc[email]) acc[email] = [];
    acc[email].push(device);
    return acc;
  }, {});

  // Convert to array and enhance with parent device data
  let emailsToSend = await Promise.all(Object.entries(devicesByEmail).map(async ([email, devices]) => {
    // Enhance devices with parent device information if not already present
    const enhancedDevices = await Promise.all(devices.map(async (device) => {
      let parentDeviceName = device.parent_device_name;
      let parentDeviceKey = device.parent_device_miner_key;

      // If parent device info is not stored, try to find it using the matching logic
      if (!parentDeviceName || !parentDeviceKey) {
        log.info(`Finding parent device for AI Edge Miner ${device._id} (email: ${redactEmail(device.email || '')}, order: ${device.order})`);
        
        const parents = await findAvailableParentDevices(device.email, device.order);
        if (parents.length > 0) {
          const parentDevice = parents[0];
          parentDeviceName = parentDevice.name;
          parentDeviceKey = parentDevice.miner_key;
          log.success(`Found parent device for AI Edge Miner ${device._id}: ${parentDevice._id} (${parentDevice.name})`);
        } else {
          log.warning(`No parent device found for AI Edge Miner ${device._id}`);
        }
      }

      return {
        _id: device._id,
        miner_key: device.miner_key,
        created_at: device.created_at,
        parentDeviceName,
        parentDeviceKey
      };
    }));

    return {
      email,
      deviceCount: enhancedDevices.length,
      devices: enhancedDevices
    };
  }));

  // Sort by device count (most devices first) then by email
  emailsToSend.sort((a, b) => {
    if (a.deviceCount !== b.deviceCount) {
      return b.deviceCount - a.deviceCount;
    }
    return a.email.localeCompare(b.email);
  });

  // Apply limit if specified
  if (limit && limit > 0) {
    emailsToSend = emailsToSend.slice(0, limit);
  }

  const totalDevices = emailsToSend.reduce((sum, item) => sum + item.deviceCount, 0);
  const totalRecipients = emailsToSend.length;

  const preview = {
    emailsToSend,
    totalDevices,
    totalRecipients
  };

  log.success('🔍 Email queue preview generated', {
    totalRecipients,
    totalDevices,
    limitApplied: limit || 'none'
  });

  return preview;
}

/**
 * Send pending emails in batches with rate limiting and manual retry
 */
export async function sendPendingEmailsBatch(options: {
  batchSize?: number;
  delayBetweenBatches?: number;
  emails?: string[];
  dryRun?: boolean;
  progressCallback?: (progress: { 
    processed: number; 
    total: number; 
    currentEmail: string;
    currentBatch: number;
    totalBatches: number;
  }) => void;
  retryCallback?: (email: string, error: any) => Promise<'retry' | 'skip' | 'abort'>;
} = {}): Promise<{
  successCount: number;
  failCount: number;
  processedEmails: string[];
  failedEmails: string[];
  skippedEmails: string[];
  aborted: boolean;
}> {
  const { 
    batchSize = EMAIL_BATCH_CONFIG.batchSize,
    delayBetweenBatches = EMAIL_BATCH_CONFIG.delayBetweenBatches,
    emails,
    dryRun = false,
    progressCallback,
    retryCallback
  } = options;

  log.info(`📧 ${dryRun ? 'DRY RUN: ' : ''}Starting batch email sending`, {
    batchSize,
    delayBetweenBatches,
    emailFilter: emails?.length || 'all',
    dryRun
  });

  let successCount = 0;
  let failCount = 0;
  const processedEmails: string[] = [];
  const failedEmails: string[] = [];
  const skippedEmails: string[] = [];
  let aborted = false;

  try {
    // Get preview of what we're going to send
    const preview = await previewEmailQueue({ emails });
    const emailsToProcess = preview.emailsToSend;

    if (emailsToProcess.length === 0) {
      log.warning('📧 No emails found in queue to process');
      return {
        successCount: 0,
        failCount: 0,
        processedEmails: [],
        failedEmails: [],
        skippedEmails: [],
        aborted: false
      };
    }

    log.info(`📧 Processing ${emailsToProcess.length} unique recipients with ${preview.totalDevices} total devices`);

    if (dryRun) {
      log.warning('📧 DRY RUN MODE - No emails will be sent, no database updates');
      return {
        successCount: preview.totalDevices,
        failCount: 0,
        processedEmails: emailsToProcess.map(e => e.email),
        failedEmails: [],
        skippedEmails: [],
        aborted: false
      };
    }

    const totalBatches = Math.ceil(emailsToProcess.length / batchSize);

    // Process in batches
    for (let i = 0; i < emailsToProcess.length; i += batchSize) {
      const batch = emailsToProcess.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      
      log.info(`📧 Processing batch ${currentBatch}/${totalBatches} (${batch.length} emails)`);

      // Process each email in the batch
      for (const emailItem of batch) {
        const { email, devices } = emailItem;
        
        // Report progress
        if (progressCallback) {
          progressCallback({
            processed: i + batch.indexOf(emailItem) + 1,
            total: emailsToProcess.length,
            currentEmail: email,
            currentBatch,
            totalBatches
          });
        }

        let emailSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!emailSuccess && retryCount < maxRetries) {
          const session = await mongoose.startSession();
          
          try {
            await session.withTransaction(async () => {
              log.info(`📧 Sending email to ${redactEmail(email)} (${devices.length} AI miner keys)`);

              // Prepare email content with parent device information
              const keys = await Promise.all(devices.map(async device => {
                // Find parent device for this AI Edge Miner
                const aiMinerDevice = await DeviceModel.findById(device._id).lean();
                
                // Check if parent device info is already stored in the AI Edge Miner device
                if (aiMinerDevice?.parent_device_id && aiMinerDevice?.parent_device_name && aiMinerDevice?.parent_device_miner_key) {
                  return {
                    key: device.miner_key,
                    name: "$FRY AI Edge Miner",
                    parentDeviceName: aiMinerDevice.parent_device_name,
                    parentDeviceKey: aiMinerDevice.parent_device_miner_key
                  };
                } else {
                  // If parent device info is not stored, try to find it using the matching logic
                  log.info(`Finding parent device for AI Edge Miner ${device._id} (email: ${redactEmail(aiMinerDevice?.email || '')}, order: ${aiMinerDevice?.order})`);
                  
                  const parents = await findAvailableParentDevices(aiMinerDevice?.email || '', aiMinerDevice?.order || '');
                  if (parents.length > 0) {
                    const parentDevice = parents[0];
                    log.success(`Found parent device for AI Edge Miner ${device._id}: ${parentDevice._id} (${parentDevice.name})`);
                    return {
                      key: device.miner_key,
                      name: "$FRY AI Edge Miner",
                      parentDeviceName: parentDevice.name,
                      parentDeviceKey: parentDevice.miner_key
                    };
                  } else {
                    log.warning(`No parent device found for AI Edge Miner ${device._id}`);
                    return {
                      key: device.miner_key,
                      name: "$FRY AI Edge Miner"
                    };
                  }
                }
              }));

              // Send email
              await sendMail(email, keys);
              log.success(`📧 Email sent to ${redactEmail(email)} with ${keys.length} key(s)`);

              // Mark all devices as email_sent = true
              const deviceIds = devices.map(d => d._id);
              const updateResult = await DeviceModel.updateMany(
                { _id: { $in: deviceIds } },
                { 
                  $set: { 
                    email_sent: true,
                    email_sent_at: new Date()
                  }
                },
                { session }
              );

              log.success(`📧 Marked ${updateResult.modifiedCount} AI miner devices as email_sent for ${redactEmail(email)}`);
              
              emailSuccess = true;
              successCount += devices.length;
              processedEmails.push(email);
            });

          } catch (error) {
            retryCount++;
            log.error(`📧 Failed to send email to ${redactEmail(email)} (attempt ${retryCount}/${maxRetries})`, error);
            
            if (retryCount >= maxRetries) {
              // Max retries reached, ask user what to do
              if (retryCallback) {
                const action = await retryCallback(email, error);
                
                switch (action) {
                  case 'retry':
                    retryCount = 0; // Reset retry count
                    log.info(`📧 User chose to retry ${redactEmail(email)}`);
                    break;
                  case 'skip':
                    log.warning(`📧 User chose to skip ${redactEmail(email)}`);
                    failCount += devices.length;
                    skippedEmails.push(email);
                    emailSuccess = true; // Exit retry loop
                    break;
                  case 'abort':
                    log.error(`📧 User chose to abort batch processing`);
                    aborted = true;
                    return {
                      successCount,
                      failCount,
                      processedEmails,
                      failedEmails,
                      skippedEmails,
                      aborted: true
                    };
                }
              } else {
                // No retry callback, mark as failed
                failCount += devices.length;
                failedEmails.push(email);
                emailSuccess = true; // Exit retry loop
              }
            }
          } finally {
            await session.endSession();
          }

          // Small delay between retries
          if (!emailSuccess && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // Small delay between emails to prevent overwhelming the email service
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Delay between batches
      if (i + batchSize < emailsToProcess.length) {
        log.info(`📧 Batch ${currentBatch} complete. Waiting ${delayBetweenBatches/1000} seconds before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    log.success(`📧 Batch email sending complete!`, {
      successCount,
      failCount,
      processedEmails: processedEmails.length,
      failedEmails: failedEmails.length,
      skippedEmails: skippedEmails.length
    });

    return {
      successCount,
      failCount,
      processedEmails,
      failedEmails,
      skippedEmails,
      aborted: false
    };

  } catch (error) {
    log.error('📧 Batch email sending failed with critical error', error);
    throw error;
  }
}

/**
 * Get email sending history with parent device information
 */
export async function getEmailSendingHistory(options: {
  limit?: number;
  days?: number;
} = {}): Promise<{
  sentEmails: Array<{
    email: string;
    deviceCount: number;
    sentAt: Date;
    devices: Array<{
      _id: any;
      miner_key: string;
      email_sent_at: Date;
      parentDeviceName?: string;
      parentDeviceKey?: string;
    }>;
  }>;
  totalSentDevices: number;
  totalSentRecipients: number;
  dateRange: {
    from: Date;
    to: Date;
  };
}> {
  const { limit = 100, days = 30 } = options;
  
  log.info('📋 Gathering email sending history...', { limit, days });

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  // Find all AI miner devices that have had emails sent
  const sentDevices = await DeviceModel.find({
    name: "$FRY AI Edge Miner",
    miner_key: { $regex: /^AEM-/ },
    email_sent: true,
    email_sent_at: { $gte: fromDate },
    email: { $exists: true, $ne: "" }
  })
  .select('_id email miner_key email_sent_at order parent_device_id parent_device_name parent_device_miner_key')
  .sort({ email_sent_at: -1 })
  .lean();

  log.info(`Found ${sentDevices.length} AI miner devices with sent emails in the last ${days} days`);

  // Group by email address and sent date (rounded to hour for grouping)
  const devicesByEmailAndTime = sentDevices.reduce<Record<string, any[]>>((acc, device) => {
    const email = (device.email || '').trim().toLowerCase();
    const sentAt = new Date(device.email_sent_at || 0);
    // Round to hour for grouping emails sent around the same time
    const hourKey = new Date(sentAt.getFullYear(), sentAt.getMonth(), sentAt.getDate(), sentAt.getHours());
    const key = `${email}|${hourKey.getTime()}`;
    
    if (!acc[key]) acc[key] = [];
    acc[key].push(device);
    return acc;
  }, {});

  // Convert to array format and enhance with parent device information
  let sentEmails = await Promise.all(Object.entries(devicesByEmailAndTime).map(async ([key, devices]) => {
    const [email, timeStr] = key.split('|');
    const sentAt = new Date(parseInt(timeStr));
    
    // Enhance devices with parent device information if not already present
    const enhancedDevices = await Promise.all(devices.map(async (device) => {
      let parentDeviceName = device.parent_device_name;
      let parentDeviceKey = device.parent_device_miner_key;

      // If parent device info is not stored, try to find it using the matching logic
      if (!parentDeviceName || !parentDeviceKey) {
        log.info(`Finding parent device for AI Edge Miner ${device._id} (email: ${redactEmail(device.email || '')}, order: ${device.order})`);
        
        const parentDevices = await DeviceModel.find({
          email: device.email,
          order: device.order,
          ai_miner_generated: true,
          name: { $in: ELIGIBLE_NODE_TYPES }
        }).lean();

        if (parentDevices.length > 0) {
          // Use the first parent device (creation order)
          const parentDevice = parentDevices.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())[0];
          parentDeviceName = parentDevice.name;
          parentDeviceKey = parentDevice.miner_key;
          log.success(`Found parent device for AI Edge Miner ${device._id}: ${parentDevice._id} (${parentDevice.name})`);
        } else {
          log.warning(`No parent device found for AI Edge Miner ${device._id}`);
        }
      }

      return {
        _id: device._id,
        miner_key: device.miner_key,
        email_sent_at: device.email_sent_at,
        parentDeviceName,
        parentDeviceKey
      };
    }));
    
    return {
      email,
      deviceCount: enhancedDevices.length,
      sentAt,
      devices: enhancedDevices
    };
  }));

  // Sort by sent date (most recent first)
  sentEmails.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  // Apply limit
  if (limit > 0) {
    sentEmails = sentEmails.slice(0, limit);
  }

  const totalSentDevices = sentEmails.reduce((sum, item) => sum + item.deviceCount, 0);
  const totalSentRecipients = sentEmails.length;

  const history = {
    sentEmails,
    totalSentDevices,
    totalSentRecipients,
    dateRange: {
      from: fromDate,
      to: new Date()
    }
  };

  log.success('📋 Email sending history gathered', {
    totalSentRecipients,
    totalSentDevices,
    daysBack: days
  });

  return history;
}

/**
 * Reset email queue status (for testing)
 */
export async function resetEmailQueueStatus(options: {
  emails?: string[];
  dryRun?: boolean;
} = {}): Promise<{
  resetCount: number;
  affectedEmails: string[];
}> {
  const { emails, dryRun = false } = options;
  
  log.info(`🔄 ${dryRun ? 'DRY RUN: ' : ''}Resetting email queue status...`, {
    emailFilter: emails?.length || 'all',
    dryRun
  });

  let query: any = {
    name: "$FRY AI Edge Miner",
    miner_key: { $regex: /^AEM-/ },
    email_sent: true
  };

  // Filter by specific emails if provided
  if (emails && emails.length > 0) {
    const emailSet = new Set(emails.map(e => e.trim().toLowerCase()));
    query.email = { $in: Array.from(emailSet) };
  }

  if (dryRun) {
    const devicesToReset = await DeviceModel.find(query).select('email').lean();
    const affectedEmails = [...new Set(devicesToReset.map(d => d.email).filter(Boolean))];
    
    log.success(`🔄 DRY RUN: Would reset ${devicesToReset.length} devices for ${affectedEmails.length} unique emails`);
    
    return {
      resetCount: devicesToReset.length,
      affectedEmails
    };
  }

  // Get affected emails before reset
  const devicesToReset = await DeviceModel.find(query).select('email').lean();
  const affectedEmails = [...new Set(devicesToReset.map(d => d.email).filter(Boolean))];

  // Reset email status
  const updateResult = await DeviceModel.updateMany(
    query,
    { 
      $set: { email_sent: false },
      $unset: { email_sent_at: 1 }
    }
  );

  log.success(`🔄 Reset email status for ${updateResult.modifiedCount} AI miner devices`);

  return {
    resetCount: updateResult.modifiedCount,
    affectedEmails
  };
}

/**
 * Migrate a single AI Edge Miner device from ANM prefix to AEM prefix, remove unwanted fields, and add parent device references
 * This is for testing individual devices before running the full migration on all devices
 * @param minerKey The existing miner_key to search for (should have ANM prefix)
 * @param options Configuration options for the operation
 * @returns Result of the migration operation
 */
export async function migrateSingleAIEdgeMinerPrefix(
  minerKey: string,
  options: {
    dryRun?: boolean;
  } = {}
): Promise<{
  success: boolean;
  device?: any;
  parentDevice?: any;
  oldKey?: string;
  newKey?: string;
  removedFields?: string[];
  addedFields?: string[];
  message: string;
}> {
  const { dryRun = false } = options;
  
  log.info(`${dryRun ? 'DRY RUN: ' : ''}Migrating single AI Edge Miner prefix for device with miner_key: ${redactKey(minerKey)}`, {
    dryRun
  });

  try {
    // First, find the device using lean query to get raw document
    const rawDevice = await DeviceModel.findOne({ miner_key: minerKey }).lean() as RawDeviceDocument | null;

    if (!rawDevice) {
      const message = `No device found with miner_key: ${redactKey(minerKey)}`;
      log.warning(message);
      return {
        success: false,
        message
      };
    }

    log.info(`Found device: ${rawDevice._id} (Name: ${rawDevice.name}, Email: ${redactEmail(rawDevice.email || '')})`);

    // Verify this is an AI Edge Miner device
    if (rawDevice.name !== "$FRY AI Edge Miner") {
      const message = `Device with miner_key ${redactKey(minerKey)} is not an AI Edge Miner (name: ${rawDevice.name})`;
      log.warning(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          miner_key: redactKey(rawDevice.miner_key || ''),
          email: redactEmail(rawDevice.email || '')
        },
        message
      };
    }

    // Verify this has ANM prefix
    if (!rawDevice.miner_key || !rawDevice.miner_key.startsWith('ANM-')) {
      const message = `Device with miner_key ${redactKey(minerKey)} does not have ANM prefix (current: ${redactKey(rawDevice.miner_key || '')})`;
      log.warning(message);
      return {
        success: false,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          miner_key: redactKey(rawDevice.miner_key || ''),
          email: redactEmail(rawDevice.email || '')
        },
        message
      };
    }

    // Generate new AEM key from ANM key
    const newMinerKey = rawDevice.miner_key.replace(/^ANM-/, 'AEM-');
    
    // Find parent device by matching email, order, and ai_miner_generated: true
    log.info(`Finding parent device for AI Edge Miner: email=${redactEmail(rawDevice.email || '')}, order=${rawDevice.order}`);
    
    const parentDevices = await DeviceModel.find({
      email: rawDevice.email,
      order: rawDevice.order,
      ai_miner_generated: true,
      name: { $in: ELIGIBLE_NODE_TYPES }
    }).lean();

    let parentDevice: any = null;
    if (parentDevices.length === 0) {
      log.warning(`No parent device found for AI Edge Miner ${rawDevice._id} (email: ${redactEmail(rawDevice.email || '')}, order: ${rawDevice.order})`);
    } else if (parentDevices.length === 1) {
      parentDevice = parentDevices[0];
      log.success(`Found parent device: ${parentDevice._id} (${parentDevice.name}, key: ${redactKey(parentDevice.miner_key || '')})`);
    } else {
      // Multiple parent devices found - use the first one (creation order)
      parentDevice = parentDevices.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())[0];
      log.warning(`Multiple parent devices found for AI Edge Miner ${rawDevice._id}, using first one: ${parentDevice._id} (${parentDevice.name})`);
    }
    
    // Identify fields to remove
    const fieldsToRemove: string[] = [];
    if ('enabled' in rawDevice) fieldsToRemove.push('enabled');
    if ('ai_miner_generated' in rawDevice) fieldsToRemove.push('ai_miner_generated');

    // Identify fields to add
    const addedFields: string[] = [];
    if (parentDevice) {
      addedFields.push('parent_device_id', 'parent_device_name', 'parent_device_miner_key');
    }

    log.info(`Migration plan: ${redactKey(rawDevice.miner_key)} → ${redactKey(newMinerKey)}, removing fields: [${fieldsToRemove.join(', ')}], adding parent fields: [${addedFields.join(', ')}]`);

    if (dryRun) {
      const message = `DRY RUN: Would migrate ${redactKey(rawDevice.miner_key)} → ${redactKey(newMinerKey)} and remove fields: [${fieldsToRemove.join(', ')}]`;
      log.success(message);
      return {
        success: true,
        device: {
          _id: rawDevice._id,
          name: rawDevice.name,
          miner_key: redactKey(rawDevice.miner_key),
          email: redactEmail(rawDevice.email || ''),
          enabled: rawDevice.enabled,
          ai_miner_generated: rawDevice.ai_miner_generated
        },
        oldKey: redactKey(rawDevice.miner_key),
        newKey: redactKey(newMinerKey),
        removedFields: fieldsToRemove,
        message
      };
    }

    // Perform the actual migration atomically and set parent flags via utility
    log.info(`Performing migration for device ${rawDevice._id}`);
    const session = await mongoose.startSession();
    let claimedParent: any = null;

    try {
      await session.withTransaction(async () => {
        // Build base update (key change + field removals)
        const updateOperation: any = {
          $set: { miner_key: newMinerKey }
        };

        if (fieldsToRemove.length > 0) {
          updateOperation.$unset = {};
          fieldsToRemove.forEach((field) => {
            updateOperation.$unset[field] = 1;
          });
        }

        // Apply base update
        const updateResult = await DeviceModel.updateOne(
          { _id: rawDevice._id },
          updateOperation,
          { session }
        );

        if (updateResult.modifiedCount === 0) {
          throw new Error(`Failed to migrate device ${rawDevice._id} - no documents modified`);
        }

        // Atomically claim a parent and update child with parent refs if available
        const assignment = await assignParentDeviceAtomic(
          rawDevice.email || '',
          rawDevice.order || '',
          rawDevice._id.toString(),
          undefined,
          session
        );

        if (assignment.success && assignment.parentDevice) {
          claimedParent = assignment.parentDevice;
          await DeviceModel.updateOne(
            { _id: rawDevice._id },
            {
              $set: {
                parent_device_id: claimedParent._id,
                parent_device_name: claimedParent.name,
                parent_device_miner_key: claimedParent.miner_key
              }
            },
            { session }
          );
          log.success(`Linked AI Edge Miner ${rawDevice._id} to parent ${claimedParent._id}`);
        } else {
          log.warning(`No available parent device found to link for AI Edge Miner ${rawDevice._id}`);
        }
      });
    } finally {
      await session.endSession();
    }

    // Get the updated device for response
    const updatedDevice = await DeviceModel.findById(rawDevice._id).lean();

    const message = `Successfully migrated device ${rawDevice._id}: ${redactKey(rawDevice.miner_key)} → ${redactKey(newMinerKey)}${fieldsToRemove.length > 0 ? ` and removed fields: [${fieldsToRemove.join(', ')}]` : ''}`;
    log.success(message);

    return {
      success: true,
      device: {
        _id: updatedDevice?._id,
        name: updatedDevice?.name,
        miner_key: redactKey(updatedDevice?.miner_key || ''),
        email: redactEmail(updatedDevice?.email || ''),
        // Show that these fields are now removed
        enabled: undefined,
        ai_miner_generated: undefined,
        // Show parent device references if added
        parent_device_id: updatedDevice?.parent_device_id,
        parent_device_name: updatedDevice?.parent_device_name,
        parent_device_miner_key: updatedDevice?.parent_device_miner_key ? redactKey(updatedDevice.parent_device_miner_key) : undefined
      },
      parentDevice: claimedParent ? {
        _id: claimedParent._id,
        name: claimedParent.name,
        miner_key: redactKey(claimedParent.miner_key || ''),
        email: redactEmail(claimedParent.email || ''),
        order: claimedParent.order
      } : null,
      oldKey: redactKey(rawDevice.miner_key),
      newKey: redactKey(newMinerKey),
      removedFields: fieldsToRemove,
      addedFields: addedFields,
      message
    };

  } catch (error) {
    const message = `Failed to migrate prefix for device with miner_key: ${redactKey(minerKey)}`;
    log.error(message, error);
    return {
      success: false,
      message: `${message} - Error: ${error}`
    };
  }
}
