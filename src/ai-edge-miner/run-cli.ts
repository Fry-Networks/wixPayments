#!/usr/bin/env node

/**
 * AI Edge Miner CLI Runner
 * 
 * This script provides an easy way to run the AI Edge Miner CLI
 * with proper error handling and environment setup.
 */

import { AIEdgeMinerCLI } from './cli.js';
import { secrets } from '../config/secrets.js';

// Touch secrets to validate 1Password injection early
// (secrets.ts will exit with a clear error if not injected)
void secrets.mongoUri;

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the CLI
async function main() {
  try {
    const cli = new AIEdgeMinerCLI();
    await cli.start();
  } catch (error) {
    console.error('❌ Failed to start AI Edge Miner CLI:', error);
    process.exit(1);
  }
}

main();
