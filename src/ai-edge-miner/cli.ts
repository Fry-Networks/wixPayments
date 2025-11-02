#!/usr/bin/env node

import readline from 'readline';
import { 
  simulateAIMinerGeneration,
  generateAIMinerKeysForEligibleUsers,
  generateAIMinerKeysBatch,
  getEligibilityStats,
  monitorNewRegistrationsAndGenerateAIMiners,
  addAIMinerFieldToDevice,
  generateAndSendAIMinerKeyByMinerKey,
  migrateSingleAIEdgeMinerPrefix,
  // Email queue management functions
  getEmailQueueStats,
  previewEmailQueue,
  sendPendingEmailsBatch,
  getEmailSendingHistory,
  resetEmailQueueStatus,
  // Deprecated functions (for backward compatibility)
  generateFreeAIMinersForExistingUsers,
  generateFreeAIMinersForExistingUsersBatch
} from './ai-miner-service.js';
import { migrateDeviceFields, migrateAIEdgeMinerPrefix, resetParentAssignmentTracking } from './migration.js';
import { testParentChildAssignment, testResetFunctionality } from './test-parent-assignment.js';
import { verifyMigrationResults } from './verify-migration-results.js';
import { connect as connectToDatabase } from '../db/connect.js';

// Type definition for devices with parent information in email queue preview
interface DeviceWithParentInfo {
  _id: any;
  miner_key: string;
  created_at: Date;
  parentDeviceName?: string;
  parentDeviceKey?: string;
}

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
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m'
};

// Emoji constants for better UX
const emojis = {
  robot: '🤖',
  rocket: '🚀',
  warning: '⚠️',
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  stats: '📊',
  email: '📧',
  key: '🔑',
  gear: '⚙️',
  magnifying: '🔍',
  test: '🧪',
  batch: '⚡',
  clock: '⏰',
  fire: '🔥',
  shield: '🛡️',
  target: '🎯'
};

class AIEdgeMinerCLI {
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
    this.header(`${emojis.robot} AI Edge Miner Key Management System`);
    
    const options = [
      `${emojis.stats} View Eligibility Statistics`,
      `${emojis.magnifying} Simulation Mode (Dry Run)`,
      `${emojis.test} Test Mode (1-2 Users)`,
      `${emojis.batch} Batch Processing (All Eligible Users)`,
      `📧 Email Distribution Management`,
      `${emojis.clock} Monitor New Registrations`,
      `${emojis.gear} Advanced Configuration`
    ];

