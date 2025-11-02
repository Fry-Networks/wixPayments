# AI Edge Miner Key Management System

A comprehensive system for managing AI Edge Miner key generation and distribution for eligible node runners.

## 🚀 Features

- **Consolidated Email System**: Groups devices by user email to send one email per user with all their keys
- **Batch Processing**: Efficiently processes thousands of devices with transaction support
- **Interactive CLI**: Beautiful command-line interface with colors, progress bars, and safety prompts
- **Multiple Modes**: Simulation, testing, and production modes for safe operations
- **Progress Tracking**: Real-time progress monitoring with resumability
- **Error Handling**: Comprehensive error handling with transaction rollbacks
- **Statistics**: Detailed eligibility statistics and reporting

## 📋 Prerequisites

- Node.js 18+ 
- MongoDB connection
- Environment variables configured (see `.env` setup)
- Email service configured (Gmail API)

## 🛠️ Installation & Setup

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   # Required environment variables
   MONGO_URI=mongodb://your-mongodb-connection-string
   ```

3. **Build the project** (optional, for production):
   ```bash
   npm run build
   ```

## 🎮 Usage

### Quick Start - Interactive CLI

Run the interactive CLI to manage AI Edge Miner keys:

```bash
# Development mode (recommended)
npm run ai-miner-cli

# Or production mode (after building)
npm run ai-miner-cli:build
```

### CLI Menu Options

The CLI provides the following options:

1. **📊 View Eligibility Statistics**
   - Shows total eligible devices
   - Unique email addresses
   - Devices by node type (RDN, SDN, SVN)
   - Users with multiple devices

2. **🔍 Simulation Mode (Dry Run)**
   - Tests eligibility without generating keys
   - Shows sample eligible devices
   - Safe to run multiple times

3. **🧪 Test Mode (1-2 Users)**
   - Generate real keys for specific email addresses
   - Perfect for testing before full deployment
   - Validates the complete flow

4. **⚡ Batch Processing (All Eligible Users)**
   - Processes all eligible users
   - Configurable batch sizes (1-500)
   - Real-time progress tracking
   - Transaction safety with rollbacks

5. **⏰ Monitor New Registrations**
   - Checks for newly completed registrations
   - Generates keys for new eligible devices

6. **⚙️ Advanced Configuration**
   - Initialize AI Miner Field (Database Migration)
   - Add AI Miner Field to Single Device (Test)
   - Custom dry runs with batch size configuration
   - Database connection testing
   - System information display

## 🔧 Technical Details

### Eligibility Criteria

A device is eligible for an AI Edge Miner key if:
- Node type is RDN, SDN, or SVN
- Has completed registration staking (amount > 0)
- Has completed node operation staking (amount > 0)
- Has not already received an AI miner key
- Has a valid email address
- Order number is below 16607 (for existing users)

### Email Consolidation

The system groups devices by email address to prevent spam:
- Multiple devices per user → Single email with all keys
- Each key is clearly labeled with device name/order
- Email template handles both single and multiple keys
- Failed emails don't mark devices as processed

### Batch Processing Features

- **Transaction Safety**: Uses MongoDB transactions to ensure data consistency
- **Progress Tracking**: Real-time progress bars and status updates
- **Error Recovery**: Individual failures don't affect the entire batch
- **Rate Limiting**: Configurable delays to prevent overwhelming email service
- **Memory Optimization**: Processes devices in configurable batch sizes

### Performance Optimizations

- **Lean Queries**: Uses `.lean()` for faster database reads
- **Selective Fields**: Only fetches required fields to reduce memory usage
- **Batch Updates**: Uses `updateMany()` for efficient database updates
- **Connection Pooling**: Reuses database connections
- **Progress Callbacks**: Non-blocking progress reporting

## 📊 Statistics & Monitoring

### Eligibility Statistics
```typescript
{
  totalEligibleDevices: number;
  uniqueEmails: number;
  devicesByNodeType: Record<string, number>;
  emailsWithMultipleDevices: number;
  averageDevicesPerEmail: number;
}
```

### Batch Processing Results
```typescript
{
  successCount: number;
  failCount: number;
  processedEmails: string[];
  failedEmails: string[];
  eligibleDevicesCount: number;
  uniqueEmailsCount: number;
}
```

## 🔒 Safety Features

### Multiple Confirmation Prompts
- Simulation mode warnings
- Test mode confirmations
- Production mode double-confirmation
- Batch size validation

### Transaction Safety
- Database transactions for consistency
- Automatic rollbacks on failures
- No partial updates on errors

### Error Handling
- Comprehensive error logging
- Graceful failure handling
- Failed email tracking
- Resume capability

## 🚨 Important Notes

### Before Running Production
1. **Always run simulation first** to verify eligibility counts
2. **Test with 1-2 users** to validate email delivery
3. **Check database connection** in advanced settings
4. **Verify email service configuration**
5. **Ensure sufficient email quota** for large batches

### Production Considerations
- **Batch Size**: Start with smaller batches (50-100) for large datasets
- **Email Limits**: Gmail API has daily sending limits
- **Database Load**: Monitor database performance during large operations
- **Network Stability**: Ensure stable connection for long-running operations

## 🔧 Programmatic Usage

You can also use the functions directly in your code:

```typescript
import { 
  getEligibilityStats,
  simulateAIMinerGeneration,
  generateFreeAIMinersForExistingUsersBatch
} from './ai-miner-service.js';

// Get statistics
const stats = await getEligibilityStats();

// Run simulation
const eligibleDevices = await simulateAIMinerGeneration();

// Process with custom options
const result = await generateFreeAIMinersForExistingUsersBatch({
  batchSize: 100,
  dryRun: false,
  emails: ['specific@email.com'], // Optional filter
  progressCallback: (progress) => {
    console.log(`Progress: ${progress.processed}/${progress.total}`);
  }
});
```

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check MONGO_URI environment variable
   - Verify MongoDB server is running
   - Test connection in advanced settings

2. **Email Sending Failed**
   - Verify Gmail API credentials
   - Check email service configuration
   - Ensure sufficient API quota

3. **No Eligible Devices Found**
   - Run eligibility statistics to verify criteria
   - Check order number cutoff (16607)
   - Verify staking requirements

4. **CLI Not Starting**
   - Check Node.js version (18+ required)
   - Verify all dependencies installed
   - Check environment variables

### Debug Mode

Set `NODE_ENV=development` for detailed error logging and stack traces.

## 📝 Logging

The system provides comprehensive logging:
- **Info**: General operation status
- **Success**: Completed operations
- **Warning**: Non-critical issues
- **Error**: Failed operations with details

All logs include timestamps and emoji indicators for easy reading.

## 🔄 Updates & Maintenance

### Regular Tasks
- Monitor failed emails and retry if needed
- Check eligibility statistics periodically
- Update order number cutoff as needed
- Monitor email service quotas

### Database Maintenance
- Regular backups before large operations
- Monitor `ai_miner_generated` field accuracy
- Clean up old logs if needed

## 📞 Support

For issues or questions:
1. Check this README first
2. Review error logs for specific issues
3. Test with simulation mode
4. Use test mode for validation

---

**⚠️ Important**: Always test thoroughly before running production operations. The system includes multiple safety features, but careful testing is essential for large-scale operations.
