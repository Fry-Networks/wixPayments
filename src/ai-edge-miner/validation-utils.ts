import { connect } from '../db/connect.js';
import { DeviceModel } from '../db/devices-schema.js';
import { redactEmail, redactKey } from '../redact-utils.js';

// Enhanced logging utility for validation
const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔍 VALIDATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ VALIDATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ VALIDATION: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ VALIDATION: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack}`);
    }
  }
};

const ELIGIBLE_NODE_TYPES = ["$FRY Reward Decentralization Node", "$FRY Contributor Node", "$FRY Storage Decentralization Node", "$FRY Storage Validator Node"];

/**
 * Validates the 1:1 parent-child relationship integrity
 * Detects duplicate parent assignments and orphaned references
 */
export async function validateParentChildRelationships(options: {
  emails?: string[];
  orders?: string[];
  fixDuplicates?: boolean;
  dryRun?: boolean;
} = {}): Promise<{
  success: boolean;
  totalAIEdgeMiners: number;
  totalParentDevices: number;
  duplicateParentAssignments: Array<{
    parentId: string;
    parentKey: string;
    parentName: string;
    assignedChildren: Array<{
      childId: string;
      childKey: string;
      email: string;
      order: string;
    }>;
  }>;
  orphanedAIEdgeMiners: Array<{
    childId: string;
    childKey: string;
    email: string;
    order: string;
    reason: string;
  }>;
  invalidParentReferences: Array<{
    childId: string;
    childKey: string;
    parentId: string;
    reason: string;
  }>;
  fixedDuplicates: number;
  message: string;
}> {
  const { emails, orders, fixDuplicates = false, dryRun = false } = options;
  
  log.info(`${dryRun ? 'DRY RUN: ' : ''}Starting parent-child relationship validation...`, {
    emailFilter: emails?.length || 'all',
    orderFilter: orders?.length || 'all',
    fixDuplicates,
    dryRun
  });

  try {
    await connect();

    // Build query filters
    let aiEdgeMinerQuery: any = {
      name: "$FRY AI Edge Miner",
      miner_key: { $regex: /^AEM-/ }
    };

    let parentQuery: any = {
      ai_edge_miner_assigned: true
    };

    // Apply email filter if provided
    if (emails && emails.length > 0) {
      const emailFilter = { email: { $in: emails } };
      aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...emailFilter };
      parentQuery = { ...parentQuery, ...emailFilter };
    }

    // Apply order filter if provided
    if (orders && orders.length > 0) {
      const orderFilter = { order: { $in: orders } };
      aiEdgeMinerQuery = { ...aiEdgeMinerQuery, ...orderFilter };
      parentQuery = { ...parentQuery, ...orderFilter };
    }

    // Get all AI Edge Miners
    const aiEdgeMiners = await DeviceModel.find(aiEdgeMinerQuery)
      .select('_id miner_key email order parent_device_id parent_device_name parent_device_miner_key')
      .lean();

    // Get all parent devices that are marked as assigned
    const assignedParents = await DeviceModel.find(parentQuery)
      .select('_id miner_key name email order ai_edge_miner_assigned assigned_ai_edge_miner_id')
      .lean();

    log.info(`Found ${aiEdgeMiners.length} AI Edge Miners and ${assignedParents.length} assigned parent devices`);

    // Detect duplicate parent assignments
    const duplicateParentAssignments: Array<{
      parentId: string;
      parentKey: string;
      parentName: string;
      assignedChildren: Array<{
        childId: string;
        childKey: string;
        email: string;
        order: string;
      }>;
    }> = [];

    // Group AI Edge Miners by their parent device ID
    const childrenByParent = aiEdgeMiners.reduce<Record<string, any[]>>((acc, child) => {
      if (child.parent_device_id) {
        const parentId = child.parent_device_id.toString();
        if (!acc[parentId]) acc[parentId] = [];
        acc[parentId].push(child);
      }
      return acc;
    }, {});

    // Check for duplicates
    for (const [parentId, children] of Object.entries(childrenByParent)) {
      if (children.length > 1) {
        // Find the parent device info
        const parentDevice = assignedParents.find(p => p._id.toString() === parentId);
        
        duplicateParentAssignments.push({
          parentId,
          parentKey: parentDevice ? redactKey(parentDevice.miner_key || '') : 'UNKNOWN',
          parentName: parentDevice?.name || 'UNKNOWN',
          assignedChildren: children.map(child => ({
            childId: child._id.toString(),
            childKey: redactKey(child.miner_key || ''),
            email: redactEmail(child.email || ''),
            order: child.order || ''
          }))
        });

        log.warning(`Duplicate parent assignment detected: Parent ${parentId} assigned to ${children.length} children`);
      }
    }

    // Detect orphaned AI Edge Miners (no parent assigned or invalid parent reference)
    const orphanedAIEdgeMiners: Array<{
      childId: string;
      childKey: string;
      email: string;
      order: string;
      reason: string;
    }> = [];

    for (const child of aiEdgeMiners) {
      if (!child.parent_device_id) {
        orphanedAIEdgeMiners.push({
          childId: child._id.toString(),
          childKey: redactKey(child.miner_key || ''),
          email: redactEmail(child.email || ''),
          order: child.order || '',
          reason: 'No parent device assigned'
        });
      }
    }

    // Detect invalid parent references
    const invalidParentReferences: Array<{
      childId: string;
      childKey: string;
      parentId: string;
      reason: string;
    }> = [];

    for (const child of aiEdgeMiners) {
      if (child.parent_device_id) {
        const parentId = child.parent_device_id.toString();
        
        // Check if parent device exists and is properly marked as assigned
        const parentDevice = await DeviceModel.findById(parentId).lean();
        
        if (!parentDevice) {
          invalidParentReferences.push({
            childId: child._id.toString(),
            childKey: redactKey(child.miner_key || ''),
            parentId,
            reason: 'Parent device does not exist'
          });
        } else if (!parentDevice.ai_edge_miner_assigned) {
          invalidParentReferences.push({
            childId: child._id.toString(),
            childKey: redactKey(child.miner_key || ''),
            parentId,
            reason: 'Parent device not marked as assigned'
          });
        } else if (parentDevice.assigned_ai_edge_miner_id?.toString() !== child._id.toString()) {
          invalidParentReferences.push({
            childId: child._id.toString(),
            childKey: redactKey(child.miner_key || ''),
            parentId,
            reason: 'Parent device assigned to different child'
          });
        }
      }
    }

    let fixedDuplicates = 0;

    // Fix duplicates if requested
    if (fixDuplicates && duplicateParentAssignments.length > 0 && !dryRun) {
      log.info(`Attempting to fix ${duplicateParentAssignments.length} duplicate parent assignments...`);

      for (const duplicate of duplicateParentAssignments) {
        try {
          // Keep the first child (oldest by creation date) and reassign others
          const childrenToReassign = duplicate.assignedChildren.slice(1); // Skip first child
          
          for (const childToReassign of childrenToReassign) {
            log.info(`Reassigning child ${childToReassign.childId} (${childToReassign.childKey}) to a new parent...`);
            
            // Find an available parent for this child
            const availableParent = await DeviceModel.findOneAndUpdate(
              {
                email: childToReassign.email,
                order: childToReassign.order,
                ai_miner_generated: true,
                ai_edge_miner_assigned: { $ne: true },
                name: { $in: ELIGIBLE_NODE_TYPES }
              },
              {
                $set: {
                  ai_edge_miner_assigned: true,
                  assigned_ai_edge_miner_id: childToReassign.childId
                }
              },
              {
                sort: { created_at: 1 },
                returnDocument: 'after'
              }
            );

            if (availableParent) {
              // Update the child with new parent references
              await DeviceModel.updateOne(
                { _id: childToReassign.childId },
                {
                  $set: {
                    parent_device_id: availableParent._id,
                    parent_device_name: availableParent.name,
                    parent_device_miner_key: availableParent.miner_key
                  }
                }
              );

              log.success(`Reassigned child ${childToReassign.childId} to new parent ${availableParent._id}`);
              fixedDuplicates++;
            } else {
              log.warning(`No available parent found for child ${childToReassign.childId} - leaving orphaned`);
              
              // Remove parent references from orphaned child
              await DeviceModel.updateOne(
                { _id: childToReassign.childId },
                {
                  $unset: {
                    parent_device_id: 1,
                    parent_device_name: 1,
                    parent_device_miner_key: 1
                  }
                }
              );
            }
          }
        } catch (error) {
          log.error(`Failed to fix duplicate assignment for parent ${duplicate.parentId}`, error);
        }
      }
    }

    const validationSuccess = 
      duplicateParentAssignments.length === 0 && 
      orphanedAIEdgeMiners.length === 0 && 
      invalidParentReferences.length === 0;

    const message = validationSuccess 
      ? 'All parent-child relationships are valid ✅'
      : `Found ${duplicateParentAssignments.length} duplicate assignments, ${orphanedAIEdgeMiners.length} orphaned children, ${invalidParentReferences.length} invalid references`;

    if (validationSuccess) {
      log.success(message);
    } else {
      log.warning(message);
    }

    return {
      success: validationSuccess,
      totalAIEdgeMiners: aiEdgeMiners.length,
      totalParentDevices: assignedParents.length,
      duplicateParentAssignments,
      orphanedAIEdgeMiners,
      invalidParentReferences,
      fixedDuplicates,
      message
    };

  } catch (error) {
    const message = 'Parent-child relationship validation failed with critical error';
    log.error(message, error);
    throw error;
  }
}

/**
 * Generates a comprehensive report of parent-child assignments
 */
export async function generateParentChildAssignmentReport(options: {
  emails?: string[];
  orders?: string[];
  includeDetails?: boolean;
} = {}): Promise<{
  summary: {
    totalUsers: number;
    totalAIEdgeMiners: number;
    totalParentDevices: number;
    usersWithMultipleNodes: number;
    perfectAssignments: number;
    problematicAssignments: number;
  };
  userBreakdown: Array<{
    email: string;
    order: string;
    parentDevices: Array<{
      id: string;
      name: string;
      key: string;
      assigned: boolean;
      assignedToChild?: string;
    }>;
    aiEdgeMiners: Array<{
      id: string;
      key: string;
      parentId?: string;
      parentName?: string;
      parentKey?: string;
    }>;
    status: 'perfect' | 'duplicate_parents' | 'orphaned_children' | 'no_parents' | 'no_children';
    issues: string[];
  }>;
}> {
  const { emails, orders, includeDetails = true } = options;
  
  log.info('Generating parent-child assignment report...', {
    emailFilter: emails?.length || 'all',
    orderFilter: orders?.length || 'all',
    includeDetails
  });

  try {
    await connect();

    // Build query filters
    let baseQuery: any = {};

    if (emails && emails.length > 0) {
      baseQuery.email = { $in: emails };
    }

    if (orders && orders.length > 0) {
      baseQuery.order = { $in: orders };
    }

    // Get all relevant devices
    const allDevices = await DeviceModel.find({
      ...baseQuery,
      $or: [
        { name: "$FRY AI Edge Miner", miner_key: { $regex: /^AEM-/ } },
        { name: { $in: ELIGIBLE_NODE_TYPES }, ai_miner_generated: true }
      ]
    })
    .select('_id miner_key name email order ai_miner_generated ai_edge_miner_assigned assigned_ai_edge_miner_id parent_device_id parent_device_name parent_device_miner_key')
    .lean();

    // Group devices by email and order
    const devicesByUser = allDevices.reduce<Record<string, any[]>>((acc, device) => {
      const key = `${device.email}|${device.order}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(device);
      return acc;
    }, {});

    const userBreakdown: Array<{
      email: string;
      order: string;
      parentDevices: Array<{
        id: string;
        name: string;
        key: string;
        assigned: boolean;
        assignedToChild?: string;
      }>;
      aiEdgeMiners: Array<{
        id: string;
        key: string;
        parentId?: string;
        parentName?: string;
        parentKey?: string;
      }>;
      status: 'perfect' | 'duplicate_parents' | 'orphaned_children' | 'no_parents' | 'no_children';
      issues: string[];
    }> = [];

    let perfectAssignments = 0;
    let problematicAssignments = 0;
    let usersWithMultipleNodes = 0;

    for (const [userKey, devices] of Object.entries(devicesByUser)) {
      const [email, order] = userKey.split('|');
      
      // Separate parent devices and AI Edge Miners
      const parentDevices = devices.filter(d => 
        ELIGIBLE_NODE_TYPES.some(type => d.name?.includes(type)) && d.ai_miner_generated === true
      );
      
      const aiEdgeMiners = devices.filter(d => 
        d.name === "$FRY AI Edge Miner" && d.miner_key?.startsWith('AEM-')
      );

      if (parentDevices.length > 1) {
        usersWithMultipleNodes++;
      }

      const parentDeviceDetails = parentDevices.map(p => ({
        id: p._id.toString(),
        name: p.name || '',
        key: redactKey(p.miner_key || ''),
        assigned: p.ai_edge_miner_assigned === true,
        assignedToChild: p.assigned_ai_edge_miner_id?.toString()
      }));

      const aiEdgeMinerDetails = aiEdgeMiners.map(a => ({
        id: a._id.toString(),
        key: redactKey(a.miner_key || ''),
        parentId: a.parent_device_id?.toString(),
        parentName: a.parent_device_name,
        parentKey: a.parent_device_miner_key ? redactKey(a.parent_device_miner_key) : undefined
      }));

      // Determine status and issues
      const issues: string[] = [];
      let status: 'perfect' | 'duplicate_parents' | 'orphaned_children' | 'no_parents' | 'no_children' = 'perfect';

      if (parentDevices.length === 0 && aiEdgeMiners.length > 0) {
        status = 'no_parents';
        issues.push('AI Edge Miners exist but no parent devices found');
      } else if (aiEdgeMiners.length === 0 && parentDevices.length > 0) {
        status = 'no_children';
        issues.push('Parent devices exist but no AI Edge Miners found');
      } else if (parentDevices.length > 0 && aiEdgeMiners.length > 0) {
        // Check for orphaned children
        const orphanedChildren = aiEdgeMiners.filter(a => !a.parentId);
        if (orphanedChildren.length > 0) {
          status = 'orphaned_children';
          issues.push(`${orphanedChildren.length} AI Edge Miners without parent assignment`);
        }

        // Check for duplicate parent assignments
        const parentAssignments = aiEdgeMiners.reduce<Record<string, number>>((acc, a) => {
          if (a.parentId) {
            acc[a.parentId] = (acc[a.parentId] || 0) + 1;
          }
          return acc;
        }, {});

        const duplicateParents = Object.entries(parentAssignments).filter(([_, count]) => count > 1);
        if (duplicateParents.length > 0) {
          status = 'duplicate_parents';
          issues.push(`${duplicateParents.length} parent devices assigned to multiple children`);
        }

        // Check for unassigned parents
        const unassignedParents = parentDevices.filter(p => !p.ai_edge_miner_assigned);
        if (unassignedParents.length > 0) {
          issues.push(`${unassignedParents.length} parent devices not marked as assigned`);
        }

        // Check for mismatched assignments
        for (const aiEdgeMiner of aiEdgeMiners) {
          if (aiEdgeMiner.parentId) {
            const parentDevice = parentDevices.find(p => p._id.toString() === aiEdgeMiner.parentId);
            if (parentDevice && parentDevice.assigned_ai_edge_miner_id?.toString() !== aiEdgeMiner.id) {
              issues.push(`AI Edge Miner ${redactKey(aiEdgeMiner.key)} parent assignment mismatch`);
            }
          }
        }
      }

      if (issues.length === 0 && parentDevices.length > 0 && aiEdgeMiners.length > 0) {
        perfectAssignments++;
      } else {
        problematicAssignments++;
      }

      if (includeDetails) {
        userBreakdown.push({
          email: redactEmail(email),
          order,
          parentDevices: parentDeviceDetails,
          aiEdgeMiners: aiEdgeMinerDetails,
          status,
          issues
        });
      }
    }

    const summary = {
      totalUsers: Object.keys(devicesByUser).length,
      totalAIEdgeMiners: allDevices.filter(d => d.name === "$FRY AI Edge Miner").length,
      totalParentDevices: allDevices.filter(d => ELIGIBLE_NODE_TYPES.some(type => d.name?.includes(type))).length,
      usersWithMultipleNodes,
      perfectAssignments,
      problematicAssignments
    };

    log.success('Parent-child assignment report generated', summary);

    return {
      summary,
      userBreakdown: includeDetails ? userBreakdown : []
    };

  } catch (error) {
    log.error('Failed to generate parent-child assignment report', error);
    throw error;
  }
}

