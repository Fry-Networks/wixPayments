# WixPayments - FRY Networks Device Key Generation System

A Node.js webhook service that automatically generates and distributes miner keys for FRY Networks devices when orders are fulfilled in Wix eCommerce.

## Overview

This system listens to Wix store webhooks, processes product orders, generates unique miner keys for various FRY network devices, and automatically emails them to customers. It includes advanced features for AI Edge Miner management with parent-child device relationships.

## System Architecture

```
Wix Store Order → Webhook → Key Generation → Email Distribution → Database Storage
                     ↓
                AI Edge Miner System (Auto-generation for eligible users)
```

## Key Features

- **Webhook Processing**: Handles Wix order fulfillment, cancellation, and refund webhooks
- **Product Translation Layer**: Maps new Wix product names to internal legacy names for backward compatibility
- **Miner Key Generation**: Creates unique device keys for different node types
- **Email Distribution**: Automatically sends keys to customers via Gmail API
- **AI Edge Miner System**: Advanced parent-child device relationship management
- **Monitoring & Analytics**: Comprehensive logging and monitoring endpoints
- **Admin Tools**: Manual device creation, testing, and system management endpoints

## Product Types Supported

### Hardware Devices

- **Bandwidth Gateway** (BM)
- **Noise Sensors** (IDM/ODM) - Indoor/Outdoor
- **Satellite Sensors** (ISM/OSM) - Indoor/Outdoor
- **Compute Node** (CN) - Reward Decentralization
- **Storage Nodes** (SDN/SVN) - Storage Decentralization/Validator

### API-Based Devices

- **Weather Stations** (HWM/LWM) - High/Low-End
- **Water Quality Sensors** (OWQM/OHWQM/OLWQM)
- **Energy Gateway** (EM)

### Camera Systems (RTSP)

- **Weather Station Cameras** (AOWSCM/AIWSCM)
- **Wildlife Cameras** (AOWCM/AIWCM)
- **Sky Cameras** (AOSCM/AISCM)
- **Traffic Cameras** (AOTCM/AITCM)

### Mac-Based Devices

- **Radiation Sensor** (IRM)
- **Air Quality Sensors** (IHAQM/OHAQM/ILAQM)

## Installation

### Prerequisites

- Node.js 16+
- MongoDB instance
- Gmail API credentials
- Wix API access tokens
- 1Password CLI (for environment variables)

### Setup

```bash
# Clone repository
git clone <repository-url>
cd wixPayments

# Install dependencies
npm install

# Configure environment variables
# Set up .1p.env.dev and .1p.env.prod with required secrets

# Build project
npm run build

# Start development server
npm run dev

# Start production server
npm run start
```

### Required Environment Variables

```bash
# Wix API Configuration
WIX_AUTH_TOKEN=your_wix_auth_token
WIX_SITE_ID=your_site_id

# Database
MONGODB_URI=your_mongodb_connection_string

# Email Service
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret
GMAIL_REFRESH_TOKEN=your_gmail_refresh_token

# Security
BASE_API_KEY=your_webhook_security_key
UNSUBSCRIBE_SECRET=jwt_secret_for_unsubscribe_tokens

# Server Configuration
PORT=3000
NODE_ENV=development|production
```

## API Endpoints

### Webhook Endpoints

- `POST /wix_fulfill` - Process order fulfillment webhooks
- `POST /wix_canceled` - Process order cancellation webhooks
- `POST /wix_refunded` - Process order refund webhooks
- `POST /wix_web` - Debug webhook payload inspection

### Management Endpoints

- `POST /newdevice` - Manually create device keys
- `POST /test-email` - Test email functionality
- `GET /health` - Service health check
- `GET /unsubscribe` - One-click email unsubscribe

### AI Edge Miner Endpoints

- `POST /ai-miner-simulation` - Preview eligible devices for AI miner generation
- `POST /generate-free-ai-miners` - One-time bulk AI miner generation
- `POST /migrate-device-fields` - Database migration for new fields
- `POST /monitor-registrations` - Manual monitoring and generation
- `POST /repair-aem-parent-links` - Repair orphaned AI Edge Miner relationships

### Authentication

All administrative endpoints require the `x-api-key` header with your `BASE_API_KEY` value.

## Product Translation Layer

The system maintains backward compatibility by translating new Wix product names to internal legacy names:

```typescript
// Example translations:
"Fry AI Edge Agent" → "$FRY AI Edge Miner"
"Fry Compute Node" → "$FRY Reward Decentralization Node"
"Fry Storage Node" → "$FRY Storage Decentralization Node"
"Fry Bandwidth Gateway" → "$FRY Bandwidth Miner"
// ... and many more
```

This ensures all existing logic, database records, and generated keys remain compatible.

## AI Edge Miner System

### Overview

The AI Edge Miner system automatically generates free AI Edge Miner devices for users who have purchased eligible parent devices.

### Eligibility Criteria

- User has a qualifying parent device (Compute Node, Storage Node, etc.)
- Order number is below 16607 OR matches special eligible order strings
- Parent device has `ai_miner_generated: true`
- No duplicate AI Edge Miners for the same email/order combination

