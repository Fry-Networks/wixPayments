import { connect } from '../db/connect.js';
import { DeviceModel } from '../db/devices-schema.js';
import { migrateAIEdgeMinerPrefix, resetParentAssignmentTracking } from './migration.js';

// Test logging utility
const testLog = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🧪 TEST: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ TEST: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ TEST: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ TEST: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack}`);
    }
  }
};

/**
 * Test the 1:1 parent-child assignment logic
 * This simulates your scenario with multiple AI Edge Miners under the same email/order
 */
export async function testParentChildAssignment(): Promise<{
  success: boolean;
  testResults: any[];
  summary: string;
}> {
  testLog.info('🧪 Starting parent-child assignment test...');
  
  const testResults: any[] = [];
  const testEmail = 'test@example.com';
  const testOrder = '12345';
  
  try {
    await connect();
    
    // Step 1: Clean up any existing test data
    testLog.info('Step 1: Cleaning up existing test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM)-TEST-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    // Step 2: Create test parent devices (eligible node types)
    testLog.info('Step 2: Creating test parent devices...');
    const parentDevices = [
      {
        miner_key: 'RDN-TEST-PARENT-001',
        name: '$FRY Reward Decentralization Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date('2024-01-01T10:00:00Z') // Oldest
      },
      {
        miner_key: 'SDN-TEST-PARENT-002',
        name: '$FRY Storage Decentralization Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date('2024-01-01T11:00:00Z') // Middle
      },
      {
        miner_key: 'SVN-TEST-PARENT-003',
        name: '$FRY Storage Validator Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date('2024-01-01T12:00:00Z') // Newest
      }
    ];
    
    const createdParents = await DeviceModel.insertMany(parentDevices);
    testLog.success(`Created ${createdParents.length} test parent devices`);
    
    // Step 3: Create test AI Edge Miner devices with ANM prefix
    testLog.info('Step 3: Creating test AI Edge Miner devices...');
    const aiEdgeMiners = [
      {
        miner_key: 'ANM-TEST-CHILD-001',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true, // This should be removed during migration
        ai_miner_generated: false, // This should be removed during migration
        created_at: new Date('2024-01-02T10:00:00Z')
      },
      {
        miner_key: 'ANM-TEST-CHILD-002',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true, // This should be removed during migration
        ai_miner_generated: false, // This should be removed during migration
        created_at: new Date('2024-01-02T11:00:00Z')
      },
      {
        miner_key: 'ANM-TEST-CHILD-003',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true, // This should be removed during migration
        ai_miner_generated: false, // This should be removed during migration
        created_at: new Date('2024-01-02T12:00:00Z')
      }
    ];
    
    const createdChildren = await DeviceModel.insertMany(aiEdgeMiners);
    testLog.success(`Created ${createdChildren.length} test AI Edge Miner devices`);
    
    // Step 4: Run the migration
    testLog.info('Step 4: Running migration...');
    const migrationResult = await migrateAIEdgeMinerPrefix({
      dryRun: false,
      batchSize: 10
    });
    
    testResults.push({
      step: 'Migration',
      result: migrationResult
    });
    
    testLog.success('Migration completed', migrationResult);
    
    // Step 5: Validate the results
    testLog.info('Step 5: Validating migration results...');
    
    // Check AI Edge Miners
    const migratedChildren = await DeviceModel.find({
      email: testEmail,
      name: '$FRY AI Edge Miner',
      miner_key: { $regex: /^AEM-TEST-CHILD-/ }
    }).lean();
    
    testLog.info(`Found ${migratedChildren.length} migrated AI Edge Miners`);
    
    // Check parent devices
    const assignedParents = await DeviceModel.find({
      email: testEmail,
      ai_edge_miner_assigned: true
    }).lean();
    
    testLog.info(`Found ${assignedParents.length} assigned parent devices`);
    
    // Validation checks
    const validationResults = {
      correctChildCount: migratedChildren.length === 3,
      correctParentCount: assignedParents.length === 3,
      uniqueParentAssignments: true,
      correctPrefixChange: true,
      fieldsRemoved: true,
      parentReferencesAdded: true,
      correctAssignmentOrder: true
    };
    
    // Check unique parent assignments
    const parentIds = new Set();
    const childParentMappings: any[] = [];
    
    for (const child of migratedChildren) {
      if (child.parent_device_id) {
        if (parentIds.has(child.parent_device_id.toString())) {
          validationResults.uniqueParentAssignments = false;
          testLog.error(`DUPLICATE PARENT ASSIGNMENT: Parent ${child.parent_device_id} assigned to multiple children`);
        } else {
          parentIds.add(child.parent_device_id.toString());
        }
        
        childParentMappings.push({
          childId: child._id,
          childKey: child.miner_key,
          parentId: child.parent_device_id,
          parentName: child.parent_device_name,
          parentKey: child.parent_device_miner_key
        });
      }
      
      // Check prefix change
      if (!child.miner_key.startsWith('AEM-')) {
        validationResults.correctPrefixChange = false;
      }
      
      // Check fields removed
      if ('enabled' in child || 'ai_miner_generated' in child) {
        validationResults.fieldsRemoved = false;
      }
      
      // Check parent references added
      if (!child.parent_device_id || !child.parent_device_name || !child.parent_device_miner_key) {
        validationResults.parentReferencesAdded = false;
      }
    }
    
    testResults.push({
      step: 'Validation',
      result: {
        validationResults,
        childParentMappings,
        migratedChildren: migratedChildren.map(c => ({
          _id: c._id,
          miner_key: c.miner_key,
          parent_device_id: c.parent_device_id,
          parent_device_name: c.parent_device_name,
          parent_device_miner_key: c.parent_device_miner_key
        })),
        assignedParents: assignedParents.map(p => ({
          _id: p._id,
          miner_key: p.miner_key,
          name: p.name,
          ai_edge_miner_assigned: p.ai_edge_miner_assigned,
          assigned_ai_edge_miner_id: p.assigned_ai_edge_miner_id
        }))
      }
    });
    
    // Step 6: Test assignment order (should be deterministic by creation date)
    testLog.info('Step 6: Validating assignment order...');
    
    const sortedParents = createdParents.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    const sortedChildren = createdChildren.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    let assignmentOrderCorrect = true;
    for (let i = 0; i < Math.min(sortedParents.length, sortedChildren.length); i++) {
      const expectedParentId = sortedParents[i]._id.toString();
      const actualChild = migratedChildren.find(c => 
        c.miner_key === `AEM-TEST-CHILD-${String(i + 1).padStart(3, '0')}`
      );
      
      if (!actualChild || actualChild.parent_device_id?.toString() !== expectedParentId) {
        assignmentOrderCorrect = false;
        testLog.error(`Assignment order incorrect: Child ${i + 1} should be assigned to parent ${expectedParentId}`);
      }
    }
    
    validationResults.correctAssignmentOrder = assignmentOrderCorrect;
    
    // Step 7: Generate summary
    const allValidationsPassed = Object.values(validationResults).every(v => v === true);
    
    let summary = `🧪 TEST SUMMARY:\n`;
    summary += `✅ Migration Success: ${migrationResult.success}\n`;
    summary += `✅ Correct Child Count (3): ${validationResults.correctChildCount}\n`;
    summary += `✅ Correct Parent Count (3): ${validationResults.correctParentCount}\n`;
    summary += `✅ Unique Parent Assignments: ${validationResults.uniqueParentAssignments}\n`;
    summary += `✅ Correct Prefix Change (ANM→AEM): ${validationResults.correctPrefixChange}\n`;
    summary += `✅ Fields Removed (enabled, ai_miner_generated): ${validationResults.fieldsRemoved}\n`;
    summary += `✅ Parent References Added: ${validationResults.parentReferencesAdded}\n`;
    summary += `✅ Correct Assignment Order: ${validationResults.correctAssignmentOrder}\n`;
    summary += `\n🎯 OVERALL RESULT: ${allValidationsPassed ? 'PASS' : 'FAIL'}`;
    
    if (allValidationsPassed) {
      testLog.success('🎉 ALL TESTS PASSED! The 1:1 parent-child assignment is working correctly.');
    } else {
      testLog.error('❌ SOME TESTS FAILED! Check the validation results above.');
    }
    
    testLog.info(summary);
    
    // Step 8: Cleanup test data
    testLog.info('Step 8: Cleaning up test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-TEST-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    return {
      success: allValidationsPassed,
      testResults,
      summary
    };
    
  } catch (error) {
    testLog.error('Test failed with critical error', error);
    
    // Cleanup on error
    try {
      await DeviceModel.deleteMany({
        $or: [
          { email: testEmail },
          { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-TEST-/ } }
        ]
      });
    } catch (cleanupError) {
      testLog.error('Cleanup failed', cleanupError);
    }
    
    throw error;
  }
}

/**
 * Test the reset functionality
 */
export async function testResetFunctionality(): Promise<{
  success: boolean;
  message: string;
}> {
  testLog.info('🧪 Testing reset functionality...');
  
  try {
    await connect();
    
    const testEmail = 'reset-test@example.com';
    const testOrder = '54321';
    
    // Create test data with assignments
    const parentDevice = await DeviceModel.create({
      miner_key: 'RDN-RESET-TEST-001',
      name: '$FRY Reward Decentralization Node',
      email: testEmail,
      order: testOrder,
      ai_edge_miner_assigned: true,
      assigned_ai_edge_miner_id: '507f1f77bcf86cd799439011'
    });
    
    const childDevice = await DeviceModel.create({
      miner_key: 'AEM-RESET-TEST-001',
      name: '$FRY AI Edge Miner',
      email: testEmail,
      order: testOrder,
      parent_device_id: parentDevice._id,
      parent_device_name: parentDevice.name,
      parent_device_miner_key: parentDevice.miner_key
    });
    
    // Test reset
    const resetResult = await resetParentAssignmentTracking({
      dryRun: false,
      emails: [testEmail]
    });
    
    // Verify reset
    const resetParent = await DeviceModel.findById(parentDevice._id).lean();
    const resetChild = await DeviceModel.findById(childDevice._id).lean();
    
    const resetSuccess = 
      !resetParent?.ai_edge_miner_assigned &&
      !resetParent?.assigned_ai_edge_miner_id &&
      !resetChild?.parent_device_id &&
      !resetChild?.parent_device_name &&
      !resetChild?.parent_device_miner_key;
    
    // Cleanup
    await DeviceModel.deleteMany({
      email: testEmail
    });
    
    if (resetSuccess) {
      testLog.success('✅ Reset functionality test PASSED');
      return {
        success: true,
        message: 'Reset functionality is working correctly'
      };
    } else {
      testLog.error('❌ Reset functionality test FAILED');
      return {
        success: false,
        message: 'Reset functionality is not working correctly'
      };
    }
    
  } catch (error) {
    testLog.error('Reset test failed', error);
    throw error;
  }
}

/**
 * Test concurrent parent assignment scenarios
 * This simulates multiple AI Edge Miners being processed simultaneously
 */
export async function testConcurrentParentAssignment(): Promise<{
  success: boolean;
  testResults: any[];
  summary: string;
}> {
  testLog.info('🧪 Starting concurrent parent assignment test...');
  
  const testResults: any[] = [];
  const testEmail = 'concurrent-test@example.com';
  const testOrder = '99999';
  
  try {
    await connect();
    
    // Step 1: Clean up any existing test data
    testLog.info('Step 1: Cleaning up existing test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-CONCURRENT-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    // Step 2: Create test parent devices (fewer than children to force competition)
    testLog.info('Step 2: Creating test parent devices...');
    const parentDevices = [
      {
        miner_key: 'RDN-CONCURRENT-PARENT-001',
        name: '$FRY Reward Decentralization Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date('2024-01-01T10:00:00Z')
      },
      {
        miner_key: 'SDN-CONCURRENT-PARENT-002',
        name: '$FRY Storage Decentralization Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date('2024-01-01T11:00:00Z')
      }
    ];
    
    const createdParents = await DeviceModel.insertMany(parentDevices);
    testLog.success(`Created ${createdParents.length} test parent devices`);
    
    // Step 3: Create test AI Edge Miner devices with ANM prefix (more than parents)
    testLog.info('Step 3: Creating test AI Edge Miner devices...');
    const aiEdgeMiners = [
      {
        miner_key: 'ANM-CONCURRENT-CHILD-001',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true,
        ai_miner_generated: false,
        created_at: new Date('2024-01-02T10:00:00Z')
      },
      {
        miner_key: 'ANM-CONCURRENT-CHILD-002',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true,
        ai_miner_generated: false,
        created_at: new Date('2024-01-02T11:00:00Z')
      },
      {
        miner_key: 'ANM-CONCURRENT-CHILD-003',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true,
        ai_miner_generated: false,
        created_at: new Date('2024-01-02T12:00:00Z')
      },
      {
        miner_key: 'ANM-CONCURRENT-CHILD-004',
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true,
        ai_miner_generated: false,
        created_at: new Date('2024-01-02T13:00:00Z')
      }
    ];
    
    const createdChildren = await DeviceModel.insertMany(aiEdgeMiners);
    testLog.success(`Created ${createdChildren.length} test AI Edge Miner devices`);
    
    // Step 4: Run concurrent migrations to simulate race conditions
    testLog.info('Step 4: Running concurrent migrations...');
    
    // Create multiple migration promises that will run simultaneously
    const migrationPromises = createdChildren.map(async (child, index) => {
      const startTime = Date.now();
      try {
        // Add small random delay to increase chance of race conditions
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        const result = await migrateAIEdgeMinerPrefix({
          dryRun: false,
          batchSize: 1 // Process one at a time to force individual transactions
        });
        
        const endTime = Date.now();
        return {
          childIndex: index,
          childId: child._id.toString(),
          success: result.success,
          duration: endTime - startTime,
          result
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          childIndex: index,
          childId: child._id.toString(),
          success: false,
          duration: endTime - startTime,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
    
    // Wait for all migrations to complete
    const migrationResults = await Promise.all(migrationPromises);
    
    testResults.push({
      step: 'Concurrent Migration',
      results: migrationResults
    });
    
    testLog.success('Concurrent migrations completed');
    
    // Step 5: Validate the results for race condition handling
    testLog.info('Step 5: Validating concurrent migration results...');
    
    // Check AI Edge Miners
    const migratedChildren = await DeviceModel.find({
      email: testEmail,
      name: '$FRY AI Edge Miner',
      miner_key: { $regex: /^AEM-CONCURRENT-CHILD-/ }
    }).lean();
    
    // Check parent devices
    const assignedParents = await DeviceModel.find({
      email: testEmail,
      ai_edge_miner_assigned: true
    }).lean();
    
    testLog.info(`Found ${migratedChildren.length} migrated AI Edge Miners and ${assignedParents.length} assigned parents`);
    
    // Validation checks for concurrent scenarios
    const validationResults = {
      correctChildCount: migratedChildren.length === 4,
      noMoreParentsThanChildren: assignedParents.length <= 2, // We only have 2 parents
      uniqueParentAssignments: true,
      correctPrefixChange: true,
      fieldsRemoved: true,
      parentReferencesAdded: true,
      someChildrenOrphaned: false
    };
    
    // Check unique parent assignments (critical for concurrent test)
    const parentIds = new Set();
    const childParentMappings: any[] = [];
    let orphanedCount = 0;
    
    for (const child of migratedChildren) {
      if (child.parent_device_id) {
        const parentId = child.parent_device_id.toString();
        if (parentIds.has(parentId)) {
          validationResults.uniqueParentAssignments = false;
          testLog.error(`DUPLICATE PARENT ASSIGNMENT: Parent ${parentId} assigned to multiple children`);
        } else {
          parentIds.add(parentId);
        }
        
        childParentMappings.push({
          childId: child._id,
          childKey: child.miner_key,
          parentId: child.parent_device_id,
          parentName: child.parent_device_name,
          parentKey: child.parent_device_miner_key
        });
      } else {
        orphanedCount++;
      }
      
      // Check prefix change
      if (!child.miner_key.startsWith('AEM-')) {
        validationResults.correctPrefixChange = false;
      }
      
      // Check fields removed
      if ('enabled' in child || 'ai_miner_generated' in child) {
        validationResults.fieldsRemoved = false;
      }
    }
    
    // With 4 children and 2 parents, we expect 2 children to be orphaned
    validationResults.someChildrenOrphaned = orphanedCount === 2;
    
    testResults.push({
      step: 'Concurrent Validation',
      result: {
        validationResults,
        childParentMappings,
        orphanedCount,
        assignedParentCount: assignedParents.length,
        migratedChildrenCount: migratedChildren.length
      }
    });
    
    // Step 6: Test validation utilities
    testLog.info('Step 6: Testing validation utilities...');
    
    const { validateParentChildRelationships } = await import('./validation-utils.js');
    
    const validationReport = await validateParentChildRelationships({
      emails: [testEmail],
      dryRun: true
    });
    
    testResults.push({
      step: 'Validation Utilities',
      result: validationReport
    });
    
    // Generate summary
    const concurrentTestSuccess = 
      validationResults.uniqueParentAssignments && 
      validationResults.correctPrefixChange && 
      validationResults.fieldsRemoved &&
      validationResults.someChildrenOrphaned; // This is expected with more children than parents
    
    let summary = `🧪 CONCURRENT TEST SUMMARY:\n`;
    summary += `✅ Unique Parent Assignments: ${validationResults.uniqueParentAssignments}\n`;
    summary += `✅ Correct Prefix Change: ${validationResults.correctPrefixChange}\n`;
    summary += `✅ Fields Removed: ${validationResults.fieldsRemoved}\n`;
    summary += `✅ Expected Orphaned Children: ${validationResults.someChildrenOrphaned} (${orphanedCount}/4)\n`;
    summary += `✅ No Duplicate Parent Assignments: ${validationResults.uniqueParentAssignments}\n`;
    summary += `\n🎯 CONCURRENT RESULT: ${concurrentTestSuccess ? 'PASS' : 'FAIL'}`;
    
    if (concurrentTestSuccess) {
      testLog.success('🎉 CONCURRENT TEST PASSED! The atomic parent assignment prevents race conditions.');
    } else {
      testLog.error('❌ CONCURRENT TEST FAILED! Race conditions detected.');
    }
    
    testLog.info(summary);
    
    // Step 7: Cleanup test data
    testLog.info('Step 7: Cleaning up test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-CONCURRENT-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    return {
      success: concurrentTestSuccess,
      testResults,
      summary
    };
    
  } catch (error) {
    testLog.error('Concurrent test failed with critical error', error);
    
    // Cleanup on error
    try {
      await DeviceModel.deleteMany({
        $or: [
          { email: testEmail },
          { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-CONCURRENT-/ } }
        ]
      });
    } catch (cleanupError) {
      testLog.error('Cleanup failed', cleanupError);
    }
    
    throw error;
  }
}

/**
 * Stress test with many concurrent operations
 */
export async function stressTestParentAssignment(): Promise<{
  success: boolean;
  testResults: any[];
  summary: string;
}> {
  testLog.info('🧪 Starting stress test for parent assignment...');
  
  const testResults: any[] = [];
  const testEmail = 'stress-test@example.com';
  const testOrder = '88888';
  const NUM_PARENTS = 5;
  const NUM_CHILDREN = 20; // 4x more children than parents
  
  try {
    await connect();
    
    // Step 1: Clean up any existing test data
    testLog.info('Step 1: Cleaning up existing test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-STRESS-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    // Step 2: Create parent devices
    testLog.info(`Step 2: Creating ${NUM_PARENTS} test parent devices...`);
    const parentDevices = [];
    for (let i = 1; i <= NUM_PARENTS; i++) {
      parentDevices.push({
        miner_key: `RDN-STRESS-PARENT-${String(i).padStart(3, '0')}`,
        name: '$FRY Reward Decentralization Node',
        email: testEmail,
        order: testOrder,
        is_registered: true,
        ai_miner_generated: true,
        registration: { amount: 100, asset_id: 'test', time: new Date(), txId: 'test' },
        node: { amount: 200, asset_id: 'test', time: new Date(), txId: 'test' },
        created_at: new Date(`2024-01-01T${String(9 + i).padStart(2, '0')}:00:00Z`)
      });
    }
    
    const createdParents = await DeviceModel.insertMany(parentDevices);
    testLog.success(`Created ${createdParents.length} test parent devices`);
    
    // Step 3: Create AI Edge Miner devices
    testLog.info(`Step 3: Creating ${NUM_CHILDREN} test AI Edge Miner devices...`);
    const aiEdgeMiners = [];
    for (let i = 1; i <= NUM_CHILDREN; i++) {
      aiEdgeMiners.push({
        miner_key: `ANM-STRESS-CHILD-${String(i).padStart(3, '0')}`,
        name: '$FRY AI Edge Miner',
        email: testEmail,
        order: testOrder,
        is_registered: false,
        enabled: true,
        ai_miner_generated: false,
        created_at: new Date(`2024-01-02T${String(9 + Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 6).padStart(2, '0')}:00Z`)
      });
    }
    
    const createdChildren = await DeviceModel.insertMany(aiEdgeMiners);
    testLog.success(`Created ${createdChildren.length} test AI Edge Miner devices`);
    
    // Step 4: Run stress test with high concurrency
    testLog.info('Step 4: Running stress test with high concurrency...');
    
    const startTime = Date.now();
    
    // Create batches of concurrent operations
    const batchSize = 5;
    const batches = [];
    for (let i = 0; i < createdChildren.length; i += batchSize) {
      batches.push(createdChildren.slice(i, i + batchSize));
    }
    
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      testLog.info(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} devices)`);
      
      // Run batch concurrently
      const batchPromises = batch.map(async (child, index) => {
        try {
          // Add random delay to increase race condition chances
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
          
          const result = await migrateAIEdgeMinerPrefix({
            dryRun: false,
            batchSize: 1
          });
          
          return {
            childId: child._id.toString(),
            success: true,
            result
          };
        } catch (error) {
          return {
            childId: child._id.toString(),
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      const batchSuccessful = batchResults.filter(r => r.success).length;
      const batchFailed = batchResults.filter(r => !r.success).length;
      
      totalSuccessful += batchSuccessful;
      totalFailed += batchFailed;
      
      testLog.info(`Batch ${batchIndex + 1} completed: ${batchSuccessful} successful, ${batchFailed} failed`);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    testResults.push({
      step: 'Stress Test Execution',
      result: {
        totalChildren: NUM_CHILDREN,
        totalParents: NUM_PARENTS,
        totalSuccessful,
        totalFailed,
        duration: totalDuration,
        averageTimePerChild: totalDuration / NUM_CHILDREN
      }
    });
    
    // Step 5: Validate stress test results
    testLog.info('Step 5: Validating stress test results...');
    
    const migratedChildren = await DeviceModel.find({
      email: testEmail,
      name: '$FRY AI Edge Miner',
      miner_key: { $regex: /^AEM-STRESS-CHILD-/ }
    }).lean();
    
    const assignedParents = await DeviceModel.find({
      email: testEmail,
      ai_edge_miner_assigned: true
    }).lean();
    
    // Check for duplicate parent assignments
    const parentAssignments = migratedChildren.reduce<Record<string, number>>((acc, child) => {
      if (child.parent_device_id) {
        const parentId = child.parent_device_id.toString();
        acc[parentId] = (acc[parentId] || 0) + 1;
      }
      return acc;
    }, {});
    
    const duplicateParents = Object.entries(parentAssignments).filter(([_, count]) => count > 1);
    const orphanedChildren = migratedChildren.filter(child => !child.parent_device_id);
    
    const stressTestResults = {
      noDuplicateAssignments: duplicateParents.length === 0,
      expectedOrphanedChildren: orphanedChildren.length === (NUM_CHILDREN - NUM_PARENTS),
      allParentsAssigned: assignedParents.length === NUM_PARENTS,
      correctMigrationCount: migratedChildren.length === NUM_CHILDREN
    };
    
    testResults.push({
      step: 'Stress Test Validation',
      result: {
        ...stressTestResults,
        duplicateParents: duplicateParents.length,
        orphanedChildren: orphanedChildren.length,
        assignedParents: assignedParents.length,
        migratedChildren: migratedChildren.length
      }
    });
    
    const stressTestSuccess = Object.values(stressTestResults).every(v => v === true);
    
    let summary = `🧪 STRESS TEST SUMMARY:\n`;
    summary += `✅ No Duplicate Assignments: ${stressTestResults.noDuplicateAssignments}\n`;
    summary += `✅ Expected Orphaned Children: ${stressTestResults.expectedOrphanedChildren} (${orphanedChildren.length}/${NUM_CHILDREN - NUM_PARENTS})\n`;
    summary += `✅ All Parents Assigned: ${stressTestResults.allParentsAssigned} (${assignedParents.length}/${NUM_PARENTS})\n`;
    summary += `✅ Correct Migration Count: ${stressTestResults.correctMigrationCount} (${migratedChildren.length}/${NUM_CHILDREN})\n`;
    summary += `⏱️ Total Duration: ${totalDuration}ms (${Math.round(totalDuration / NUM_CHILDREN)}ms per child)\n`;
    summary += `\n🎯 STRESS TEST RESULT: ${stressTestSuccess ? 'PASS' : 'FAIL'}`;
    
    if (stressTestSuccess) {
      testLog.success('🎉 STRESS TEST PASSED! System handles high concurrency correctly.');
    } else {
      testLog.error('❌ STRESS TEST FAILED! System failed under high concurrency.');
    }
    
    testLog.info(summary);
    
    // Step 6: Cleanup test data
    testLog.info('Step 6: Cleaning up test data...');
    await DeviceModel.deleteMany({
      $or: [
        { email: testEmail },
        { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-STRESS-/ } }
      ]
    });
    testLog.success('Test data cleanup completed');
    
    return {
      success: stressTestSuccess,
      testResults,
      summary
    };
    
  } catch (error) {
    testLog.error('Stress test failed with critical error', error);
    
    // Cleanup on error
    try {
      await DeviceModel.deleteMany({
        $or: [
          { email: testEmail },
          { miner_key: { $regex: /^(ANM|AEM|RDN|SDN|SVN)-STRESS-/ } }
        ]
      });
    } catch (cleanupError) {
      testLog.error('Cleanup failed', cleanupError);
    }
    
    throw error;
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      testLog.info('🚀 Starting comprehensive parent-child assignment tests...');
      
      // Test 1: Parent-child assignment
      const assignmentTest = await testParentChildAssignment();
      
      // Test 2: Reset functionality
      const resetTest = await testResetFunctionality();
      
      const overallSuccess = assignmentTest.success && resetTest.success;
      
      testLog.info('🏁 ALL TESTS COMPLETED');
      testLog.info(`📊 Assignment Test: ${assignmentTest.success ? 'PASS' : 'FAIL'}`);
      testLog.info(`📊 Reset Test: ${resetTest.success ? 'PASS' : 'FAIL'}`);
      testLog.info(`🎯 OVERALL: ${overallSuccess ? 'PASS' : 'FAIL'}`);
      
      process.exit(overallSuccess ? 0 : 1);
      
    } catch (error) {
      testLog.error('Test suite failed', error);
      process.exit(1);
    }
  })();
}