/**
 * Quick health check for parent-child relationships
 */
export async function quickHealthCheck(): Promise<{
  healthy: boolean;
  totalAIEdgeMiners: number;
  totalParentDevices: number;
  duplicateAssignments: number;
  orphanedChildren: number;
  message: string;
}> {
  log.info('Performing quick health check...');

  try {
    await connect();

    // Count AI Edge Miners
    const totalAIEdgeMiners = await DeviceModel.countDocuments({
      name: "$FRY AI Edge Miner",
      miner_key: { $regex: /^AEM-/ }
    });

    // Count assigned parent devices
    const totalParentDevices = await DeviceModel.countDocuments({
      ai_edge_miner_assigned: true
    });

    // Check for duplicate assignments by aggregating
    const duplicateAssignmentsPipeline = [
      {
        $match: {
          name: "$FRY AI Edge Miner",
          miner_key: { $regex: /^AEM-/ },
          parent_device_id: { $exists: true }
        }
      },
      {
        $group: {
          _id: "$parent_device_id",
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ];

    const duplicateResults = await DeviceModel.aggregate(duplicateAssignmentsPipeline);
    const duplicateAssignments = duplicateResults.length;

    // Count orphaned children
    const orphanedChildren = await DeviceModel.countDocuments({
      name: "$FRY AI Edge Miner",
      miner_key: { $regex: /^AEM-/ },
      parent_device_id: { $exists: false }
    });

    const healthy = duplicateAssignments === 0 && orphanedChildren === 0;
    
    const message = healthy 
      ? '✅ All parent-child relationships are healthy'
      : `⚠️ Found ${duplicateAssignments} duplicate assignments and ${orphanedChildren} orphaned children`;

    log.info(message);

    return {
      healthy,
      totalAIEdgeMiners,
      totalParentDevices,
      duplicateAssignments,
      orphanedChildren,
      message
    };

  } catch (error) {
    log.error('Quick health check failed', error);
    throw error;
  }
}
