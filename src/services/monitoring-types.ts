/**
 * TypeScript interfaces and types for AI Miner Monitoring Service
 */

export interface MonitoringResult {
  successCount: number;
  failCount: number;
  processedEmails: string[];
  totalDevicesProcessed: number;
  emailsSent: number;
  errors: Array<{
    deviceId: string;
    email: string;
    error: string;
  }>;
}

export interface MonitoringConfig {
  batchSize?: number;
  rateLimit?: number;
  dryRun?: boolean;
  emailFilter?: string[];
}

export interface EligibilityStats {
  totalEligibleDevices: number;
  uniqueEmails: number;
  devicesByNodeType: Record<string, number>;
  devicesByEmail: Record<string, number>;
}

export interface DeviceGrouping {
  email: string;
  deviceCount: number;
  devices: Array<{
    id: any;
    name: string;
    order: string;
  }>;
}

export interface GenerationResult {
  deviceId: string;
  success: boolean;
  aiMinerDeviceId?: string;
  parentAssigned: boolean;
  error?: string;
}

export interface EmailResult {
  email: string;
  keyCount: number;
  success: boolean;
  error?: string;
}

export interface MonitoringSession {
  sessionId: string;
  startTime: Date;
  config: MonitoringConfig;
  stats?: EligibilityStats;
  result?: MonitoringResult;
  endTime?: Date;
  duration?: number;
}

/**
 * Configuration defaults for monitoring service
 */
export const DEFAULT_MONITORING_CONFIG: Required<MonitoringConfig> = {
  batchSize: 50,
  rateLimit: 30,
  dryRun: false,
  emailFilter: []
};

/**
 * Log levels for monitoring service
 */
export enum MonitoringLogLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * Monitoring service status
 */
export enum MonitoringStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed'
}
