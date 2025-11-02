#!/usr/bin/env node

import readline from 'readline';
import { DeviceModel } from '../db/devices-schema.js';
import { connect as connectToDatabase } from '../db/connect.js';
import { migrateAIEdgeMinerPrefix, resetParentAssignmentTracking } from './migration.js';
import { verifyMigrationResults } from './verify-migration-results.js';
import mongoose from 'mongoose';

// ANSI color codes for beautiful CLI output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// Emoji constants for better UX
const emojis = {
  family: '👨‍👩‍👧‍👦',
  link: '🔗',
  search: '🔍',
  stats: '📊',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  gear: '⚙️',
  target: '🎯',
  rocket: '🚀',
  reset: '🔄'
};

// Eligible node types for parent devices
const ELIGIBLE_NODE_TYPES = [
  "$FRY Reward Decentralization Node", 
  "$FRY Contributor Node", 
  "$FRY Storage Decentralization Node", 
  "$FRY Storage Validator Node"
];

class ParentChildCLI {
  private rl: readline.Interface;
  private isConnected = false;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  // Utility methods for colored output
  private log(message: string, color: string = colors.white) {
    console.log(`${color}${message}${colors.reset}`);
  }

  private success(message: string) {
    this.log(`${emojis.success} ${message}`, colors.green);
  }

  private error(message: string) {
    this.log(`${emojis.error} ${message}`, colors.red);
  }

  private warning(message: string) {
    this.log(`${emojis.warning} ${message}`, colors.yellow);
  }

  private info(message: string) {
    this.log(`${emojis.info} ${message}`, colors.cyan);
  }

  private header(message: string) {
    const line = '═'.repeat(60);
    console.log(`\n${colors.bright}${colors.blue}${line}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}${message.toUpperCase()}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}${line}${colors.reset}\n`);
  }

  private separator() {
    console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  }