    const choice = await this.selectFromMenu(options, `${emojis.fire} Main Menu`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.showEligibilityStats();
        break;
      case 2:
        await this.runSimulation();
        break;
      case 3:
        await this.runTestMode();
        break;
      case 4:
        await this.runBatchProcessing();
        break;
      case 5:
        await this.showEmailDistributionMenu();
        break;
      case 6:
        await this.monitorNewRegistrations();
        break;
      case 7:
        await this.showAdvancedConfig();
        break;
    }
  }

  // Show eligibility statistics
  private async showEligibilityStats(): Promise<void> {
    this.header(`${emojis.stats} Eligibility Statistics`);
    
    if (!(await this.ensureConnection())) return;
    
    try {
      this.info('Gathering statistics...');
      const stats = await getEligibilityStats();
      
      console.log(`\n${colors.bright}${colors.green}📊 ELIGIBILITY REPORT${colors.reset}`);
      this.separator();
      console.log(`${emojis.key} Total Eligible Devices: ${colors.bright}${colors.green}${stats.totalEligibleDevices}${colors.reset}`);
      console.log(`${emojis.email} Unique Email Addresses: ${colors.bright}${colors.cyan}${stats.uniqueEmails}${colors.reset}`);
      console.log(`${emojis.target} Emails with Multiple Devices: ${colors.bright}${colors.yellow}${stats.emailsWithMultipleDevices}${colors.reset}`);
      console.log(`${emojis.info} Average Devices per Email: ${colors.bright}${colors.magenta}${stats.averageDevicesPerEmail}${colors.reset}`);
      
      console.log(`\n${colors.bright}${colors.blue}🔧 DEVICES BY NODE TYPE${colors.reset}`);
      this.separator();
      Object.entries(stats.devicesByNodeType).forEach(([nodeType, count]) => {
        console.log(`${emojis.gear} ${nodeType}: ${colors.bright}${colors.white}${count}${colors.reset}`);
      });
      
      this.separator();
      this.success('Statistics gathered successfully!');
      
    } catch (error) {
      this.error(`Failed to gather statistics: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Run simulation
  private async runSimulation(): Promise<void> {
    this.header(`${emojis.magnifying} Simulation Mode (Dry Run)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This is a DRY RUN - No keys will be generated or emails sent');
    
    if (!(await this.confirmPrompt('Continue with simulation?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Running simulation...');
      const eligibleDevices = await simulateAIMinerGeneration();
      
      console.log(`\n${colors.bright}${colors.green}🔍 SIMULATION RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Found ${colors.bright}${colors.green}${eligibleDevices.length}${colors.reset} eligible devices`);
      
      if (eligibleDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📋 SAMPLE ELIGIBLE DEVICES (First 5)${colors.reset}`);
        this.separator();
        eligibleDevices.slice(0, 5).forEach((device, index) => {
          console.log(`${index + 1}. Order: ${colors.cyan}${device.order}${colors.reset} | Email: ${colors.yellow}${device.email?.substring(0, 3)}***${colors.reset} | Name: ${colors.magenta}${device.name}${colors.reset}`);
        });
        
        if (eligibleDevices.length > 5) {
          console.log(`${colors.dim}... and ${eligibleDevices.length - 5} more devices${colors.reset}`);
        }
      }
      
      this.success('Simulation completed successfully!');
      
    } catch (error) {
      this.error(`Simulation failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Run test mode
  private async runTestMode(): Promise<void> {
    this.header(`${emojis.test} Test Mode (1-2 Users)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will generate REAL keys but NO emails will be sent');
    this.info('Use Email Distribution Management to send emails separately');
    
    if (!(await this.confirmPrompt('Continue with test mode?'))) {
      await this.showMainMenu();
      return;
    }
    
    const emailInput = await this.prompt('Enter 1-2 email addresses (comma-separated)');
    const emails = emailInput.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    if (emails.length === 0 || emails.length > 2) {
      this.error('Please provide 1-2 valid email addresses');
      await this.runTestMode();
      return;
    }
    
    console.log(`\n${colors.bright}${colors.yellow}📧 TEST EMAILS${colors.reset}`);
    this.separator();
    emails.forEach((email, index) => {
      console.log(`${index + 1}. ${colors.cyan}${email}${colors.reset}`);
    });
    
    if (!(await this.confirmPrompt('\nProceed with these email addresses?'))) {
      await this.runTestMode();
      return;
    }
    
    try {
      this.info('Processing test users (generating keys only)...');
      const result = await generateAIMinerKeysForEligibleUsers(emails);
      
      console.log(`\n${colors.bright}${colors.green}🧪 TEST RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Successfully processed: ${colors.bright}${colors.green}${result.successCount}${colors.reset} devices`);
      console.log(`${emojis.error} Failed: ${colors.bright}${colors.red}${result.failCount}${colors.reset} devices`);
      console.log(`${emojis.info} Keys generated but no emails sent`);
      console.log(`${emojis.email} Use Email Distribution Management to send emails`);
      
      this.success('Test mode completed!');
      
    } catch (error) {
      this.error(`Test mode failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Run batch processing
  private async runBatchProcessing(): Promise<void> {
    this.header(`${emojis.batch} Batch Processing (All Eligible Users)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will generate REAL keys for ALL eligible users but NO emails will be sent');
    this.info('Use Email Distribution Management to send emails separately');
    this.warning('This operation cannot be undone!');
    
    if (!(await this.confirmPrompt('Are you absolutely sure you want to proceed?'))) {
      await this.showMainMenu();
      return;
    }
    
    // Get batch size
    const batchSizeInput = await this.prompt('Enter batch size (default: 100, max: 500)');
    let batchSize = parseInt(batchSizeInput) || 100;
    if (batchSize > 500) batchSize = 500;
    if (batchSize < 1) batchSize = 100;
    
    // Final confirmation
    console.log(`\n${colors.bright}${colors.red}⚠️  FINAL CONFIRMATION${colors.reset}`);
    this.separator();
    console.log(`${emojis.batch} Batch Size: ${colors.bright}${colors.cyan}${batchSize}${colors.reset}`);
    console.log(`${emojis.warning} This will process ALL eligible users`);
    console.log(`${emojis.key} Real keys will be generated but NO emails sent`);
    console.log(`${emojis.email} Use Email Distribution Management for emails`);
    
    if (!(await this.confirmPrompt('\nType "YES" to confirm'))) {
      this.info('Operation cancelled');
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Starting batch processing (key generation only)...');
      
      let currentProgress = 0;
      let totalDevices = 0;
      
      const result = await generateAIMinerKeysBatch({
        batchSize,
        progressCallback: (progress) => {
          if (totalDevices === 0) totalDevices = progress.total;
          currentProgress = progress.processed;
          this.showProgress(progress.processed, progress.total, `Processing ${progress.currentDevice.substring(0, 20)}...`);
        }
      });
      
      console.log(`\n\n${colors.bright}${colors.green}⚡ BATCH PROCESSING RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Successfully processed: ${colors.bright}${colors.green}${result.successCount}${colors.reset} devices`);
      console.log(`${emojis.error} Failed: ${colors.bright}${colors.red}${result.failCount}${colors.reset} devices`);
      console.log(`${emojis.key} Keys generated but no emails sent`);
      console.log(`${emojis.stats} Total eligible devices: ${colors.bright}${colors.magenta}${result.eligibleDevicesCount}${colors.reset}`);
      console.log(`${emojis.target} Unique emails: ${colors.bright}${colors.blue}${result.uniqueEmailsCount}${colors.reset}`);
      console.log(`${emojis.email} Use Email Distribution Management to send emails`);
      
      if (result.failedDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.red}❌ FAILED DEVICES${colors.reset}`);
        this.separator();
        result.failedDevices.slice(0, 10).forEach((deviceId, index) => {
          console.log(`${index + 1}. ${colors.red}${deviceId}${colors.reset}`);
        });
        if (result.failedDevices.length > 10) {
          console.log(`${colors.dim}... and ${result.failedDevices.length - 10} more${colors.reset}`);
        }
      }
      
      this.success('Batch processing completed!');
      
    } catch (error) {
      this.error(`Batch processing failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Monitor new registrations
  private async monitorNewRegistrations(): Promise<void> {
    this.header(`${emojis.clock} Monitor New Registrations`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will check for newly completed registrations and generate keys');
    
    if (!(await this.confirmPrompt('Continue with monitoring?'))) {
      await this.showMainMenu();
      return;
    }
    
    try {
      this.info('Monitoring new registrations...');
      const result = await monitorNewRegistrationsAndGenerateAIMiners();
      
      console.log(`\n${colors.bright}${colors.green}⏰ MONITORING RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Successfully processed: ${colors.bright}${colors.green}${result.successCount}${colors.reset} new devices`);
      console.log(`${emojis.error} Failed: ${colors.bright}${colors.red}${result.failCount}${colors.reset} devices`);
      
      if (result.successCount === 0 && result.failCount === 0) {
        this.info('No new eligible registrations found');
      }
      
      this.success('Monitoring completed!');
      
    } catch (error) {
      this.error(`Monitoring failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showMainMenu();
  }

  // Advanced configuration
  private async showAdvancedConfig(): Promise<void> {
    this.header(`${emojis.gear} Advanced Configuration`);
    
    const options = [
      `🔄 Initialize AI Miner Field (Database Migration)`,
      `🔄 Migrate AI Edge Miner Prefix (ANM → AEM)`,
      `${emojis.test} Test Parent-Child Assignment Logic`,
      `${emojis.magnifying} Verify Migration Results`,
      `${emojis.key} Single Device Testing Options`,
      `${emojis.magnifying} Run Dry Run with Custom Batch Size`,
      `${emojis.shield} Database Connection Test`,
      `${emojis.info} Show System Information`,
      `${emojis.target} Back to Main Menu`
    ];

    const choice = await this.selectFromMenu(options, `${emojis.gear} Advanced Options`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.runDatabaseMigration();
        break;
      case 2:
        await this.runPrefixMigration();
        break;
      case 3:
        await this.runParentChildAssignmentTests();
        break;
      case 4:
        await this.verifyMigrationResults();
        break;
      case 5:
        await this.showSingleDeviceTestingOptions();
        break;
      case 6:
        await this.runCustomDryRun();
        break;
      case 7:
        await this.testDatabaseConnection();
        break;
      case 8:
        await this.showSystemInfo();
        break;
      case 9:
        await this.showMainMenu();
        break;
    }
  }

  // Single device testing options
  private async showSingleDeviceTestingOptions(): Promise<void> {
    this.header(`${emojis.key} Single Device Testing Options`);
    
    const options = [
      `${emojis.gear} Add AI Miner Field Only`,
      `🔄 Test Prefix Migration (ANM → AEM)`,
      `${emojis.test} Dry Run - Generate Key (No Email)`,
      `${emojis.fire} Generate and Send AI Miner Key`,
      `📧 Send Email by Email Address (Existing Keys)`,
      `${emojis.target} Back to Advanced Config`
    ];

    const choice = await this.selectFromMenu(options, `${emojis.key} Single Device Testing`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.addAIMinerFieldToSingleDevice();
        break;
      case 2:
        await this.testSingleDevicePrefixMigration();
        break;
      case 3:
        await this.generateAndSendAIMinerKeyToSingleDevice(true);
        break;
      case 4:
        await this.generateAndSendAIMinerKeyToSingleDevice();
        break;
      case 5:
        await this.sendEmailByEmailAddress();
        break;
      case 6:
        await this.showAdvancedConfig();
        break;
    }
  }

  // Add AI Miner field to single device
  private async addAIMinerFieldToSingleDevice(): Promise<void> {
    this.header(`${emojis.gear} Add AI Miner Field to Single Device`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will add the ai_miner_generated field (set to false) to a single device');
    this.warning('This is for testing before running the full migration');
    
    const minerKey = await this.prompt('Enter the miner_key of the device');
    
    if (!minerKey || minerKey.trim() === '') {
      this.error('Miner key cannot be empty');
      await this.addAIMinerFieldToSingleDevice();
      return;
    }
    
    console.log(`\n${colors.bright}${colors.yellow}🔑 TARGET DEVICE${colors.reset}`);
    this.separator();
    console.log(`${emojis.key} Miner Key: ${colors.cyan}${minerKey.substring(0, 8)}...${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with adding ai_miner_generated field to this device?'))) {
      await this.showSingleDeviceTestingOptions();
      return;
    }
    
    try {
      this.info('Adding ai_miner_generated field to device...');
      const result = await addAIMinerFieldToDevice(minerKey);
      
      console.log(`\n${colors.bright}${colors.green}🔑 OPERATION RESULT${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success(result.message);
        
        if (result.device) {
          console.log(`\n${colors.bright}${colors.blue}📋 DEVICE DETAILS${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
          console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
          console.log(`${emojis.target} Order: ${colors.yellow}${result.device.order}${colors.reset}`);
          console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
          console.log(`${emojis.success} AI Miner Generated: ${colors.bright}${colors.red}${result.device.ai_miner_generated}${colors.reset}`);
        }
      } else {
        this.error(result.message);
        
        if (result.device) {
          console.log(`\n${colors.bright}${colors.yellow}📋 DEVICE DETAILS${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
          console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
          console.log(`${emojis.target} Order: ${colors.yellow}${result.device.order}${colors.reset}`);
          console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
          console.log(`${emojis.warning} AI Miner Generated: ${colors.bright}${colors.yellow}${result.device.ai_miner_generated}${colors.reset}`);
        }
      }
      
    } catch (error) {
      this.error(`Failed to add field to device: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showSingleDeviceTestingOptions();
  }

  // Test single device prefix migration
  private async testSingleDevicePrefixMigration(): Promise<void> {
    this.header(`🔄 Test Prefix Migration (ANM → AEM)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will test migrating a single AI Edge Miner device from ANM to AEM prefix');
    this.warning('This is for testing before running the full migration on all devices');
    
    const minerKey = await this.prompt('Enter the miner_key of the AI Edge Miner device (should start with ANM-)');
    
    if (!minerKey || minerKey.trim() === '') {
      this.error('Miner key cannot be empty');
      await this.testSingleDevicePrefixMigration();
      return;
    }
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔄 MIGRATION SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.key} Miner Key: ${colors.cyan}${minerKey.substring(0, 8)}...${colors.reset}`);
    console.log(`${emojis.test} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    console.log(`${emojis.warning} Will update: ANM-* → AEM-*`);
    console.log(`${emojis.gear} Will remove: enabled and ai_miner_generated fields`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showSingleDeviceTestingOptions();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Running dry run for' : 'Migrating'} single device prefix...`);
      const result = await migrateSingleAIEdgeMinerPrefix(minerKey, { dryRun });
      
      console.log(`\n${colors.bright}${colors.green}🔄 MIGRATION RESULT${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success(result.message);
        
        if (result.oldKey && result.newKey) {
          console.log(`${emojis.key} Key Migration: ${colors.bright}${colors.cyan}${result.oldKey}${colors.reset} → ${colors.bright}${colors.green}${result.newKey}${colors.reset}`);
        }
        
        if (result.removedFields && result.removedFields.length > 0) {
          console.log(`${emojis.gear} Removed Fields: ${colors.bright}${colors.yellow}[${result.removedFields.join(', ')}]${colors.reset}`);
        }
        
        if (result.device) {
          console.log(`\n${colors.bright}${colors.blue}📋 DEVICE DETAILS${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
          console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
          console.log(`${emojis.target} Miner Key: ${colors.bright}${colors.green}${result.device.miner_key}${colors.reset}`);
          console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
          console.log(`${emojis.info} Enabled: ${colors.bright}${result.device.enabled !== undefined ? colors.yellow + result.device.enabled : colors.green + 'REMOVED'}${colors.reset}`);
          console.log(`${emojis.info} AI Miner Generated: ${colors.bright}${result.device.ai_miner_generated !== undefined ? colors.yellow + result.device.ai_miner_generated : colors.green + 'REMOVED'}${colors.reset}`);
          
          // Show parent device information if available
          if (result.device.parent_device_id || result.device.parent_device_name) {
            console.log(`\n${colors.bright}${colors.green}👨‍👩‍👧‍👦 PARENT DEVICE INFO${colors.reset}`);
            this.separator();
            if (result.device.parent_device_id) {
              console.log(`${emojis.gear} Parent Device ID: ${colors.cyan}${result.device.parent_device_id}${colors.reset}`);
            }
            if (result.device.parent_device_name) {
              console.log(`${emojis.key} Parent Device Name: ${colors.magenta}${result.device.parent_device_name}${colors.reset}`);
            }
            if (result.device.parent_device_miner_key) {
              console.log(`${emojis.target} Parent Miner Key: ${colors.yellow}${result.device.parent_device_miner_key}${colors.reset}`);
            }
          }
        }
        
        // Show parent device details if found
        if (result.parentDevice) {
          console.log(`\n${colors.bright}${colors.green}🔗 PARENT DEVICE FOUND${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Parent Device ID: ${colors.cyan}${result.parentDevice._id}${colors.reset}`);
          console.log(`${emojis.key} Parent Device Name: ${colors.magenta}${result.parentDevice.name}${colors.reset}`);
          console.log(`${emojis.target} Parent Miner Key: ${colors.yellow}${result.parentDevice.miner_key}${colors.reset}`);
          console.log(`${emojis.email} Parent Email: ${colors.green}${result.parentDevice.email}${colors.reset}`);
          console.log(`${emojis.info} Parent Order: ${colors.cyan}${result.parentDevice.order}${colors.reset}`);
        }
        
        if (dryRun) {
          this.info('This was a dry run - no actual changes were made');
          this.info('Run without dry run mode to perform the actual migration');
        } else {
          this.success('Single device prefix migration completed successfully!');
        }
        
      } else {
        this.error(result.message);
        
        if (result.device) {
          console.log(`\n${colors.bright}${colors.yellow}📋 DEVICE DETAILS${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
          console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
          console.log(`${emojis.target} Miner Key: ${colors.yellow}${result.device.miner_key}${colors.reset}`);
          console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
        }
      }
      
    } catch (error) {
      this.error(`Failed to ${dryRun ? 'run dry run for' : 'migrate'} single device prefix: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showSingleDeviceTestingOptions();
  }

  // Send email by email address (for existing AEM keys)
  private async sendEmailByEmailAddress(): Promise<void> {
    this.header(`📧 Send Email by Email Address (Existing Keys)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will send emails for existing AEM keys to a specific email address');
    this.warning('This will send REAL emails - no dry run option');
    
    const emailAddress = await this.prompt('Enter the email address to send to');
    
    if (!emailAddress || emailAddress.trim() === '') {
      this.error('Email address cannot be empty');
      await this.sendEmailByEmailAddress();
      return;
    }
    
    // Validate email format (basic check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress.trim())) {
      this.error('Please enter a valid email address');
      await this.sendEmailByEmailAddress();
      return;
    }
    
    const email = emailAddress.trim().toLowerCase();
    
    console.log(`\n${colors.bright}${colors.yellow}📧 EMAIL SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.email} Target Email: ${colors.cyan}${email}${colors.reset}`);
    console.log(`${emojis.key} Will find: AI Edge Miners with AEM prefix`);
    console.log(`${emojis.info} Will include: Parent device information if available`);
    console.log(`${emojis.warning} Will send: REAL email (no dry run)`);
    
    if (!(await this.confirmPrompt('\nProceed with sending email to this address?'))) {
      await this.showSingleDeviceTestingOptions();
      return;
    }
    
    try {
      this.info(`Finding AI Edge Miner devices for ${email}...`);
      
      // Find all AI Edge Miner devices with AEM prefix for this email
      const { DeviceModel } = await import('../db/devices-schema.js');
      
      const aiMinerDevices = await DeviceModel.find({
        name: "$FRY AI Edge Miner",
        miner_key: { $regex: /^AEM-/ },
        email: email,
        email_sent: false
      }).lean();
      
      if (aiMinerDevices.length === 0) {
        this.warning(`No unsent AI Edge Miner devices with AEM prefix found for ${email}`);
        
        // Check if there are any AEM devices for this email (regardless of email_sent status)
        const allAEMDevices = await DeviceModel.find({
          name: "$FRY AI Edge Miner",
          miner_key: { $regex: /^AEM-/ },
          email: email
        }).lean();
        
        if (allAEMDevices.length > 0) {
          this.info(`Found ${allAEMDevices.length} AEM devices for this email, but all have already been sent`);
          const resend = await this.confirmPrompt('Would you like to resend emails for already sent devices?');
          
          if (resend) {
            // Use all devices regardless of email_sent status
            aiMinerDevices.push(...allAEMDevices);
          } else {
            await this.showSingleDeviceTestingOptions();
            return;
          }
        } else {
          this.error(`No AI Edge Miner devices with AEM prefix found for ${email}`);
          await this.showSingleDeviceTestingOptions();
          return;
        }
      }
      
      console.log(`\n${colors.bright}${colors.green}🔍 FOUND DEVICES${colors.reset}`);
      this.separator();
      console.log(`${emojis.key} AI Edge Miners Found: ${colors.bright}${colors.green}${aiMinerDevices.length}${colors.reset}`);
      
      // Show sample devices
      if (aiMinerDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📋 SAMPLE DEVICES (First 5)${colors.reset}`);
        this.separator();
        aiMinerDevices.slice(0, 5).forEach((device, index) => {
          console.log(`${index + 1}. ${colors.cyan}${device.miner_key}${colors.reset} | Order: ${colors.yellow}${device.order}${colors.reset} | Created: ${colors.dim}${new Date(device.created_at).toLocaleDateString()}${colors.reset}`);
        });
        
        if (aiMinerDevices.length > 5) {
          console.log(`${colors.dim}... and ${aiMinerDevices.length - 5} more devices${colors.reset}`);
        }
      }
      
      if (!(await this.confirmPrompt(`\nSend email with ${aiMinerDevices.length} AI Edge Miner keys?`))) {
        await this.showSingleDeviceTestingOptions();
        return;
      }
      
      this.info('Preparing email with parent device information...');
      
      // Prepare keys with parent device information
      const { sendMail } = await import('../MailProcessor.js');
      const ELIGIBLE_NODE_TYPES = ["$FRY Reward Decentralization Node", "$FRY Contributor Node", "$FRY Storage Decentralization Node", "$FRY Storage Validator Node"];
      
      const keys = await Promise.all(aiMinerDevices.map(async (device) => {
        // Check if parent device info is already stored
        if (device.parent_device_id && device.parent_device_name && device.parent_device_miner_key) {
          return {
            key: device.miner_key,
            name: "$FRY AI Edge Miner",
            parentDeviceName: device.parent_device_name,
            parentDeviceKey: device.parent_device_miner_key
          };
        } else {
          // Find parent device using email/order matching
          this.info(`Finding parent device for AI Edge Miner ${device._id} (order: ${device.order})`);
          
          const parentDevices = await DeviceModel.find({
            email: device.email,
            order: device.order,
            ai_miner_generated: true,
            name: { $in: ELIGIBLE_NODE_TYPES }
          }).lean();

          if (parentDevices.length > 0) {
            // Use the first parent device (creation order)
            const parentDevice = parentDevices.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())[0];
            this.success(`Found parent device: ${parentDevice._id} (${parentDevice.name})`);
            
            return {
              key: device.miner_key,
              name: "$FRY AI Edge Miner",
              parentDeviceName: parentDevice.name,
              parentDeviceKey: parentDevice.miner_key
            };
          } else {
            this.warning(`No parent device found for AI Edge Miner ${device._id}`);
            return {
              key: device.miner_key,
              name: "$FRY AI Edge Miner"
            };
          }
        }
      }));
      
      // Send the email
      this.info(`Sending email to ${email} with ${keys.length} AI Edge Miner keys...`);
      await sendMail(email, keys);
      
      // Update email_sent status for all devices
      const deviceIds = aiMinerDevices.map(d => d._id);
      const updateResult = await DeviceModel.updateMany(
        { _id: { $in: deviceIds } },
        { 
          $set: { 
            email_sent: true,
            email_sent_at: new Date()
          }
        }
      );
      
      console.log(`\n${colors.bright}${colors.green}📧 EMAIL SENT SUCCESSFULLY${colors.reset}`);
      this.separator();
      console.log(`${emojis.email} Recipient: ${colors.cyan}${email}${colors.reset}`);
      console.log(`${emojis.key} AI Edge Miner Keys: ${colors.bright}${colors.green}${keys.length}${colors.reset}`);
      console.log(`${emojis.info} Parent Device Info: ${colors.bright}${keys.filter(k => k.parentDeviceName).length > 0 ? colors.green + 'Included' : colors.yellow + 'Partial/None'}${colors.reset}`);
      console.log(`${emojis.success} Database Updated: ${colors.bright}${colors.green}${updateResult.modifiedCount}${colors.reset} devices marked as email_sent`);
      
      // Show sample keys that were sent
      if (keys.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📋 KEYS SENT (First 3)${colors.reset}`);
        this.separator();
        keys.slice(0, 3).forEach((keyData, index) => {
          if (keyData.parentDeviceName) {
            console.log(`${index + 1}. ${colors.cyan}${keyData.key}${colors.reset} ← ${colors.magenta}${keyData.parentDeviceName}${colors.reset} (${colors.yellow}${keyData.parentDeviceKey}${colors.reset})`);
          } else {
            console.log(`${index + 1}. ${colors.cyan}${keyData.key}${colors.reset} (${colors.dim}no parent device info${colors.reset})`);
          }
        });
        
        if (keys.length > 3) {
          console.log(`${colors.dim}... and ${keys.length - 3} more keys${colors.reset}`);
        }
      }
      
      this.success('Email sent successfully with existing AEM keys!');
      
    } catch (error) {
      this.error(`Failed to send email: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showSingleDeviceTestingOptions();
  }

  // Generate and send AI miner key to single device
  private async generateAndSendAIMinerKeyToSingleDevice(dryRun: boolean = false): Promise<void> {
    this.header(`${dryRun ? emojis.test + ' Dry Run - ' : emojis.fire + ' '}Generate and Send AI Miner Key`);
    
    if (!(await this.ensureConnection())) return;
    
    if (dryRun) {
      this.warning('DRY RUN MODE - Will generate a REAL key but skip sending email');
    } else {
      this.warning('This will generate a REAL AI miner key and send a REAL email');
    }
    
    const minerKey = await this.prompt('Enter the miner_key of the device');
    
    if (!minerKey || minerKey.trim() === '') {
      this.error('Miner key cannot be empty');
      await this.generateAndSendAIMinerKeyToSingleDevice(dryRun);
      return;
    }

    // Get options
    const forceGenerate = await this.confirmPrompt('Force generate (bypass eligibility checks)?');
    const addFieldIfMissing = await this.confirmPrompt('Add ai_miner_generated field if missing?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔑 OPERATION SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.key} Miner Key: ${colors.cyan}${minerKey.substring(0, 8)}...${colors.reset}`);
    console.log(`${emojis.test} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    console.log(`${emojis.fire} Force Generate: ${colors.bright}${forceGenerate ? colors.yellow + 'Yes' : colors.green + 'No'}${colors.reset}`);
    console.log(`${emojis.gear} Add Field If Missing: ${colors.bright}${addFieldIfMissing ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showSingleDeviceTestingOptions();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Running dry run for' : 'Generating and sending AI miner key to'} device...`);
      const result = await generateAndSendAIMinerKeyByMinerKey(minerKey, {
        dryRun,
        forceGenerate,
        addFieldIfMissing
      });
      
      console.log(`\n${colors.bright}${colors.green}🔑 OPERATION RESULT${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success(result.message);
        
        if (result.keyGenerated) {
          console.log(`${emojis.key} Generated Key: ${colors.bright}${colors.cyan}${result.keyGenerated}${colors.reset}`);
        }
        
        if (result.emailSent !== undefined) {
          console.log(`${emojis.email} Email Sent: ${colors.bright}${result.emailSent ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
        }
        
          if (result.device) {
            console.log(`\n${colors.bright}${colors.blue}📋 ORIGINAL DEVICE DETAILS${colors.reset}`);
            this.separator();
            console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
            console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
            console.log(`${emojis.target} Order: ${colors.yellow}${result.device.order}${colors.reset}`);
            console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
            console.log(`${emojis.success} AI Miner Generated: ${colors.bright}${result.device.ai_miner_generated ? colors.green + 'true' : colors.red + 'false'}${colors.reset}`);
            
            if (result.device.is_registered !== undefined) {
              console.log(`${emojis.shield} Is Registered: ${colors.bright}${result.device.is_registered ? colors.green + 'true' : colors.red + 'false'}${colors.reset}`);
            }
            if (result.device.registration_amount !== undefined) {
              console.log(`${emojis.target} Registration Amount: ${colors.bright}${colors.cyan}${result.device.registration_amount}${colors.reset}`);
            }
            if (result.device.node_amount !== undefined) {
              console.log(`${emojis.gear} Node Amount: ${colors.bright}${colors.cyan}${result.device.node_amount}${colors.reset}`);
            }
          }

          // NEW: Display AI Miner Device Details
          if (result.aiMinerDevice) {
            console.log(`\n${colors.bright}${colors.green}🤖 NEW AI MINER DEVICE DETAILS${colors.reset}`);
            this.separator();
            console.log(`${emojis.gear} AI Miner Device ID: ${colors.cyan}${result.aiMinerDevice._id}${colors.reset}`);
            console.log(`${emojis.key} AI Miner Key: ${colors.bright}${colors.green}${result.aiMinerDevice.miner_key}${colors.reset}`);
            console.log(`${emojis.robot} Name: ${colors.magenta}${result.aiMinerDevice.name}${colors.reset}`);
            console.log(`${emojis.target} Order: ${colors.yellow}${result.aiMinerDevice.order}${colors.reset}`);
            console.log(`${emojis.email} Email: ${colors.green}${result.aiMinerDevice.email}${colors.reset}`);
            console.log(`${emojis.shield} Is Registered: ${colors.bright}${result.aiMinerDevice.is_registered ? colors.green + 'true' : colors.red + 'false'}${colors.reset}`);
            console.log(`${emojis.gear} Enabled: ${colors.bright}${result.aiMinerDevice.enabled ? colors.green + 'true' : colors.red + 'false'}${colors.reset}`);
            console.log(`${emojis.clock} Created At: ${colors.bright}${colors.cyan}${new Date(result.aiMinerDevice.created_at).toISOString()}${colors.reset}`);
          }

          // Display transaction ID if available
          if (result.transactionId) {
            console.log(`\n${colors.bright}${colors.blue}🔗 TRANSACTION INFO${colors.reset}`);
            this.separator();
            console.log(`${emojis.gear} Transaction ID: ${colors.cyan}${result.transactionId}${colors.reset}`);
          }
      } else {
        this.error(result.message);
        
        if (result.device) {
          console.log(`\n${colors.bright}${colors.yellow}📋 DEVICE DETAILS${colors.reset}`);
          this.separator();
          console.log(`${emojis.gear} Device ID: ${colors.cyan}${result.device._id}${colors.reset}`);
          console.log(`${emojis.key} Name: ${colors.magenta}${result.device.name}${colors.reset}`);
          console.log(`${emojis.target} Order: ${colors.yellow}${result.device.order}${colors.reset}`);
          console.log(`${emojis.email} Email: ${colors.green}${result.device.email}${colors.reset}`);
          console.log(`${emojis.warning} AI Miner Generated: ${colors.bright}${colors.yellow}${result.device.ai_miner_generated}${colors.reset}`);
          
          if (result.device.is_registered !== undefined) {
            console.log(`${emojis.shield} Is Registered: ${colors.bright}${result.device.is_registered ? colors.green + 'true' : colors.red + 'false'}${colors.reset}`);
          }
          if (result.device.registration_amount !== undefined) {
            console.log(`${emojis.target} Registration Amount: ${colors.bright}${colors.cyan}${result.device.registration_amount}${colors.reset}`);
          }
          if (result.device.node_amount !== undefined) {
            console.log(`${emojis.gear} Node Amount: ${colors.bright}${colors.cyan}${result.device.node_amount}${colors.reset}`);
          }
        }
      }
      
    } catch (error) {
      this.error(`Failed to ${dryRun ? 'run dry run for' : 'generate and send AI miner key to'} device: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showSingleDeviceTestingOptions();
  }

  // Run database migration
  private async runDatabaseMigration(): Promise<void> {
    this.header(`🔄 Database Migration - Initialize AI Miner Field`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will add the ai_miner_generated field to all devices in the database');
    this.info('This is a one-time migration for the new AI Miner system');
    
    if (!(await this.confirmPrompt('Continue with database migration?'))) {
      await this.showAdvancedConfig();
      return;
    }
    
    try {
      this.info('Starting database migration...');
      await migrateDeviceFields();
      
      console.log(`\n${colors.bright}${colors.green}🔄 MIGRATION COMPLETED${colors.reset}`);
      this.separator();
      this.success('AI Miner field successfully initialized for all devices');
      this.info('All devices now have ai_miner_generated field set to false by default');
      
    } catch (error) {
      this.error(`Migration failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Run prefix migration
  private async runPrefixMigration(): Promise<void> {
    this.header(`🔄 Migrate AI Edge Miner Prefix (ANM → AEM)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will update AI Edge Miner keys from ANM prefix to AEM prefix');
    this.warning('This will also remove the "enabled" field from AI Edge Miner devices');
    this.info('This migration fixes the naming change from AI Miner to AI Edge Miner');
    
    if (!(await this.confirmPrompt('Continue with prefix migration?'))) {
      await this.showAdvancedConfig();
      return;
    }
    
    // Get batch size
    const batchSizeInput = await this.prompt('Enter batch size (default: 100, max: 500)');
    let batchSize = parseInt(batchSizeInput) || 100;
    if (batchSize > 500) batchSize = 500;
    if (batchSize < 1) batchSize = 100;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔄 MIGRATION SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.batch} Batch Size: ${colors.bright}${colors.cyan}${batchSize}${colors.reset}`);
    console.log(`${emojis.test} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    console.log(`${emojis.warning} Will update: ANM-* → AEM-*`);
    console.log(`${emojis.gear} Will remove: enabled field`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showAdvancedConfig();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Starting dry run...' : 'Starting prefix migration...'}`);
      
      let currentProgress = 0;
      let totalDevices = 0;
      
      const result = await migrateAIEdgeMinerPrefix({
        dryRun,
        batchSize,
        progressCallback: (progress) => {
          if (totalDevices === 0) totalDevices = progress.total;
          currentProgress = progress.processed;
          this.showProgress(progress.processed, progress.total, `Migrating ${progress.currentDevice.substring(0, 30)}...`);
        }
      });
      
      console.log(`\n\n${colors.bright}${colors.green}🔄 MIGRATION RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.stats} Total Found: ${colors.bright}${colors.blue}${result.totalFound}${colors.reset} AI Edge Miner devices with ANM prefix`);
      console.log(`${emojis.success} Successfully migrated: ${colors.bright}${colors.green}${result.successCount}${colors.reset} devices`);
      console.log(`${emojis.error} Failed: ${colors.bright}${colors.red}${result.failCount}${colors.reset} devices`);
      console.log(`${emojis.key} Parent devices found: ${colors.bright}${colors.cyan}${result.parentDevicesFound}${colors.reset} devices`);
      console.log(`${emojis.warning} Parent devices not found: ${colors.bright}${colors.yellow}${result.parentDevicesNotFound}${colors.reset} devices`);
      console.log(`${emojis.info} ${dryRun ? 'Dry run completed - no actual changes made' : 'Migration completed successfully'}`);
      
      if (result.failedDevices.length > 0) {
        console.log(`\n${colors.bright}${colors.red}❌ FAILED DEVICES${colors.reset}`);
        this.separator();
        result.failedDevices.slice(0, 10).forEach((deviceId, index) => {
          console.log(`${index + 1}. ${colors.red}${deviceId}${colors.reset}`);
        });
        if (result.failedDevices.length > 10) {
          console.log(`${colors.dim}... and ${result.failedDevices.length - 10} more${colors.reset}`);
        }
      }
      
      if (result.success) {
        this.success('Prefix migration completed successfully!');
        if (!dryRun) {
          this.info('All AI Edge Miner keys now use the AEM prefix');
          this.info('All "enabled" fields have been removed from AI Edge Miner devices');
        }
      } else {
        this.warning('Migration completed with some failures - check the failed devices list above');
      }
      
    } catch (error) {
      this.error(`Prefix migration failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Custom dry run
  private async runCustomDryRun(): Promise<void> {
    this.header(`${emojis.magnifying} Custom Dry Run`);
    
    if (!(await this.ensureConnection())) return;
    
    const batchSizeInput = await this.prompt('Enter batch size for dry run (default: 50)');
    const batchSize = parseInt(batchSizeInput) || 50;
    
    try {
      this.info('Running custom dry run (no keys generated, no emails sent)...');
      const result = await generateAIMinerKeysBatch({
        batchSize,
        dryRun: true
      });
      
      console.log(`\n${colors.bright}${colors.green}🔍 DRY RUN RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.stats} Total eligible devices: ${colors.bright}${colors.green}${result.eligibleDevicesCount}${colors.reset}`);
      console.log(`${emojis.email} Unique emails: ${colors.bright}${colors.cyan}${result.uniqueEmailsCount}${colors.reset}`);
      console.log(`${emojis.batch} Configured batch size: ${colors.bright}${colors.magenta}${batchSize}${colors.reset}`);
      console.log(`${emojis.target} Estimated batches: ${colors.bright}${colors.yellow}${Math.ceil(result.eligibleDevicesCount / batchSize)}${colors.reset}`);
      console.log(`${emojis.info} No keys generated, no emails sent (dry run)`);
      
      this.success('Custom dry run completed!');
      
    } catch (error) {
      this.error(`Custom dry run failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Test database connection
  private async testDatabaseConnection(): Promise<void> {
    this.header(`${emojis.shield} Database Connection Test`);
    
    this.info('Testing database connection...');
    
    try {
      await connectToDatabase();
      this.success('Database connection successful!');
      this.isConnected = true;
    } catch (error) {
      this.error(`Database connection failed: ${error}`);
      this.isConnected = false;
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Show system information
  private async showSystemInfo(): Promise<void> {
    this.header(`${emojis.info} System Information`);
    
    console.log(`${colors.bright}${colors.blue}🔧 SYSTEM DETAILS${colors.reset}`);
    this.separator();
    console.log(`${emojis.gear} Node.js Version: ${colors.bright}${colors.green}${process.version}${colors.reset}`);
    console.log(`${emojis.target} Platform: ${colors.bright}${colors.cyan}${process.platform}${colors.reset}`);
    console.log(`${emojis.info} Architecture: ${colors.bright}${colors.magenta}${process.arch}${colors.reset}`);
    console.log(`${emojis.clock} Uptime: ${colors.bright}${colors.yellow}${Math.floor(process.uptime())}s${colors.reset}`);
    console.log(`${emojis.shield} Database Connected: ${this.isConnected ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Verify Migration Results
  private async verifyMigrationResults(): Promise<void> {
    this.header(`${emojis.magnifying} Verify Migration Results`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will verify the 1:1 parent-child assignment results from the migration');
    this.info('It checks for duplicate parent assignments and orphaned AI Edge Miners');
    this.success('This is a read-only operation that does not modify any data');
    
    if (!(await this.confirmPrompt('Continue with migration verification?'))) {
      await this.showAdvancedConfig();
      return;
    }
    
    try {
      this.info('Running migration verification...');
      const result = await verifyMigrationResults();
      
      console.log(`\n${colors.bright}${colors.green}🔍 VERIFICATION RESULTS${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success('🎉 VERIFICATION PASSED! All AI Edge Miners have unique parent assignments.');
        
        console.log(`\n${colors.bright}${colors.blue}📊 VERIFICATION SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        if (result.details.emailOrderGroups && result.details.emailOrderGroups.length > 0) {
          console.log(`\n${colors.bright}${colors.cyan}📧 EMAIL/ORDER GROUPS ANALYSIS${colors.reset}`);
          this.separator();
          result.details.emailOrderGroups.slice(0, 10).forEach((group: any, index: number) => {
            const status = group.aiMinersCount === group.uniqueParentsCount ? 
              `${colors.green}✅ Perfect 1:1` : 
              `${colors.yellow}⚠️ Mismatch`;
            console.log(`${index + 1}. ${colors.cyan}${group.email.substring(0, 25)}...${colors.reset} | Order: ${colors.yellow}${group.order}${colors.reset} | AI Miners: ${colors.bright}${colors.green}${group.aiMinersCount}${colors.reset} | Parents: ${colors.bright}${colors.cyan}${group.uniqueParentsCount}${colors.reset} | ${status}${colors.reset}`);
          });
          
          if (result.details.emailOrderGroups.length > 10) {
            console.log(`${colors.dim}... and ${result.details.emailOrderGroups.length - 10} more groups${colors.reset}`);
          }
        }
        
        if (result.details.parentChildMappings && result.details.parentChildMappings.length > 0) {
          console.log(`\n${colors.bright}${colors.magenta}🔗 SAMPLE PARENT-CHILD MAPPINGS (First 5)${colors.reset}`);
          this.separator();
          result.details.parentChildMappings.slice(0, 5).forEach((mapping: any, index: number) => {
            console.log(`${index + 1}. Child: ${colors.cyan}${mapping.aiMinerKey}${colors.reset} → Parent: ${colors.magenta}${mapping.parentName}${colors.reset} (${colors.yellow}${mapping.parentKey}${colors.reset})`);
          });
          
          if (result.details.parentChildMappings.length > 5) {
            console.log(`${colors.dim}... and ${result.details.parentChildMappings.length - 5} more mappings${colors.reset}`);
          }
        }
        
        this.info('✅ Each AI Edge Miner has a unique parent device');
        this.info('✅ No duplicate parent assignments detected');
        this.info('✅ All parent-child relationships are properly established');
        
      } else {
        this.error('❌ VERIFICATION FAILED! Issues found with parent assignments.');
        
        console.log(`\n${colors.bright}${colors.red}📋 FAILURE SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        if (result.details.duplicateParents && result.details.duplicateParents.length > 0) {
          console.log(`\n${colors.bright}${colors.red}❌ DUPLICATE PARENT ASSIGNMENTS${colors.reset}`);
          this.separator();
          result.details.duplicateParents.forEach((parentId: string, index: number) => {
            console.log(`${index + 1}. Parent ID: ${colors.red}${parentId}${colors.reset} is assigned to multiple AI Edge Miners`);
          });
        }
        
        if (result.details.orphanedAIEdgeMiners && result.details.orphanedAIEdgeMiners.length > 0) {
          console.log(`\n${colors.bright}${colors.yellow}⚠️ ORPHANED AI EDGE MINERS${colors.reset}`);
          this.separator();
          result.details.orphanedAIEdgeMiners.forEach((orphan: any, index: number) => {
            console.log(`${index + 1}. ${colors.yellow}${orphan.key}${colors.reset} (${colors.cyan}${orphan.email}${colors.reset}, order: ${colors.magenta}${orphan.order}${colors.reset})`);
          });
        }
        
        this.warning('Please review the issues above and consider running the migration again or using the reset functionality');
      }
      
    } catch (error) {
      this.error(`Migration verification failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showAdvancedConfig();
  }

  // Run Parent-Child Assignment Tests
  private async runParentChildAssignmentTests(): Promise<void> {
    this.header(`${emojis.test} Test Parent-Child Assignment Logic`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This will test the 1:1 parent-child assignment logic for AI Edge Miners');
    this.warning('This test creates temporary test data and cleans up after itself');
    this.info('The test validates that each parent device gets only one AI Edge Miner child');
    
    const options = [
      `${emojis.test} Run Full Parent-Child Assignment Test`,
      `${emojis.gear} Test Reset Functionality Only`,
      `${emojis.info} Reset Parent Assignment Tracking (Production)`,
      `${emojis.target} Back to Advanced Config`
    ];

    const choice = await this.selectFromMenu(options, `${emojis.test} Parent-Child Assignment Tests`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.runFullParentChildTest();
        break;
      case 2:
        await this.runResetFunctionalityTest();
        break;
      case 3:
        await this.resetProductionParentAssignments();
        break;
      case 4:
        await this.showAdvancedConfig();
        break;
    }
  }

  // Run Full Parent-Child Assignment Test
  private async runFullParentChildTest(): Promise<void> {
    this.header(`${emojis.test} Full Parent-Child Assignment Test`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This test will create temporary test data and run the migration logic');
    this.info('The test simulates your scenario: multiple AI Edge Miners under same email/order');
    this.success('All test data will be cleaned up automatically');
    
    if (!(await this.confirmPrompt('Continue with full parent-child assignment test?'))) {
      await this.runParentChildAssignmentTests();
      return;
    }
    
    try {
      this.info('Running comprehensive parent-child assignment test...');
      const result = await testParentChildAssignment();
      
      console.log(`\n${colors.bright}${colors.green}🧪 TEST RESULTS${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success('🎉 ALL TESTS PASSED! The 1:1 parent-child assignment is working correctly.');
        
        console.log(`\n${colors.bright}${colors.blue}📋 TEST SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        if (result.testResults && result.testResults.length > 0) {
          console.log(`\n${colors.bright}${colors.cyan}🔍 DETAILED RESULTS${colors.reset}`);
          this.separator();
          result.testResults.forEach((testResult, index) => {
            console.log(`${colors.bright}${colors.yellow}Step ${index + 1}: ${testResult.step}${colors.reset}`);
            if (testResult.step === 'Validation' && testResult.result.childParentMappings) {
              console.log(`${colors.dim}Parent-Child Mappings:${colors.reset}`);
              testResult.result.childParentMappings.forEach((mapping: any, i: number) => {
                console.log(`  ${i + 1}. Child: ${colors.cyan}${mapping.childKey}${colors.reset} → Parent: ${colors.magenta}${mapping.parentName}${colors.reset} (${colors.yellow}${mapping.parentKey}${colors.reset})`);
              });
            }
          });
        }
        
        this.info('✅ Each parent device was assigned to exactly one AI Edge Miner');
        this.info('✅ No duplicate parent assignments detected');
        this.info('✅ All AI Edge Miners have unique parent devices');
        
      } else {
        this.error('❌ SOME TESTS FAILED! There may be issues with the parent-child assignment logic.');
        
        console.log(`\n${colors.bright}${colors.red}📋 FAILURE SUMMARY${colors.reset}`);
        this.separator();
        console.log(result.summary);
        
        this.warning('Please review the test results and fix any issues before running the migration on production data');
      }
      
    } catch (error) {
      this.error(`Parent-child assignment test failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.runParentChildAssignmentTests();
  }

  // Run Reset Functionality Test
  private async runResetFunctionalityTest(): Promise<void> {
    this.header(`${emojis.gear} Test Reset Functionality`);
    
    if (!(await this.ensureConnection())) return;
    
    this.info('This test validates the reset functionality for parent assignment tracking');
    this.warning('This test creates temporary test data and cleans up after itself');
    
    if (!(await this.confirmPrompt('Continue with reset functionality test?'))) {
      await this.runParentChildAssignmentTests();
      return;
    }
    
    try {
      this.info('Running reset functionality test...');
      const result = await testResetFunctionality();
      
      console.log(`\n${colors.bright}${colors.green}🔧 RESET TEST RESULTS${colors.reset}`);
      this.separator();
      
      if (result.success) {
        this.success('✅ Reset functionality test PASSED');
        console.log(`${emojis.info} ${result.message}`);
        this.info('✅ Parent assignment tracking fields are properly reset');
        this.info('✅ AI Edge Miner parent references are properly cleared');
      } else {
        this.error('❌ Reset functionality test FAILED');
        console.log(`${emojis.error} ${result.message}`);
        this.warning('There may be issues with the reset functionality');
      }
      
    } catch (error) {
      this.error(`Reset functionality test failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.runParentChildAssignmentTests();
  }

  // Reset Production Parent Assignments
  private async resetProductionParentAssignments(): Promise<void> {
    this.header(`${emojis.info} Reset Parent Assignment Tracking (Production)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will reset parent assignment tracking fields in your PRODUCTION database');
    this.warning('This is useful for re-running the migration or fixing assignment issues');
    this.info('This will clear ai_edge_miner_assigned and assigned_ai_edge_miner_id fields');
    this.info('This will also clear parent_device_* fields from AI Edge Miners');
    
    if (!(await this.confirmPrompt('Are you sure you want to reset production parent assignments?'))) {
      await this.runParentChildAssignmentTests();
      return;
    }
    
    // Get filter options
    const emailFilterInput = await this.prompt('Filter by specific emails? (comma-separated, or press Enter for all)');
    const emails = emailFilterInput.trim() ? emailFilterInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : undefined;
    
    const orderFilterInput = await this.prompt('Filter by specific orders? (comma-separated, or press Enter for all)');
    const orders = orderFilterInput.trim() ? orderFilterInput.split(',').map(o => o.trim()).filter(o => o.length > 0) : undefined;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}🔄 RESET SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.email} Email Filter: ${colors.bright}${emails ? colors.green + `${emails.length} emails` : colors.red + 'All emails'}${colors.reset}`);
    console.log(`${emojis.target} Order Filter: ${colors.bright}${orders ? colors.green + `${orders.length} orders` : colors.red + 'All orders'}${colors.reset}`);
    console.log(`${emojis.test} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.runParentChildAssignmentTests();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Running dry run for' : 'Resetting'} parent assignment tracking...`);
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
        console.log(`${emojis.robot} Reset AI Edge Miners: ${colors.bright}${colors.green}${result.resetAIEdgeMinerCount}${colors.reset}`);
        
        if (dryRun) {
          this.info('This was a dry run - no actual changes were made');
          this.info('Run without dry run mode to perform the actual reset');
        } else {
          this.success('Parent assignment tracking reset completed successfully!');
          this.info('You can now re-run the migration to reassign parent devices');
        }
      } else {
        this.error('Reset failed - check the error details above');
      }
      
    } catch (error) {
      this.error(`Reset parent assignment tracking failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.runParentChildAssignmentTests();
  }

  // Email Distribution Management Menu
  private async showEmailDistributionMenu(): Promise<void> {
    this.header(`📧 Email Distribution Management`);
    
    const options = [
      `📊 View Email Queue Status`,
      `🔍 Preview Email Queue (Dry Run)`,
      `⚡ Send Emails in Batches`,
      `📋 Email Sending History`,
      `🛠️ Email Queue Management (Reset)`,
      `${emojis.target} Back to Main Menu`
    ];

    const choice = await this.selectFromMenu(options, `📧 Email Distribution Options`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.viewEmailQueueStatus();
        break;
      case 2:
        await this.previewEmailQueue();
        break;
      case 3:
        await this.sendEmailsInBatches();
        break;
      case 4:
        await this.viewEmailSendingHistory();
        break;
      case 5:
        await this.manageEmailQueue();
        break;
      case 6:
        await this.showMainMenu();
        break;
    }
  }

  // View Email Queue Status
  private async viewEmailQueueStatus(): Promise<void> {
    this.header(`📊 Email Queue Status`);
    
    if (!(await this.ensureConnection())) return;
    
    try {
      this.info('Gathering email queue statistics...');
      const stats = await getEmailQueueStats();
      
      console.log(`\n${colors.bright}${colors.green}📊 EMAIL QUEUE STATUS${colors.reset}`);
      this.separator();
      console.log(`${emojis.email} Total Pending Emails: ${colors.bright}${colors.red}${stats.totalPendingEmails}${colors.reset}`);
      console.log(`${emojis.target} Unique Recipients: ${colors.bright}${colors.cyan}${stats.uniqueRecipients}${colors.reset}`);
      
      if (stats.oldestPendingDevice) {
        console.log(`${emojis.clock} Oldest Pending: ${colors.bright}${colors.yellow}${new Date(stats.oldestPendingDevice).toLocaleString()}${colors.reset}`);
      }
      if (stats.newestPendingDevice) {
        console.log(`${emojis.clock} Newest Pending: ${colors.bright}${colors.yellow}${new Date(stats.newestPendingDevice).toLocaleString()}${colors.reset}`);
      }
      
      if (stats.uniqueRecipients > 0) {
        console.log(`\n${colors.bright}${colors.blue}📧 TOP RECIPIENTS (First 10)${colors.reset}`);
        this.separator();
        const sortedRecipients = Object.entries(stats.emailsByRecipient)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10);
        
        sortedRecipients.forEach(([email, count], index) => {
          console.log(`${index + 1}. ${colors.cyan}${email.substring(0, 20)}...${colors.reset} (${colors.bright}${colors.green}${count}${colors.reset} keys)`);
        });
      }
      
      this.success('Email queue status retrieved successfully!');
      
    } catch (error) {
      this.error(`Failed to get email queue status: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showEmailDistributionMenu();
  }

  // Preview Email Queue
  private async previewEmailQueue(): Promise<void> {
    this.header(`🔍 Preview Email Queue (Dry Run)`);
    
    if (!(await this.ensureConnection())) return;
    
    const limitInput = await this.prompt('Enter preview limit (default: 10, 0 for all)');
    const limit = parseInt(limitInput) || 10;
    
    try {
      this.info('Previewing email queue...');
      const preview = await previewEmailQueue({ limit: limit > 0 ? limit : undefined });
      
      console.log(`\n${colors.bright}${colors.green}🔍 EMAIL QUEUE PREVIEW${colors.reset}`);
      this.separator();
      console.log(`${emojis.email} Total Recipients: ${colors.bright}${colors.cyan}${preview.totalRecipients}${colors.reset}`);
      console.log(`${emojis.key} Total Devices: ${colors.bright}${colors.green}${preview.totalDevices}${colors.reset}`);
      console.log(`${emojis.info} Preview Limit: ${colors.bright}${colors.yellow}${limit > 0 ? limit : 'All'}${colors.reset}`);
      
      if (preview.emailsToSend.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📧 EMAILS TO SEND${colors.reset}`);
        this.separator();
        preview.emailsToSend.forEach((emailItem, index) => {
          console.log(`${index + 1}. ${colors.cyan}${emailItem.email.substring(0, 30)}...${colors.reset} (${colors.bright}${colors.green}${emailItem.deviceCount}${colors.reset} keys)`);
          
          // Show parent device information for first few devices
          if (emailItem.devices.length > 0) {
            const devicesWithParents = (emailItem.devices as DeviceWithParentInfo[]).filter(d => d.parentDeviceName);
            const devicesWithoutParents = emailItem.devices.length - devicesWithParents.length;
            
            if (devicesWithParents.length > 0) {
              console.log(`   ${colors.dim}└─ ${colors.green}${devicesWithParents.length}${colors.dim} with parent device info${colors.reset}`);
              // Show first parent device as example
              const firstParent = devicesWithParents[0];
              if (firstParent.parentDeviceName) {
                console.log(`   ${colors.dim}   └─ e.g., ${colors.magenta}${firstParent.parentDeviceName}${colors.reset} ${colors.dim}(${firstParent.parentDeviceKey?.substring(0, 8)}...)${colors.reset}`);
              }
            }
            if (devicesWithoutParents > 0) {
              console.log(`   ${colors.dim}└─ ${colors.yellow}${devicesWithoutParents}${colors.dim} without parent device info${colors.reset}`);
            }
          }
        });
        
        if (preview.totalRecipients > preview.emailsToSend.length) {
          console.log(`${colors.dim}... and ${preview.totalRecipients - preview.emailsToSend.length} more recipients${colors.reset}`);
        }
      } else {
        this.info('No emails found in queue');
      }
      
      this.success('Email queue preview completed!');
      
    } catch (error) {
      this.error(`Failed to preview email queue: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showEmailDistributionMenu();
  }

  // Send Emails in Batches
  private async sendEmailsInBatches(): Promise<void> {
    this.header(`⚡ Send Emails in Batches`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will send REAL emails to users with pending AI miner keys');
    
    if (!(await this.confirmPrompt('Continue with batch email sending?'))) {
      await this.showEmailDistributionMenu();
      return;
    }
    
    // Get batch configuration
    const batchSizeInput = await this.prompt('Enter batch size (default: 20, max: 100)');
    let batchSize = parseInt(batchSizeInput) || 20;
    if (batchSize > 100) batchSize = 100;
    if (batchSize < 1) batchSize = 20;
    
    const delayInput = await this.prompt('Enter delay between batches in seconds (default: 15)');
    let delayBetweenBatches = (parseInt(delayInput) || 15) * 1000;
    
    // Optional email filter
    const emailFilterInput = await this.prompt('Filter by specific emails? (comma-separated, or press Enter for all)');
    const emails = emailFilterInput.trim() ? emailFilterInput.split(',').map(e => e.trim()).filter(e => e.length > 0) : undefined;
    
    // Dry run option
    const dryRun = await this.confirmPrompt('Run in dry run mode first?');
    
    console.log(`\n${colors.bright}${colors.yellow}⚡ BATCH EMAIL SETTINGS${colors.reset}`);
    this.separator();
    console.log(`${emojis.batch} Batch Size: ${colors.bright}${colors.cyan}${batchSize}${colors.reset}`);
    console.log(`${emojis.clock} Delay Between Batches: ${colors.bright}${colors.yellow}${delayBetweenBatches/1000}s${colors.reset}`);
    console.log(`${emojis.email} Email Filter: ${colors.bright}${emails ? colors.green + `${emails.length} emails` : colors.red + 'All emails'}${colors.reset}`);
    console.log(`${emojis.test} Dry Run: ${colors.bright}${dryRun ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    
    if (!(await this.confirmPrompt('\nProceed with these settings?'))) {
      await this.showEmailDistributionMenu();
      return;
    }
    
    try {
      this.info(`${dryRun ? 'Starting dry run...' : 'Starting batch email sending...'}`);
      
      // Manual retry callback
      const retryCallback = async (email: string, error: any): Promise<'retry' | 'skip' | 'abort'> => {
        console.log(`\n${colors.bright}${colors.red}❌ EMAIL FAILED${colors.reset}`);
        this.separator();
        console.log(`${emojis.email} Email: ${colors.cyan}${email}${colors.reset}`);
        console.log(`${emojis.error} Error: ${colors.red}${error.message || error}${colors.reset}`);
        
        const retryOptions = ['Retry this email', 'Skip this email', 'Abort batch processing'];
        const retryChoice = await this.selectFromMenu(retryOptions, 'What would you like to do?');
        
        switch (retryChoice) {
          case 1: return 'retry';
          case 2: return 'skip';
          case 3: return 'abort';
          default: return 'abort';
        }
      };
      
      const result = await sendPendingEmailsBatch({
        batchSize,
        delayBetweenBatches,
        emails,
        dryRun,
        progressCallback: (progress) => {
          this.showProgress(progress.processed, progress.total, `Batch ${progress.currentBatch}/${progress.totalBatches}`);
        },
        retryCallback: dryRun ? undefined : retryCallback
      });
      
      console.log(`\n\n${colors.bright}${colors.green}⚡ BATCH EMAIL RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Successfully sent: ${colors.bright}${colors.green}${result.successCount}${colors.reset} emails`);
      console.log(`${emojis.error} Failed: ${colors.bright}${colors.red}${result.failCount}${colors.reset} emails`);
      console.log(`${emojis.warning} Skipped: ${colors.bright}${colors.yellow}${result.skippedEmails.length}${colors.reset} emails`);
      console.log(`${emojis.email} Processed Recipients: ${colors.bright}${colors.cyan}${result.processedEmails.length}${colors.reset}`);
      
      if (result.aborted) {
        this.warning('Batch processing was aborted by user');
      }
      
      if (result.failedEmails.length > 0) {
        console.log(`\n${colors.bright}${colors.red}❌ FAILED EMAILS${colors.reset}`);
        this.separator();
        result.failedEmails.slice(0, 10).forEach((email, index) => {
          console.log(`${index + 1}. ${colors.red}${email}${colors.reset}`);
        });
        if (result.failedEmails.length > 10) {
          console.log(`${colors.dim}... and ${result.failedEmails.length - 10} more${colors.reset}`);
        }
      }
      
      this.success('Batch email sending completed!');
      
    } catch (error) {
      this.error(`Batch email sending failed: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showEmailDistributionMenu();
  }

  // View Email Sending History
  private async viewEmailSendingHistory(): Promise<void> {
    this.header(`📋 Email Sending History`);
    
    if (!(await this.ensureConnection())) return;
    
    const daysInput = await this.prompt('Enter number of days to look back (default: 30)');
    const days = parseInt(daysInput) || 30;
    
    const limitInput = await this.prompt('Enter result limit (default: 50)');
    const limit = parseInt(limitInput) || 50;
    
    try {
      this.info('Gathering email sending history...');
      const history = await getEmailSendingHistory({ limit, days });
      
      console.log(`\n${colors.bright}${colors.green}📋 EMAIL SENDING HISTORY${colors.reset}`);
      this.separator();
      console.log(`${emojis.email} Total Sent Recipients: ${colors.bright}${colors.cyan}${history.totalSentRecipients}${colors.reset}`);
      console.log(`${emojis.key} Total Sent Devices: ${colors.bright}${colors.green}${history.totalSentDevices}${colors.reset}`);
      console.log(`${emojis.clock} Date Range: ${colors.bright}${colors.yellow}${history.dateRange.from.toLocaleDateString()} - ${history.dateRange.to.toLocaleDateString()}${colors.reset}`);
      console.log(`${emojis.info} Result Limit: ${colors.bright}${colors.magenta}${limit}${colors.reset}`);
      
      if (history.sentEmails.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📧 RECENT SENT EMAILS${colors.reset}`);
        this.separator();
        history.sentEmails.forEach((emailItem, index) => {
          console.log(`${index + 1}. ${colors.cyan}${emailItem.email.substring(0, 30)}...${colors.reset} (${colors.bright}${colors.green}${emailItem.deviceCount}${colors.reset} keys) - ${colors.yellow}${emailItem.sentAt.toLocaleString()}${colors.reset}`);
        });
      } else {
        this.info('No email sending history found for the specified period');
      }
      
      this.success('Email sending history retrieved successfully!');
      
    } catch (error) {
      this.error(`Failed to get email sending history: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.showEmailDistributionMenu();
  }

  // Manage Email Queue (Reset)
  private async manageEmailQueue(): Promise<void> {
    this.header(`🛠️ Email Queue Management`);
    
    const options = [
      `🔄 Reset Email Status (All)`,
      `🔄 Reset Email Status (Specific Emails)`,
      `🔍 Preview Reset (Dry Run)`,
      `${emojis.target} Back to Email Distribution Menu`
    ];

    const choice = await this.selectFromMenu(options, `🛠️ Email Queue Management Options`);
    
    switch (choice) {
      case 0:
        await this.exit();
        break;
      case 1:
        await this.resetEmailStatus();
        break;
      case 2:
        await this.resetEmailStatusSpecific();
        break;
      case 3:
        await this.previewEmailReset();
        break;
      case 4:
        await this.showEmailDistributionMenu();
        break;
    }
  }

  // Reset Email Status (All)
  private async resetEmailStatus(): Promise<void> {
    this.header(`🔄 Reset Email Status (All)`);
    
    if (!(await this.ensureConnection())) return;
    
    this.warning('This will reset email_sent status for ALL AI miner devices');
    this.warning('This is primarily for testing purposes');
    
    if (!(await this.confirmPrompt('Are you sure you want to reset ALL email statuses?'))) {
      await this.manageEmailQueue();
      return;
    }
    
    try {
      this.info('Resetting email status for all AI miner devices...');
      const result = await resetEmailQueueStatus();
      
      console.log(`\n${colors.bright}${colors.green}🔄 RESET RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Reset Count: ${colors.bright}${colors.green}${result.resetCount}${colors.reset} devices`);
      console.log(`${emojis.email} Affected Emails: ${colors.bright}${colors.cyan}${result.affectedEmails.length}${colors.reset} unique emails`);
      
      this.success('Email status reset completed!');
      
    } catch (error) {
      this.error(`Failed to reset email status: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.manageEmailQueue();
  }

  // Reset Email Status (Specific)
  private async resetEmailStatusSpecific(): Promise<void> {
    this.header(`🔄 Reset Email Status (Specific Emails)`);
    
    if (!(await this.ensureConnection())) return;
    
    const emailInput = await this.prompt('Enter email addresses to reset (comma-separated)');
    const emails = emailInput.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    if (emails.length === 0) {
      this.error('No valid email addresses provided');
      await this.resetEmailStatusSpecific();
      return;
    }
    
    console.log(`\n${colors.bright}${colors.yellow}📧 EMAILS TO RESET${colors.reset}`);
    this.separator();
    emails.forEach((email, index) => {
      console.log(`${index + 1}. ${colors.cyan}${email}${colors.reset}`);
    });
    
    if (!(await this.confirmPrompt('\nProceed with resetting these email statuses?'))) {
      await this.manageEmailQueue();
      return;
    }
    
    try {
      this.info('Resetting email status for specified emails...');
      const result = await resetEmailQueueStatus({ emails });
      
      console.log(`\n${colors.bright}${colors.green}🔄 RESET RESULTS${colors.reset}`);
      this.separator();
      console.log(`${emojis.success} Reset Count: ${colors.bright}${colors.green}${result.resetCount}${colors.reset} devices`);
      console.log(`${emojis.email} Affected Emails: ${colors.bright}${colors.cyan}${result.affectedEmails.length}${colors.reset} unique emails`);
      
      this.success('Email status reset completed!');
      
    } catch (error) {
      this.error(`Failed to reset email status: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.manageEmailQueue();
  }

  // Preview Email Reset
  private async previewEmailReset(): Promise<void> {
    this.header(`🔍 Preview Email Reset (Dry Run)`);
    
    if (!(await this.ensureConnection())) return;
    
    try {
      this.info('Previewing email reset...');
      const result = await resetEmailQueueStatus({ dryRun: true });
      
      console.log(`\n${colors.bright}${colors.green}🔍 RESET PREVIEW${colors.reset}`);
      this.separator();
      console.log(`${emojis.info} Would Reset: ${colors.bright}${colors.yellow}${result.resetCount}${colors.reset} devices`);
      console.log(`${emojis.email} Affected Emails: ${colors.bright}${colors.cyan}${result.affectedEmails.length}${colors.reset} unique emails`);
      
      if (result.affectedEmails.length > 0) {
        console.log(`\n${colors.bright}${colors.blue}📧 AFFECTED EMAILS (First 10)${colors.reset}`);
        this.separator();
        result.affectedEmails.slice(0, 10).forEach((email, index) => {
          console.log(`${index + 1}. ${colors.cyan}${email}${colors.reset}`);
        });
        if (result.affectedEmails.length > 10) {
          console.log(`${colors.dim}... and ${result.affectedEmails.length - 10} more emails${colors.reset}`);
        }
      }
      
      this.success('Email reset preview completed!');
      
    } catch (error) {
      this.error(`Failed to preview email reset: ${error}`);
    }
    
    await this.prompt('\nPress Enter to continue...');
    await this.manageEmailQueue();
  }

  // Exit application
  private async exit(): Promise<void> {
    this.header(`${emojis.robot} Thank You!`);
    this.success('AI Edge Miner CLI shutting down...');
    this.rl.close();
    process.exit(0);
  }

  // Start the CLI
  public async start(): Promise<void> {
    console.clear();
    this.header(`${emojis.rocket} Welcome to AI Edge Miner CLI`);
    this.info('Initializing system...');
    
    // Show welcome message
    console.log(`${colors.bright}${colors.cyan}🎯 This tool helps you manage AI Edge Miner key generation${colors.reset}`);
    console.log(`${colors.dim}   • View eligibility statistics${colors.reset}`);
    console.log(`${colors.dim}   • Run simulations (dry runs)${colors.reset}`);
    console.log(`${colors.dim}   • Test with specific users${colors.reset}`);
    console.log(`${colors.dim}   • Process all eligible users in batches${colors.reset}`);
    console.log(`${colors.dim}   • Monitor new registrations${colors.reset}\n`);
    
    await this.showMainMenu();
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new AIEdgeMinerCLI();
  cli.start().catch((error) => {
    console.error(`${colors.red}${emojis.error} CLI Error: ${error}${colors.reset}`);
    process.exit(1);
  });
}

export { AIEdgeMinerCLI };
