AI Edge Miner v2

Overview
- Consolidated, atomic parent assignment
- Single CLI with common operations (stats, simulate/batch keygen, monitor, email queue, migrations, validation)
- Shared constants and helpers

Key Exports
- Service: eligibility, keys (generate/batch), monitor (atomic), email-queue
- Migration: migrate fields, migrate prefix (ANM→AEM), reset
- Validation: relationship checks, reports, quick health check

Usage (CLI)
- Run: ts-node src/ai-edge-miner-2/cli/index.ts

Integration
- Prefer monitorNewRegistrationsAndGenerateAIMinersAtomic for scheduled jobs
- Parent assignment performed via assignParentDeviceAtomic for all create/migrate flows

