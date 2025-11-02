import { connect } from '../db/connect.js';
import { DeviceModel } from '../db/devices-schema.js';
import { ELIGIBLE_NODE_TYPES } from './common/constants.js';

// Migration script to add new fields to existing devices
const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔄 MIGRATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ MIGRATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ MIGRATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ MIGRATION: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack}`);
    }
  }
};

export async function migrateDeviceFields(): Promise<void> {
  log.info('Starting migration to add ai_miner_generated field to existing devices...');
  
  try {
    await connect();
    
    // Add ai_miner_generated field to devices that don't have it
    const aiMinerResult = await DeviceModel.updateMany(
      { ai_miner_generated: { $exists: false } },
      { $set: { ai_miner_generated: false } }
    );
    log.success(`Added ai_miner_generated field to ${aiMinerResult.modifiedCount} devices`);
    
    log.success('Migration completed successfully!', {
      ai_miner_generated: aiMinerResult.modifiedCount
    });
    
  } catch (error) {
    log.error('Migration failed', error);
    throw error;
  }
}

/**
 * Migrates AI Edge Miner devices from ANM prefix to AEM prefix, removes enabled field, and adds parent device references
 * @param options Configuration options for the migration
 * @returns Migration results with counts and details
 */
export async function migrateAIEdgeMinerPrefix(options: {
  dryRun?: boolean;
  batchSize?: number;
  progressCallback?: (progress: { processed: number; total: number; currentDevice: string }) => void;
} = {}): Promise<{
  success: boolean;
  totalFound: number;
  successCount: number;
  failCount: number;
  processedDevices: string[];
  failedDevices: string[];
  parentDevicesFound: number;
  parentDevicesNotFound: number;
  message: string;
}> {
  const { dryRun = false, batchSize = 100, progressCallback } = options;
  
  log.info(`${dryRun ? 'DRY RUN: ' : ''}Starting AI Edge Miner prefix migration (ANM → AEM), enabled field removal, and parent device reference population...`, {
    dryRun,
    batchSize
  });

  let successCount = 0;
  let failCount = 0;
  let parentDevicesFound = 0;
  let parentDevicesNotFound = 0;
  const processedDevices: string[] = [];
  const failedDevices: string[] = [];


  try {
    await connect();

    // Find all devices with ANM prefix that are AI Edge Miners
    const devicesToMigrate = await DeviceModel.find({
      miner_key: { $regex: /^ANM-/ },
      name: "$FRY AI Edge Miner"
    }).select('_id miner_key name email order enabled').lean();

    const totalFound = devicesToMigrate.length;
    log.info(`Found ${totalFound} AI Edge Miner devices with ANM prefix to migrate`);

    if (totalFound === 0) {
      const message = 'No AI Edge Miner devices with ANM prefix found to migrate';
      log.info(message);
      return {
        success: true,
        totalFound: 0,
        successCount: 0,
        failCount: 0,
        processedDevices: [],
        failedDevices: [],
        parentDevicesFound: 0,
        parentDevicesNotFound: 0,
        message
      };
    }

    if (dryRun) {
      log.info('DRY RUN: Would migrate the following devices:');
      
      // Show sample of what would be migrated with parent device matching
      for (let i = 0; i < Math.min(5, devicesToMigrate.length); i++) {
        const device = devicesToMigrate[i];
        const newKey = device.miner_key.replace(/^ANM-/, 'AEM-');
        
        // Find parent device for dry run preview
        const parentDevices = await DeviceModel.find({
          email: device.email,
          order: device.order,
          ai_miner_generated: true,
          name: { $in: ELIGIBLE_NODE_TYPES }
        }).select('_id name miner_key created_at').lean();

        let parentInfo = 'No parent found';
        if (parentDevices.length === 1) {
          parentInfo = `Parent: ${parentDevices[0].name} (${parentDevices[0].miner_key})`;
        } else if (parentDevices.length > 1) {
          const sortedParents = parentDevices.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
          parentInfo = `Parent: ${sortedParents[0].name} (${sortedParents[0].miner_key}) [${parentDevices.length} candidates, using first]`;
        }
        
        log.info(`${i + 1}. ${device._id}: ${device.miner_key} → ${newKey} | ${parentInfo}`);
      }
      
      if (devicesToMigrate.length > 5) {
        log.info(`... and ${devicesToMigrate.length - 5} more devices`);
      }

      const message = `DRY RUN: Would migrate ${totalFound} devices from ANM to AEM prefix, remove enabled field, and populate parent device references`;
      log.success(message);
      return {
        success: true,
        totalFound,
        successCount: totalFound,
        failCount: 0,
        processedDevices: devicesToMigrate.map(d => d._id.toString()),
        failedDevices: [],
        parentDevicesFound: 0, // Would need to calculate in real dry run
        parentDevicesNotFound: 0,
        message
      };
    }

    // Process devices in batches
    for (let i = 0; i < devicesToMigrate.length; i += batchSize) {
      const batch = devicesToMigrate.slice(i, i + batchSize);
      
      log.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(devicesToMigrate.length / batchSize)} (${batch.length} devices)`);

      for (const device of batch) {
        // Report progress
        if (progressCallback) {
          progressCallback({
            processed: i + batch.indexOf(device) + 1,
            total: devicesToMigrate.length,
            currentDevice: `${device._id} (${device.miner_key})`
          });
        }

        try {
          // Generate new AEM key from ANM key
          const newMinerKey = device.miner_key.replace(/^ANM-/, 'AEM-');
          
          log.info(`Migrating device ${device._id}: ${device.miner_key} → ${newMinerKey}`);

          // Use transaction to ensure atomic parent assignment
          const session = await DeviceModel.db.startSession();
          
          try {
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
                log.info(`Atomically claimed parent device: ${parentDevice._id} (${parentDevice.name}, key: ${parentDevice.miner_key})`);
                parentDevicesFound++;
              } else {
                log.warning(`No available parent device found for AI Edge Miner ${device._id} (email: ${device.email}, order: ${device.order})`);
                parentDevicesNotFound++;
              }

              // Build update operation for AI Edge Miner device
              const updateOperation: any = {
                $set: { miner_key: newMinerKey },
                $unset: { enabled: 1, ai_miner_generated: 1 }
              };

              // Add parent device references if parent was claimed
              if (parentDevice) {
                updateOperation.$set.parent_device_id = parentDevice._id;
                updateOperation.$set.parent_device_name = parentDevice.name;
                updateOperation.$set.parent_device_miner_key = parentDevice.miner_key;
                log.info(`Adding parent device references: ${parentDevice._id} (${parentDevice.name}, ${parentDevice.miner_key})`);
              }

              // Update the AI Edge Miner device
              const updateResult = await DeviceModel.updateOne(
                { _id: device._id },
                updateOperation,
                { session }
              );

              if (updateResult.modifiedCount !== 1) {
                throw new Error(`Failed to update AI Edge Miner device ${device._id}: no documents modified`);
              }

              log.success(`Transaction completed for device ${device._id}: ${device.miner_key} → ${newMinerKey}${parentDevice ? ' with atomic parent assignment' : ''}`);
            });

            // Transaction succeeded
            successCount++;
            processedDevices.push(device._id.toString());
            
          } catch (transactionError) {
            // Transaction failed and was rolled back
            failCount++;
            failedDevices.push(device._id.toString());
            log.error(`Transaction failed for device ${device._id}`, transactionError);
            
            // If this was a parent assignment conflict, it's expected and we can retry
            if (transactionError instanceof Error && transactionError.message.includes('assigned to another AI Edge Miner')) {
              log.info(`Parent assignment conflict detected for device ${device._id} - this is normal in concurrent scenarios`);
            }
          } finally {
            await session.endSession();
          }

        } catch (error) {
          failCount++;
          failedDevices.push(device._id.toString());
          log.error(`Failed to migrate device ${device._id}`, error);
        }

        // Small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Longer delay between batches
      if (i + batchSize < devicesToMigrate.length) {
        log.info(`Batch complete. Waiting 1 second before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const message = `Migration completed! Successfully migrated ${successCount}/${totalFound} devices from ANM to AEM prefix, removed enabled field, and populated parent device references`;
    log.success(message, {
      totalFound,
      successCount,
      failCount,
      processedDevices: processedDevices.length,
      failedDevices: failedDevices.length,
      parentDevicesFound,
      parentDevicesNotFound
    });

    return {
      success: failCount === 0,
      totalFound,
      successCount,
      failCount,
      processedDevices,
      failedDevices,
      parentDevicesFound,
      parentDevicesNotFound,
      message
    };

  } catch (error) {
    const message = 'AI Edge Miner prefix migration failed with critical error';
    log.error(message, error);
    throw error;
  }
}

/**
 * Reset parent device assignment tracking fields for testing
 * This allows you to re-run the migration and test the 1:1 assignment logic
 * @param options Configuration options for the reset
 * @returns Reset results with counts
 */
export async function resetParentAssignmentTracking(options: {
  dryRun?: boolean;
  emails?: string[];
  orders?: string[];
} = {}): Promise<{
  success: boolean;
  resetParentDevicesCount: number;
  resetAIEdgeMinerCount: number;
  message: string;
}> {
  const { dryRun = false, emails, orders } = options;
  
  log.info(`${dryRun ? 'DRY RUN: ' : ''}Resetting parent device assignment tracking fields...`, {
    dryRun,
    emailFilter: emails?.length || 'all',
    orderFilter: orders?.length || 'all'
  });

  try {
    await connect();

    // Build query filters
    let parentQuery: any = {
      ai_edge_miner_assigned: true
    };
    
    let aiEdgeMinerQuery: any = {
      name: "$FRY AI Edge Miner",
      miner_key: { $regex: /^AEM-/ },
      parent_device_id: { $exists: true }
    };

    // Apply email filter if provided
    if (emails && emails.length > 0) {
      const emailFilter = { email: { $in: emails } };
      parentQuery = { ...parentQuery, ...emailFilter };
      aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...emailFilter };
    }

    // Apply order filter if provided
    if (orders && orders.length > 0) {
      const orderFilter = { order: { $in: orders } };
      parentQuery = { ...parentQuery, ...orderFilter };
      aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...orderFilter };
    }

    if (dryRun) {
      // Count what would be reset
      const parentDevicesToReset = await DeviceModel.countDocuments(parentQuery);
      const aiEdgeMinersToReset = await DeviceModel.countDocuments(aiEdgeMinerQuery);
      
      const message = `DRY RUN: Would reset ${parentDevicesToReset} parent devices and ${aiEdgeMinersToReset} AI Edge Miners`;
      log.success(message);
      
      return {
        success: true,
        resetParentDevicesCount: parentDevicesToReset,
        resetAIEdgeMinerCount: aiEdgeMinersToReset,
        message
      };
    }

    // Reset parent device assignment tracking
    const parentResetResult = await DeviceModel.updateMany(
      parentQuery,
      { 
        $unset: { 
          ai_edge_miner_assigned: 1,
          assigned_ai_edge_miner_id: 1
        }
      }
    );

    // Reset AI Edge Miner parent references
    const aiEdgeMinerResetResult = await DeviceModel.updateMany(
      aiEdgeMinerQuery,
      { 
        $unset: { 
          parent_device_id: 1,
          parent_device_name: 1,
          parent_device_miner_key: 1
        }
      }
    );

    const message = `Reset completed! Cleared assignment tracking for ${parentResetResult.modifiedCount} parent devices and ${aiEdgeMinerResetResult.modifiedCount} AI Edge Miners`;
    log.success(message);

    return {
      success: true,
      resetParentDevicesCount: parentResetResult.modifiedCount,
      resetAIEdgeMinerCount: aiEdgeMinerResetResult.modifiedCount,
      message
    };

  } catch (error) {
    const message = 'Reset parent assignment tracking failed with critical error';
    log.error(message, error);
    throw error;
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDeviceFields()
    .then(() => {
      log.success('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      log.error('Migration script failed', error);
      process.exit(1);
    });
}