  // Progress bar utility
  private showProgress(current: number, total: number, label: string = '') {
    const percentage = Math.round((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.round((barLength * current) / total);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    
    process.stdout.write(`\r${colors.cyan}${emojis.gear} ${label} [${colors.green}${bar}${colors.cyan}] ${percentage}% (${current}/${total})${colors.reset}`);
    
    if (current === total) {
      console.log(); // New line when complete
    }
  }

  // Prompt utilities
  private async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(`${colors.yellow}${emojis.target} ${question}${colors.reset} `, resolve);
    });
  }

  private async confirmPrompt(question: string): Promise<boolean> {
    const answer = await this.prompt(`${question} (y/N)`);
    return answer.toLowerCase().startsWith('y');
  }

  private async selectFromMenu(options: string[], title: string): Promise<number> {
    console.log(`\n${colors.bright}${colors.magenta}${title}${colors.reset}`);
    this.separator();
    
    options.forEach((option, index) => {
      console.log(`${colors.cyan}${index + 1}.${colors.reset} ${option}`);
    });
    
    console.log(`${colors.cyan}0.${colors.reset} ${colors.red}Exit${colors.reset}`);
    this.separator();
    
    while (true) {
      const choice = await this.prompt('Select an option');
      const num = parseInt(choice);
      
      if (num === 0) {
        return 0;
      }
      
      if (num >= 1 && num <= options.length) {
        return num;
      }
      
      this.error('Invalid selection. Please try again.');
    }
  }

  // Database connection
  private async ensureConnection(): Promise<boolean> {
    if (this.isConnected) return true;
    
    this.info('Connecting to database...');
    try {
      await connectToDatabase();
      this.isConnected = true;
      this.success('Database connected successfully!');
      return true;
    } catch (error) {
      this.error(`Failed to connect to database: ${error}`);
      return false;
    }
  }

  // Main menu
  private async showMainMenu(): Promise<void> {
    this.header(`${emojis.family} Parent-Child Assignment Manager`);
    
    const options = [
      `${emojis.stats} View Assignment Statistics`,
      `${emojis.search} View Unassigned AI Edge Miners`,
      `${emojis.link} Preview Parent-Child Assignment (Dry Run)`,
      `${emojis.family} Run Parent-Child Assignment (Migration System)`,
      `${emojis.gear} Run Custom Parent-Child Assignment`,
      `${emojis.info} Verify Assignment Results`,
      `${emojis.reset} Reset Assignments (Testing)`,
      `${emojis.reset} Custom Reset Assignments`
    ];

    const choice = await this.selectFromMenu(options, `${emojis.rocket} Main Menu`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.viewAssignmentStats();
        break;
      case 2:
        await this.viewUnassignedAIEdgeMiners();
        break;
      case 3:
        await this.previewParentChildAssignment();
        break;
      case 4:
        await this.runParentChildAssignment();
        break;
      case 5:
        await this.runCustomParentChildAssignment();
        break;
      case 6:
        await this.verifyAssignmentResults();
        break;
      case 7:
        await this.resetAssignments();
        break;
      case 8:
        await this.customResetAssignments();
        break;
    }
  }

  // View assignment statistics
  private async viewAssignmentStats(): Promise<void> {
    this.header(`${emojis.stats} Assignment Statistics`);
    
    if (!(await this.ensureConnection())) return;
    
    try {
      this.info('Gathering assignment statistics...');
      
      // Count AI Edge Miners
      const totalAIEdgeMiners = await DeviceModel.countDocuments({
        name: "$FRY AI Edge Miner"
      });
      
      const assignedAIEdgeMiners = await DeviceModel.countDocuments({
        name: "$FRY AI Edge Miner",
        parent_device_id: { $exists: true, $ne: null }
      });
      
      const unassignedAIEdgeMiners = totalAIEdgeMiners - assignedAIEdgeMiners;
      
      // Count parent devices
      const totalParentDevices = await DeviceModel.countDocuments({
        name: { $in: ELIGIBLE_NODE_TYPES },
        ai_miner_generated: true
      });
      
      const assignedParentDevices = await DeviceModel.countDocuments({
        name: { $in: ELIGIBLE_NODE_TYPES },
        ai_edge_miner_assigned: true
      });
      
      const unassignedParentDevices = totalParentDevices - assignedParentDevices;
      
      // Get assignment breakdown by email/order groups
      const emailOrderGroups = await DeviceModel.aggregate([
        {
          $match: {
            name: "$FRY AI Edge Miner",
            email: { $exists: true, $ne: "" },
            order: { $exists: true, $ne: "" }
          }
        },
        {
          $group: {
            _id: { email: "$email", order: "$order" },
            totalAIMiners: { $sum: 1 },
            assignedAIMiners: {
              $sum: {
                $cond: [{ $ne: ["$parent_device_id", null] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            email: "$_id.email",
            order: "$_id.order",
            totalAIMiners: 1,
            assignedAIMiners: 1,
            unassignedAIMiners: { $subtract: ["$totalAIMiners", "$assignedAIMiners"] }
          }
        },
        { $sort: { unassignedAIMiners: -1, totalAIMiners: -1 } }
      ]);
      
      console.log(`\n${colors.bright}${colors.green}📊 ASSIGNMENT STATISTICS${colors.reset}`);
      this.separator();
      console.log(`${emojis.family} Total AI Edge Miners: ${colors.bright}${colors.cyan}${totalAIEdgeMiners}${colors.reset}`);
      console.log(`${emojis.success} Assigned AI Edge Miners: ${colors.bright}${colors.green}${assignedAIEdgeMiners}${colors.reset}`);
      console.log(`${emojis.warning} Unassigned AI Edge Miners: ${colors.bright}${colors.red}${unassignedAIEdgeMiners}${colors.reset}`);
      
      console.log(`\n${emojis.link} Total Parent Devices: ${colors.bright}${colors.cyan}${totalParentDevices}${colors.reset}`);
      console.log(`${emojis.success} Assigned Parent Devices: ${colors.bright}${colors.green}${assignedParentDevices}${colors.reset}`);
      console.log(`${emojis.warning} Available Parent Devices: ${colors.bright}${colors.yellow}${unassignedParentDevices}${colors.reset}`);
      
      if (emailOrderGroups.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📧 EMAIL/ORDER GROUPS WITH UNASSIGNED AI MINERS (Top 10)${colors.reset}`);
        this.separator();
        emailOrderGroups.slice(0, 10).forEach((group, index) => {
          if (group.unassignedAIMiners > 0) {
            console.log(`${index + 1}. ${colors.cyan}${group.email.substring(0, 25)}...${colors.reset} | Order: ${colors.yellow}${group.order}${colors.reset} | Total: ${colors.bright}${colors.cyan}${group.totalAIMiners}${colors.reset} | Unassigned: ${colors.bright}${colors.red}${group.unassignedAIMiners}${colors.reset}`);
          }
        });
      }
      
      this.success('Assignment statistics retrieved successfully!');
      
    } catch (error) {
      this.error(`Failed to gather statistics: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // View unassigned AI Edge Miners
  private async viewUnassignedAIEdgeMiners(): Promise<void> {
    this.header(`${emojis.search} Unassigned AI Edge Miners`);
    
    if (!(await this.ensureConnection())) return;
    
    const limitInput = await this.prompt('Enter display limit (default: 20, 0 for all)');
    const limit = parseInt(limitInput) || 20;
    
    try {
      this.info('Finding unassigned AI Edge Miners...');
      
      const query = {
        name: "$FRY AI Edge Miner",
        parent_device_id: { $exists: false }
      };
      
      const totalUnassigned = await DeviceModel.countDocuments(query);
      
      const unassignedDevices = await DeviceModel.find(query)
        .select('_id miner_key email order created_at')
        .sort({ created_at: 1 })
        .limit(limit > 0 ? limit : totalUnassigned)
        .lean();
      
      console.log(`\n${colors.bright}${colors.green}🔍 UNASSIGNED AI EDGE MINERS${colors.reset}`);
      this.separator();
      console.log(`${emojis.warning} Total Unassigned: ${colors.bright}${colors.red}${totalUnassigned}${colors.reset}`);
      console.log(`${emojis.info} Showing: ${colors.bright}${colors.cyan}${unassignedDevices.length}${colors.reset} devices`);
      
      if (unassignedDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📋 UNASSIGNED DEVICES${colors.reset}`);
        this.separator();
        unassignedDevices.forEach((device, index) => {
          const email = device.email ? device.email.substring(0, 20) + '...' : 'NO_EMAIL';
          console.log(`${index + 1}. ${colors.cyan}${device.miner_key}${colors.reset} | ${colors.yellow}${email}${colors.reset} | Order: ${colors.magenta}${device.order}${colors.reset} | Created: ${colors.dim}${new Date(device.created_at).toLocaleDateString()}${colors.reset}`);
        });
        
        if (totalUnassigned > unassignedDevices.length) {
          console.log(`${colors.dim}... and ${totalUnassigned - unassignedDevices.length} more unassigned devices${colors.reset}`);
        }
      } else {
        this.success('All AI Edge Miners are already assigned to parent devices!');
      }
      
    } catch (error) {
      this.error(`Failed to retrieve unassigned devices: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Preview parent-child assignment (dry run)
  private async previewParentChildAssignment(): Promise<void> {
    this.header(`${emojis.link} Preview Parent-Child Assignment (Dry Run)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This is a DRY RUN - No actual assignments will be made');
    this.info('This uses the existing migration system to preview assignments');
    
    if (!(await this.confirmPrompt('Continue with assignment preview?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Running assignment preview...');
      
      const result = await migrateAIEdgeMinerPrefix({
        dryRun: true,
        batchSize: 50,
        progressCallback: (progress) => {
          this.showProgress(progress.processed, progress.total, `Previewing ${progress.currentDevice.substring(0, 20)}...`);
        }
      });
      
      console.log(`\n\n${colors.bright}${colors.green}🔍 ASSIGNMENT PREVIEW${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Total AI Edge Miners Found: ${colors.bright}${colors.cyan}${result.totalFound}${colors.reset}`);
      console.log(`${emojis.success} Potential Assignments: ${colors.bright}${colors.green}${result.successCount}${colors.reset}`);
      console.log(`${emojis.warning} Unassignable: ${colors.bright}${colors.red}${result.failCount}${colors.reset}`);
      console.log(`${emojis.family} Parent Devices Found: ${colors.bright}${colors.green}${result.parentDevicesFound}${colors.reset}`);
      console.log(`${emojis.warning} Parent Devices Not Found: ${colors.bright}${colors.yellow}${result.parentDevicesNotFound}${colors.reset}`);
      
      this.success('Assignment preview completed!');
      this.info('No actual changes were made - this was a dry run');
      
    } catch (error) {
      this.error(`Failed to preview assignments: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Run parent-child assignment
  private async runParentChildAssignment(): Promise<void> {
    this.header(`${emojis.family} Run Parent-Child Assignment`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will make REAL assignments in your database');
    this.info('Each AI Edge Miner will be assigned to exactly one parent device (1:1 mapping)');
    this.info('This uses the existing migration system for reliable assignment logic');
    
    if (!(await this.confirmPrompt('Continue with parent-child assignment?'))) {
      await this.showMainMenu();
      return;
    }
    
    // Get batch size
    const batchSizeInput = await this.prompt('Enter batch size (default: 50, max: 200)');
    let batchSize = parseInt(batchSizeInput) || 50;
    if (batchSize > 200) batchSize = 200;
    if (batchSize < 1) batchSize = 50;
    
    console.log(`\n${colors.bright}${colors.yellow}🔗 ASSIGNMENT SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.gear} Batch Size: ${colors.bright}${colors.cyan}${batchSize}${colors.reset}`);
    console.log(`${emojis.warning} This will create permanent assignments`);
    console.log(`${emojis.family} Uses 1:1 parent-child mapping logic`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Running parent-child assignment...');
      
      const result = await migrateAIEdgeMinerPrefix({
        dryRun: false,
        batchSize,
        progressCallback: (progress) => {
          this.showProgress(progress.processed, progress.total, `Processing ${progress.currentDevice.substring(0, 20)}...`);
        }
      });
      
      console.log(`\n\n${colors.bright}${colors.green}🔗 ASSIGNMENT RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Total AI Edge Miners Found: ${colors.bright}${colors.cyan}${result.totalFound}${colors.reset}`);
      console.log(`${emojis.success} Successfully Assigned: ${colors.bright}${colors.green}${result.successCount}${colors.reset}`);
      console.log(`${emojis.error} Failed Assignments: ${colors.bright}${colors.red}${result.failCount}${colors.reset}`);
      console.log(`${emojis.family} Parent Devices Found: ${colors.bright}${colors.green}${result.parentDevicesFound}${colors.reset}`);
      console.log(`${emojis.warning} Parent Devices Not Found: ${colors.bright}${colors.yellow}${result.parentDevicesNotFound}${colors.reset}`);
      
      if (result.failedDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.red}❌ FAILED ASSIGNMENTS (First 5)${colors.reset}`);
        this.separator();
        result.failedDevices.slice(0, 5).forEach((deviceId, index) => {
          console.log(`${index + 1}. ${colors.red}${deviceId}${colors.reset}`);
        });
        if (result.failedDevices.length > 5) {
          console.log(`${colors.dim}... and ${result.failedDevices.length - 5} more${colors.reset}`);
        }
      }
      
      this.success('Parent-child assignment completed successfully!');
      this.info('Use "Verify Assignment Results" to check the assignment quality');
      
    } catch (error) {
      this.error(`Failed to run assignments: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Verify assignment results
  private async verifyAssignmentResults(): Promise<void> {
    this.header(`${emojis.info} Verify Assignment Results`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will verify the 1:1 parent-child assignment results');
    this.success('This is a read-only operation that does not modify any data');
    
    if (!(await this.confirmPrompt('Continue with assignment verification?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Running assignment verification...');
      const result = await verifyMigrationResults();
      
      console.log(`\n${colors.bright}${result.success ? colors.green : colors.red}🔍 VERIFICATION RESULTS${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success('🎉 VERIFICATION PASSED! All AI Edge Miners have unique parent assignments.');
        
        console.log(`\n${colors.bright}${colors.blue}📊 VERIFICATION SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        this.info('✅ Each AI Edge Miner has a unique parent device');
        this.info('✅ No duplicate parent assignments detected');
        this.info('✅ All parent-child relationships are properly established');
        
      } else {
        this.error('❌ VERIFICATION FAILED! Issues found with parent assignments.');
        
        console.log(`\n${colors.bright}${colors.red}📋 FAILURE SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        this.warning('Please review the issues and consider running the assignment again or using the reset functionality');
      }
      
    } catch (error) {
      this.error(`Assignment verification failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Reset assignments
  private async resetAssignments(): Promise<void> {
    this.header(`${emojis.reset} Reset Assignments (Testing)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will reset parent-child assignments in your database');
    this.warning('This is primarily for testing purposes');
    
    // Optional filters
    const emailFilterInput = await this.prompt('Filter by specific emails? (comma-separated, or press Enter for all)');
    const emails = emailFilterInput.trim() ? emailFilterInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : undefined;
    
    const orderFilterInput = await this.prompt('Filter by specific orders? (comma-separated, or press Enter for all)');
    const orders = orderFilterInput.trim() ? orderFilterInput.split(',').map(o => o.trim()).filter(o => o.length > 0) : undefined;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔄 RESET SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.family} Email Filter: ${colors.bright}${emails ? colors.green + `${emails.length} emails` : colors.red + 'All emails'}${colors.reset}`);
    console.log(`${emojis.target} Order Filter: ${colors.bright}${orders ? colors.green + `${orders.length} orders` : colors.red + 'All orders'}${colors.reset}`);
    console.log(`${emojis.warning} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Previewing' : 'Executing'} assignment reset...`);
      
      const result = await resetParentAssignmentTracking({
        dryRun,
        emails,
        orders
      });
      
      console.log(`\n${colors.bright}${colors.green}🔄 RESET RESULTS${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success(result.message);
        console.log(`${emojis.gear} Reset Parent Devices: ${colors.bright}${colors.cyan}${result.resetParentDevicesCount}${colors.reset}`);
        console.log(`${emojis.family} Reset AI Edge Miners: ${colors.bright}${colors.green}${result.resetAIEdgeMinerCount}${colors.reset}`);
        
        if (dryRun) {
          this.info('This was a dry run - no actual changes were made');
          this.info('Run without dry run mode to perform the actual reset');
        } else {
          this.success('Assignment reset completed successfully!');
          this.info('You can now run parent-child assignment to reassign devices');
        }
      } else {
        this.error('Reset failed - check the error details above');
      }
      
    } catch (error) {
      this.error(`Failed to reset assignments: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Run custom parent-child assignment with granular control
  private async runCustomParentChildAssignment(): Promise<void> {
    this.header(`${emojis.gear} Run Custom Parent-Child Assignment`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will make REAL assignments in your database using custom logic');
    this.info('This provides more granular control than the migration system');
    
    if (!(await this.confirmPrompt('Continue with custom parent-child assignment?'))) {
      await this.showMainMenu();
      return;
    }
    
    // Optional filters
    const emailFilterInput = await this.prompt('Filter by specific emails? (comma-separated, or press Enter for all)');
    const emails = emailFilterInput.trim() ? emailFilterInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : undefined;
    
    const orderFilterInput = await this.prompt('Filter by specific orders? (comma-separated, or press Enter for all)');
    const orders = orderFilterInput.trim() ? orderFilterInput.split(',').map(o => o.trim()).filter(o => o.length > 0) : undefined;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔗 CUSTOM ASSIGNMENT SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.family} Email Filter: ${colors.bright}${emails ? colors.green + `${emails.length} emails` : colors.red + 'All emails'}${colors.reset}`);
    console.log(`${emojis.target} Order Filter: ${colors.bright}${orders ? colors.green + `${orders.length} orders` : colors.red + 'All orders'}${colors.reset}`);
    console.log(`${emojis.warning} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    console.log(`${emojis.gear} Uses custom 1:1 assignment logic`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Running custom parent-child assignment...');
      
      const result = await this.performParentChildAssignment({
        dryRun,
        emails,
        orders,
        progressCallback: (progress) => {
          this.showProgress(progress.processed, progress.total, `Processing group ${progress.currentGroup}`);
        }
      });
      
      console.log(`\n\n${colors.bright}${colors.green}🔗 CUSTOM ASSIGNMENT RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Successful Assignments: ${colors.bright}${colors.green}${result.assignmentCount}${colors.reset}`);
      console.log(`${emojis.warning} Unassignable AI Miners: ${colors.bright}${colors.red}${result.unassignableCount}${colors.reset}`);
      console.log(`${emojis.info} Email/Order Groups Processed: ${colors.bright}${colors.cyan}${result.groupsProcessed}${colors.reset}`);
      
      if (result.assignments.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📋 SAMPLE ASSIGNMENTS (First 5)${colors.reset}`);
        this.separator();
        result.assignments.slice(0, 5).forEach((assignment, index) => {
          console.log(`${index + 1}. Child: ${colors.cyan}${assignment.childKey}${colors.reset} → Parent: ${colors.magenta}${assignment.parentName}${colors.reset} (${colors.yellow}${assignment.parentKey}${colors.reset})`);
        });
        
        if (result.assignments.length > 5) {
          console.log(`${colors.dim}... and ${result.assignments.length - 5} more assignments${colors.reset}`);
        }
      }
      
      if (result.unassignableReasons.length > 0) {
        console.log(`\n${colors.bright}${colors.red}❌ UNASSIGNABLE REASONS${colors.reset}`);
        this.separator();
        const reasonCounts = result.unassignableReasons.reduce((acc, reason) => {
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        Object.entries(reasonCounts).forEach(([reason, count]) => {
          console.log(`${emojis.warning} ${reason}: ${colors.bright}${colors.red}${count}${colors.reset} devices`);
        });
      }
      
      this.success('Custom parent-child assignment completed successfully!');
      
    } catch (error) {
      this.error(`Failed to run custom assignments: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Custom reset assignments with granular control
  private async customResetAssignments(): Promise<void> {
    this.header(`${emojis.reset} Custom Reset Assignments`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will reset parent-child assignments using custom logic');
    this.info('This provides more granular control than the migration reset');
    
    // Optional filters
    const emailFilterInput = await this.prompt('Filter by specific emails? (comma-separated, or press Enter for all)');
    const emails = emailFilterInput.trim() ? emailFilterInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : undefined;
    
    const orderFilterInput = await this.prompt('Filter by specific orders? (comma-separated, or press Enter for all)');
    const orders = orderFilterInput.trim() ? orderFilterInput.split(',').map(o => o.trim()).filter(o => o.length > 0) : undefined;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔄 CUSTOM RESET SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.family} Email Filter: ${colors.bright}${emails ? colors.green + `${emails.length} emails` : colors.red + 'All emails'}${colors.reset}`);
    console.log(`${emojis.target} Order Filter: ${colors.bright}${orders ? colors.green + `${orders.length} orders` : colors.red + 'All orders'}${colors.reset}`);
    console.log(`${emojis.warning} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Previewing' : 'Executing'} custom assignment reset...`);
      
      const result = await this.performAssignmentReset({
        dryRun,
        emails,
        orders
      });
      
      console.log(`\n${colors.bright}${colors.green}🔄 CUSTOM RESET RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.reset} Reset Parent Devices: ${colors.bright}${colors.cyan}${result.resetParentDevicesCount}${colors.reset}`);
      console.log(`${emojis.family} Reset AI Edge Miners: ${colors.bright}${colors.green}${result.resetAIEdgeMinerCount}${colors.reset}`);
      
      if (dryRun) {
        this.info('This was a dry run - no actual changes were made');
        this.info('Run without dry run mode to perform the actual reset');
      } else {
        this.success('Custom assignment reset completed successfully!');
        this.info('You can now run parent-child assignment to reassign devices');
      }
      
    } catch (error) {
      this.error(`Failed to reset assignments: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Core assignment logic
  private async performParentChildAssignment(options: {
    dryRun: boolean;
    emails?: string[];
    orders?: string[];
    progressCallback?: (progress: { processed: number; total: number; currentGroup: string }) => void;
  }): Promise<{
    assignmentCount: number;
    unassignableCount: number;
    groupsProcessed: number;
    assignments: Array<{
      childId: string;
      childKey: string;
      parentId: string;
      parentKey: string;
      parentName: string;
    }>;
    unassignableReasons: string[];
  }> {
    const { dryRun, emails, orders, progressCallback } = options;
    
    let assignmentCount = 0;
    let unassignableCount = 0;
    let groupsProcessed = 0;
    const assignments: any[] = [];
    const unassignableReasons: string[] = [];
    
    // Build query for AI Edge Miners
    let aiMinerQuery: any = {
      name: "$FRY AI Edge Miner",
      parent_device_id: { $exists: false },
      email: { $exists: true, $ne: "" },
      order: { $exists: true, $ne: "" }
    };
    
    if (emails && emails.length > 0) {
      aiMinerQuery.email = { $in: emails };
    }
    
    if (orders && orders.length > 0) {
      aiMinerQuery.order = { $in: orders };
    }
    
    // Group AI Edge Miners by email and order
    const emailOrderGroups = await DeviceModel.aggregate([
      { $match: aiMinerQuery },
      {
        $group: {
          _id: { email: "$email", order: "$order" },
          aiMiners: {
            $push: {
              _id: "$_id",
              miner_key: "$miner_key",
              created_at: "$created_at"
            }
          }
        }
      },
      {
        $project: {
          email: "$_id.email",
          order: "$_id.order",
          aiMiners: 1
        }
      }
    ]);
    
    const totalGroups = emailOrderGroups.length;
    
    for (const group of emailOrderGroups) {
      groupsProcessed++;
      
      if (progressCallback) {
        progressCallback({
          processed: groupsProcessed,
          total: totalGroups,
          currentGroup: `${group.email.substring(0, 20)}... (${group.order})`
        });
      }
      
      // Find available parent devices for this email/order
      const parentDevices = await DeviceModel.find({
        email: group.email,
        order: group.order,
        name: { $in: ELIGIBLE_NODE_TYPES },
        ai_miner_generated: true,
        ai_edge_miner_assigned: { $ne: true }
      })
      .select('_id miner_key name created_at')
      .sort({ created_at: 1 }) // Oldest first for deterministic assignment
      .lean();
      
      // Sort AI Edge Miners by creation date (oldest first)
      const sortedAIMiners = group.aiMiners.sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Assign parents to children (1:1 mapping)
      for (let i = 0; i < sortedAIMiners.length; i++) {
        const aiMiner = sortedAIMiners[i];
        
        if (i < parentDevices.length) {
          const parentDevice = parentDevices[i];
          
          if (!dryRun) {
            // Start transaction for each assignment
            const session = await mongoose.startSession();
            
            try {
              await session.withTransaction(async () => {
                // Update AI Edge Miner with parent references
                await DeviceModel.updateOne(
                  { _id: aiMiner._id },
                  {
                    $set: {
                      parent_device_id: parentDevice._id,
                      parent_device_name: parentDevice.name,
                      parent_device_miner_key: parentDevice.miner_key
                    }
                  },
                  { session }
                );
                
                // Update parent device with assignment tracking
                await DeviceModel.updateOne(
                  { _id: parentDevice._id },
                  {
                    $set: {
                      ai_edge_miner_assigned: true,
                      assigned_ai_edge_miner_id: aiMiner._id
                    }
                  },
                  { session }
                );
              });
            } finally {
              await session.endSession();
            }
          }
          
          assignments.push({
            childId: aiMiner._id.toString(),
            childKey: aiMiner.miner_key,
            parentId: parentDevice._id.toString(),
            parentKey: parentDevice.miner_key,
            parentName: parentDevice.name
          });
          
          assignmentCount++;
        } else {
          // No available parent device
          unassignableCount++;
          unassignableReasons.push('No available parent device');
        }
      }
    }
    
    return {
      assignmentCount,
      unassignableCount,
      groupsProcessed,
      assignments,
      unassignableReasons
    };
  }

  // Core reset logic
  private async performAssignmentReset(options: {
    dryRun: boolean;
    emails?: string[];
    orders?: string[];
  }): Promise<{
    resetParentDevicesCount: number;
    resetAIEdgeMinerCount: number;
  }> {
    const { dryRun, emails, orders } = options;
    
    // Build query filters
    let emailOrderFilter: any = {};
    
    if (emails && emails.length > 0) {
      emailOrderFilter.email = { $in: emails };
    }
    
    if (orders && orders.length > 0) {
      emailOrderFilter.order = { $in: orders };
    }
    
    let resetParentDevicesCount = 0;
    let resetAIEdgeMinerCount = 0;
    
    if (!dryRun) {
      // Reset parent devices
      const parentResetResult = await DeviceModel.updateMany(
        {
          name: { $in: ELIGIBLE_NODE_TYPES },
          ai_edge_miner_assigned: true,
          ...emailOrderFilter
        },
        {
          $unset: {
            ai_edge_miner_assigned: 1,
            assigned_ai_edge_miner_id: 1
          }
        }
      );
      
      resetParentDevicesCount = parentResetResult.modifiedCount;
      
      // Reset AI Edge Miners
      const aiMinerResetResult = await DeviceModel.updateMany(
        {
          name: "$FRY AI Edge Miner",
          parent_device_id: { $exists: true },
          ...emailOrderFilter
        },
        {
          $unset: {
            parent_device_id: 1,
            parent_device_name: 1,
            parent_device_miner_key: 1
          }
        }
      );
      
      resetAIEdgeMinerCount = aiMinerResetResult.modifiedCount;
    } else {
      // Dry run - count what would be reset
      resetParentDevicesCount = await DeviceModel.countDocuments({
        name: { $in: ELIGIBLE_NODE_TYPES },
        ai_edge_miner_assigned: true,
        ...emailOrderFilter
      });
      
      resetAIEdgeMinerCount = await DeviceModel.countDocuments({
        name: "$FRY AI Edge Miner",
        parent_device_id: { $exists: true },
        ...emailOrderFilter
      });
    }
    
    return {
      resetParentDevicesCount,
      resetAIEdgeMinerCount
    };
  }

  // Exit application
  private async exit(): Promise<void> {
    this.header(`${emojis.family} Thank You!`);
    this.success('Parent-Child Assignment CLI shutting down...');
    this.rl.close();
    process.exit(0);
  }

  // Start the CLI
  public async start(): Promise<void> {
    console.clear();
    this.header(`${emojis.rocket} Welcome to Parent-Child Assignment CLI`);
    this.info('Initializing system...');
    
    // Show welcome message
    console.log(`${colors.bright}${colors.cyan}🎯 This tool helps you manage parent-child assignments for AI Edge Miners${colors.reset}`);
    console.log(`${colors.dim}   • View assignment statistics${colors.reset}`);
    console.log(`${colors.dim}   • Find unassigned AI Edge Miners${colors.reset}`);
    console.log(`${colors.dim}   • Preview assignments (dry run)${colors.reset}`);
    console.log(`${colors.dim}   • Execute parent-child assignments (1:1 mapping)${colors.reset}`);
    console.log(`${colors.dim}   • Verify assignment results${colors.reset}`);
    console.log(`${colors.dim}   • Reset assignments for testing${colors.reset}\n`);
    
    await this.showMainMenu();
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new ParentChildCLI();
  cli.start().catch((error) => {
    console.error(`${colors.red}${emojis.error} CLI Error: ${error}${colors.reset}`);
    process.exit(1);
  });
}

export { ParentChildCLI };
