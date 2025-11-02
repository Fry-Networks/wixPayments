// Optional compatibility re-exports for incremental migration
export { isDeviceEligible } from '../service/eligibility.js';
export { generateAIMinerKey, generateAIMinerKeysForEligibleUsers, generateAIMinerKeysBatch, getEligibilityStats, generateAndSendAIMinerKeyByMinerKey, addAIMinerFieldToDevice } from '../service/keys.js';
export { monitorNewRegistrationsAndGenerateAIMinersAtomic } from '../service/monitor.js';
export { migrateDeviceFields } from '../migration/migrate-fields.js';
export { migrateAIEdgeMinerPrefix, migrateSingleAIEdgeMinerPrefix } from '../migration/migrate-prefix.js';
export { resetParentAssignmentTracking } from '../migration/reset.js';
export { validateParentChildRelationships, generateParentChildAssignmentReport, quickHealthCheck } from '../validation/relationships.js';
export { getEmailQueueStats, previewEmailQueue, sendPendingEmailsBatch, getEmailSendingHistory, resetEmailQueueStatus } from '../service/email-queue.js';