### Parent-Child Relationships

- **Parent Devices**: Hardware nodes that can spawn AI Edge Miners
- **Child Devices**: AI Edge Miner devices linked to parent devices
- **Automatic Linking**: System automatically assigns child devices to available parents
- **Email Notifications**: Combined emails sent with both parent and child device keys

### Monitoring & Generation

- **Scheduled Monitoring**: Hourly automatic checks for new eligible devices
- **Manual Monitoring**: On-demand monitoring via API endpoint
- **Batch Processing**: Configurable batch sizes and rate limiting
- **Error Handling**: Comprehensive error tracking and admin notifications

## Database Schema

### DeviceModel (devices collection)

```typescript
{
  _id: ObjectId,
  user_id: ObjectId,
  miner_key: string,           // Unique device key (e.g., "AEM-ABC123...")
  order: string,               // Order number from Wix
  created_at: Date,
  is_registered: boolean,
  name: string,                // Device type name (e.g., "$FRY AI Edge Miner")
  email: string,               // Customer email
  enabled: boolean,
  byod: string,

  // AI Edge Miner specific fields
  ai_miner_generated: boolean,     // Parent device flag
  ai_edge_miner_assigned: boolean, // Parent device flag
  assigned_ai_edge_miner_id: ObjectId,
  parent_device_id: ObjectId,      // Child device link to parent
  parent_device_name: string,
  parent_device_miner_key: string,

  // Email tracking (AI Edge Miners only)
  email_sent: boolean,
  email_sent_at: Date,

  // Registration tracking
  registration: {
    amount: number,
    transaction_hash: string,
    created_at: Date
  },
  node: {
    amount: number,
    transaction_hash: string,
    created_at: Date
  }
}
```

### ProductModel (products collection)

```typescript
{
  _id: ObjectId,
  wix_id: string,     // Wix product ID
  name: string,       // Internal legacy product name
  price: number,
  key: string,        // Abbreviated key (e.g., "BM", "AEM")
  type: string        // Device type: "hardware", "apikey", "rtsp", "mac"
}
```

### UserModel (users collection)

```typescript
{
  _id: ObjectId,
  email: string,
  do_not_email: boolean,  // Unsubscribe flag
  created_at: Date
}
```

## Key Generation Logic

### Miner Key Format

- **Standard Devices**: `{PREFIX}-{RANDOM_STRING}` (e.g., `BM-ABC123DEF456`)
- **AI Edge Miners**: `AEM-{RANDOM_STRING}` (e.g., `AEM-XYZ789UVW012`)

### Abbreviation Generation

Device abbreviations are generated from internal product names:

```typescript
"$FRY Bandwidth Miner" → "BM"
"$FRY Indoor Satellite Miner" → "ISM"
"$FRY AI Edge Miner" → Uses "AEM" prefix
```

### Key Uniqueness

- All keys are checked for uniqueness before creation
- Duplicate key generation throws an error and retries
- Keys are validated against existing database records

## Email System

### Gmail API Integration

- Uses OAuth2 with refresh tokens for authentication
- Sends HTML emails with device key information
- Includes one-click unsubscribe links (JWT-based)
- Supports batch sending for multiple devices

### Email Content

- **Subject**: Personalized with order number and device count
- **Body**: HTML template with device keys and parent device information
- **Unsubscribe**: One-click unsubscribe functionality
- **Security**: JWT tokens for unsubscribe links

### Parent-Child Email Grouping

For AI Edge Miners, emails contain:

- Parent device name and key
- Child AI Edge Miner key(s)
- Relationship information for user understanding

## Error Handling & Monitoring

### Logging System

- **Structured Logging**: Timestamped logs with request IDs
- **Log Levels**: Info, Success, Warning, Error with appropriate emojis
- **Request Tracking**: Unique request IDs for tracing webhook processing
- **Performance Metrics**: Duration tracking for key operations

### Admin Notifications

- **Webhook Failures**: Automatic admin notification for critical errors
- **Key Generation Events**: Admin alerts for successful key generation
- **Monitoring Completion**: Summary reports for AI miner monitoring runs
- **System Errors**: Detailed error notifications with context

### Health Checks

- **Service Health**: `/health` endpoint with service status
- **Database Connectivity**: MongoDB connection verification
- **Email Service**: Test email functionality via `/test-email`
- **Webhook Validation**: Debug endpoint for webhook troubleshooting

## Development

### NPM Scripts

```bash
npm run dev          # Start development server with hot reload
npm run start        # Start production server
npm run build        # Compile TypeScript to build/
npm run sync         # Git pull and build
npm run test         # Run test suite (placeholder)

# AI Miner CLI Tools
npm run ai-miner-cli      # V1 CLI tools
npm run ai-miner-cli:v2   # V2 CLI tools
```

### File Structure

