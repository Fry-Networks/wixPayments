import { connect } from '../db/connect.js';
import { DeviceModel } from '../db/devices-schema.js';

// Verification logging utility
const verifyLog = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔍 VERIFY: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ VERIFY: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ VERIFY: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ VERIFY: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack}`);
    }
  }
};

/**
 * Verify the migration results to ensure 1:1 parent-child relationships
 */
export async function verifyMigrationResults(): Promise<{
  success: boolean;
  summary: string;
  details: any;
}> {
  verifyLog.info('🔍 Starting migration results verification...');
  
  try {
    await connect();
    
    // Find all migrated AI Edge Miners (AEM prefix)
    const migratedAIEdgeMiners = await DeviceModel.find({
      miner_key: { $regex: /^AEM-/ },
      name: "$FRY AI Edge Miner"
    }).lean();
    
    verifyLog.info(`Found ${migratedAIEdgeMiners.length} migrated AI Edge Miners`);
    
    // Find all parent devices that are assigned
    const assignedParents = await DeviceModel.find({
      ai_edge_miner_assigned: true
    }).lean();
    
    verifyLog.info(`Found ${assignedParents.length} assigned parent devices`);
    
    // Verification checks
    const verification = {
      totalAIEdgeMiners: migratedAIEdgeMiners.length,
      totalAssignedParents: assignedParents.length,
      uniqueParentAssignments: true,
      duplicateParents: [] as string[],
      orphanedAIEdgeMiners: [] as any[],
      parentChildMappings: [] as any[],
      emailOrderGroups: {} as any
    };
    
    // Check for unique parent assignments
    const parentIdCounts = new Map<string, number>();
    const parentUsage = new Map<string, any[]>();
    
    for (const aiMiner of migratedAIEdgeMiners) {
      if (aiMiner.parent_device_id) {
        const parentIdStr = aiMiner.parent_device_id.toString();
        
        // Count parent usage
        parentIdCounts.set(parentIdStr, (parentIdCounts.get(parentIdStr) || 0) + 1);
        
        // Track which AI miners use each parent
        if (!parentUsage.has(parentIdStr)) {
          parentUsage.set(parentIdStr, []);
        }
        parentUsage.get(parentIdStr)!.push({
          aiMinerId: aiMiner._id,
          aiMinerKey: aiMiner.miner_key,
          email: aiMiner.email,
          order: aiMiner.order
        });
        
        // Add to mappings
        verification.parentChildMappings.push({
          aiMinerId: aiMiner._id,
          aiMinerKey: aiMiner.miner_key,
          parentId: aiMiner.parent_device_id,
          parentName: aiMiner.parent_device_name,
          parentKey: aiMiner.parent_device_miner_key,
          email: aiMiner.email,
          order: aiMiner.order
        });
        
        // Group by email and order
        const groupKey = `${aiMiner.email}|${aiMiner.order}`;
        if (!verification.emailOrderGroups[groupKey]) {
          verification.emailOrderGroups[groupKey] = {
            email: aiMiner.email,
            order: aiMiner.order,
            aiMiners: [],
            parents: new Set()
          };
        }
        verification.emailOrderGroups[groupKey].aiMiners.push({
          id: aiMiner._id,
          key: aiMiner.miner_key,
          parentKey: aiMiner.parent_device_miner_key
        });
        verification.emailOrderGroups[groupKey].parents.add(aiMiner.parent_device_miner_key);
        
      } else {
        // AI Miner without parent
        verification.orphanedAIEdgeMiners.push({
          id: aiMiner._id,
          key: aiMiner.miner_key,
          email: aiMiner.email,
          order: aiMiner.order
        });
      }
    }
    
    // Check for duplicate parent assignments
    for (const [parentId, count] of parentIdCounts.entries()) {
      if (count > 1) {
        verification.uniqueParentAssignments = false;
        verification.duplicateParents.push(parentId);
        
        verifyLog.error(`DUPLICATE PARENT ASSIGNMENT: Parent ${parentId} is assigned to ${count} AI Edge Miners:`);
        const usages = parentUsage.get(parentId) || [];
        for (const usage of usages) {
          verifyLog.error(`  - AI Miner ${usage.aiMinerKey} (${usage.email}, order: ${usage.order})`);
        }
      }
    }
    
    // Convert email/order groups for display
    const emailOrderGroupsArray = Object.values(verification.emailOrderGroups).map((group: any) => ({
      email: group.email,
      order: group.order,
      aiMinersCount: group.aiMiners.length,
      uniqueParentsCount: group.parents.size,
      aiMiners: group.aiMiners,
      parents: Array.from(group.parents)
    }));
    
    // Generate summary
    let summary = `🔍 MIGRATION VERIFICATION SUMMARY:\n`;
    summary += `📊 Total AI Edge Miners: ${verification.totalAIEdgeMiners}\n`;
    summary += `📊 Total Assigned Parents: ${verification.totalAssignedParents}\n`;
    summary += `✅ Unique Parent Assignments: ${verification.uniqueParentAssignments ? 'YES' : 'NO'}\n`;
    summary += `📊 Orphaned AI Edge Miners: ${verification.orphanedAIEdgeMiners.length}\n`;
    summary += `📊 Email/Order Groups: ${emailOrderGroupsArray.length}\n`;
    
    if (verification.duplicateParents.length > 0) {
      summary += `❌ Duplicate Parent Assignments: ${verification.duplicateParents.length}\n`;
    }
    
    summary += `\n🎯 OVERALL RESULT: ${verification.uniqueParentAssignments && verification.orphanedAIEdgeMiners.length === 0 ? 'SUCCESS' : 'ISSUES FOUND'}`;
    
    // Log detailed results
    verifyLog.info('📊 Email/Order Groups Analysis:');
    for (const group of emailOrderGroupsArray) {
      verifyLog.info(`Group: ${group.email} | Order: ${group.order}`);
      verifyLog.info(`  - AI Miners: ${group.aiMinersCount}`);
      verifyLog.info(`  - Unique Parents: ${group.uniqueParentsCount}`);
      verifyLog.info(`  - Parent Keys: ${group.parents.join(', ')}`);
      
      if (group.aiMinersCount !== group.uniqueParentsCount) {
        verifyLog.warning(`  ⚠️ Mismatch: ${group.aiMinersCount} AI Miners but ${group.uniqueParentsCount} unique parents`);
      } else {
        verifyLog.success(`  ✅ Perfect 1:1 mapping`);
      }
    }
    
    if (verification.orphanedAIEdgeMiners.length > 0) {
      verifyLog.warning('Orphaned AI Edge Miners (no parent assigned):');
      for (const orphan of verification.orphanedAIEdgeMiners) {
        verifyLog.warning(`  - ${orphan.key} (${orphan.email}, order: ${orphan.order})`);
      }
    }
    
    const success = verification.uniqueParentAssignments && verification.orphanedAIEdgeMiners.length === 0;
    
    if (success) {
      verifyLog.success('🎉 VERIFICATION PASSED! All AI Edge Miners have unique parent assignments.');
    } else {
      verifyLog.error('❌ VERIFICATION FAILED! Issues found with parent assignments.');
    }
    
    verifyLog.info(summary);
    
    return {
      success,
      summary,
      details: {
        ...verification,
        emailOrderGroups: emailOrderGroupsArray
      }
    };
    
  } catch (error) {
    verifyLog.error('Verification failed with critical error', error);
    throw error;
  }
}

// Run verification if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const result = await verifyMigrationResults();
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      verifyLog.error('Verification script failed', error);
      process.exit(1);
    }
  })();
}