```
src/
├── main.ts                          # Main server and webhook handlers
├── productUpdater.ts               # Product fetching and translation layer
├── MailProcessor.ts                # Email sending functionality
├── db/
│   ├── connect.ts                  # Database connection
│   ├── devices-schema.ts           # Device model schema
│   ├── products-schema.ts          # Product model schema
│   ├── users-schema.ts             # User model schema
│   └── utils.ts                    # Database utilities
├── ai-edge-miner-2/               # V2 AI Edge Miner system
│   ├── service/                    # Core business logic
│   ├── migration/                  # Database migrations
│   ├── validation/                 # Data validation
│   ├── assignment/                 # Parent-child assignment
│   └── cli/                        # Command-line tools
├── services/
│   ├── ai-miner-monitor.ts        # Monitoring service
│   └── notification-service.ts    # Admin notification system
└── config/
    └── secrets.ts                  # Environment variable management
```

### TypeScript Configuration

- **ES Modules**: Full ESM support with `.js` extensions for imports
- **Import Registration**: Custom register-ts-node.js for development
- **Strict Mode**: Enabled for type safety
- **Target**: ES2020 for modern JavaScript features

## Production Deployment

### Docker Compose

```bash
# Build the image
docker compose build

# Start the service
docker compose up -d

# Monitor logs
docker compose logs -f wix_payments

# Rebuild and restart after updates
docker compose up -d --build
```

### Environment Management

- **Development**: Uses `.1p.env.dev` with 1Password CLI
- **Production (Docker)**: Uses `docker-compose.yml` with `op://` references resolved by `op run`
- **Security**: All sensitive values stored in 1Password vaults

### SSL/TLS Configuration

- **Certificate Files**: `server.cert` and `server.key`
- **Public Key**: `public.pem` for JWT verification
- **HTTPS**: Recommended for production webhook endpoints

## Troubleshooting

### Common Issues

**No Products Found**

- Check if Wix product names contain "Fry" prefix
- Verify Wix API credentials and permissions
- Check product translation mapping in `productUpdater.ts`

**Email Delivery Failures**

- Verify Gmail API credentials and refresh token
- Check recipient email address validity
- Review email sending logs for specific errors

**AI Edge Miner Assignment Issues**

- Check parent device eligibility criteria
- Verify parent-child relationship data integrity
- Use `/monitor-registrations` endpoint for diagnosis

**Webhook Authentication Failures**

- Verify `x-api-key` header matches `BASE_API_KEY`
- Check webhook URL configuration in Wix
- Review webhook payload structure

### Debug Endpoints

- `POST /wix_web` - Inspect raw webhook payloads
- `POST /test-email` - Test email functionality
- `GET /health` - Check service status
- `POST /ai-miner-simulation` - Preview AI miner eligibility

## Contributing

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Follow project linting rules
- **Imports**: Use `.js` extensions for local imports
- **Error Handling**: Comprehensive try-catch blocks
- **Logging**: Use structured logging with request IDs

### Testing

- Unit tests for key generation logic
- Integration tests for webhook processing
- Email delivery testing
- Database migration validation

## Security Considerations

### API Security

- **Authentication**: Required for all admin endpoints
- **HTTPS**: Encrypted communication for webhook endpoints
- **Input Validation**: Sanitize all webhook payloads
- **Rate Limiting**: Implement for public endpoints
- **Webhook Request Signing (recommended)**: Set `WEBHOOK_SIGNING_SECRET` to require HMAC signatures on `/wix_fulfill`, `/wix_canceled`, `/wix_refunded`, and `/wix_web`.
  - Required headers: `x-api-key`, `x-timestamp` (unix seconds), `x-nonce` (unique per request), `x-signature` (`v1=<hex>`).
  - Signature base string: `${x-timestamp}.${HTTP_METHOD}.${PATH}.${x-nonce}.<raw request body bytes>`
  - Signature algorithm: `HMAC-SHA256` with `WEBHOOK_SIGNING_SECRET`, hex encoded.
  - Node example:
    - `const ts = Math.floor(Date.now() / 1000); const nonce = crypto.randomBytes(16).toString("hex");`
    - `const body = JSON.stringify(payload); const base = ts + ".POST./wix_fulfill." + nonce + "." + body;`
    - `const sig = crypto.createHmac("sha256", process.env.WEBHOOK_SIGNING_SECRET).update(base).digest("hex");`
    - Send `x-signature: v1=<hex>` along with `x-timestamp` and `x-nonce`.

### Data Protection

- **Email Redaction**: Sensitive data logging protection
- **Key Security**: Secure random key generation
- **Database Access**: Restricted connection strings
- **Unsubscribe Privacy**: JWT-based unsubscribe tokens

## Support

### Logging & Monitoring

- Check application logs for error details
- Use request IDs to trace specific webhook processing
- Monitor database connectivity and performance
- Review admin notification emails for system alerts

### Emergency Procedures

- **Service Restart**: `docker compose restart wix_payments`
- **Database Recovery**: Use MongoDB backup procedures
- **Email Service Issues**: Verify Gmail API status and credentials
- **Webhook Failures**: Check Wix webhook configuration and connectivity

---

**Version**: 2.0.0  
**Node.js**: 16+  
**Database**: MongoDB  
**License**: ISC
