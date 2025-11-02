import {
  sendAdminNotification,
  AdminEmailData,
} from "../AdminMailProcessor.js";
import { redactEmail, redactKey } from "../redact-utils.js";
import { secrets } from "../config/secrets.js";

/**
 * Notification Service for Admin Alerts
 *
 * Sends email notifications to admin about key generation events,
 * monitoring activities, and system alerts.
 */

export interface AdminNotification {
  type:
    | "MINER_KEY_GENERATED"
    | "AI_MINER_GENERATED"
    | "MONITORING_COMPLETE"
    | "MONITORING_HEALTH_CHECK"
    | "SYSTEM_ERROR"
    | "ELIGIBLE_DEVICES_DISCOVERED";
  title: string;
  summary: string;
  details: any;
  timestamp: Date;
  requestId?: string;
}

export interface KeyGenerationSummary {
  type: "wix_order" | "ai_monitoring";
  triggerSource: string;
  userEmail: string;
  orderNumber?: string;
  keysGenerated: Array<{
    key: string;
    name: string;
    type: string;
  }>;
  parentAssignments?: Array<{
    childId: string;
    parentId: string;
    parentName: string;
  }>;
  success: boolean;
  error?: string;
  timestamp: Date;
  requestId?: string;
}

export interface MonitoringSummary {
  sessionId: string;
  totalEligibleDevices: number;
  successCount: number;
  failCount: number;
  processedEmails: string[];
  emailsSent: number;
  errors: Array<{
    deviceId: string;
    email: string;
    error: string;
  }>;
  duration: number;
  timestamp: Date;
  triggerSource?: string;
  consecutiveZeroSessions?: number;
  hoursSinceLastNotification?: number;
}

export interface HealthCheckSummary {
  sessionId: string;
  consecutiveZeroSessions: number;
  hoursSinceLastNotification: number;
  totalMonitoringSessions: number;
  lastActivityTimestamp: Date | null;
  averageDevicesPerSession: number;
  systemStatus: "healthy" | "idle" | "concerning";
  triggerReason: string;
  timestamp: Date;
}

export interface EligibleDevicesDiscovery {
  sessionId: string;
  triggerSource: string;
  totalEligibleDevices: number;
  uniqueEmails: number;
  devicesByEmail: Array<{
    email: string;
    deviceCount: number;
    devices: Array<{
      id: string;
      name: string;
      order: string;
    }>;
  }>;
  devicesByNodeType: Record<string, number>;
  timestamp: Date;
}

class NotificationService {
  private adminEmail: string | undefined;
  private enabled: boolean;

  constructor() {
    this.adminEmail = secrets.emailAddress;
    this.enabled = !!this.adminEmail;

    if (!this.enabled) {
      console.log(
        "⚠️  NOTIFICATION SERVICE: EMAIL_ADDRESS not configured, notifications disabled"
      );
    } else {
      console.log(
        `✅ NOTIFICATION SERVICE: Admin notifications enabled for ${redactEmail(
          this.adminEmail!
        )}`
      );
    }
  }

  /**
   * Send notification when miner keys are generated via Wix orders
   */
  async notifyWixKeyGeneration(summary: KeyGenerationSummary): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const notification: AdminNotification = {
      type: "MINER_KEY_GENERATED",
      title: `🔑 Wix Order Keys Generated - Order ${summary.orderNumber}`,
      summary: `Generated ${
        summary.keysGenerated.length
      } miner key(s) for ${redactEmail(summary.userEmail)}`,
      details: {
        orderNumber: summary.orderNumber,
        userEmail: redactEmail(summary.userEmail),
        keyCount: summary.keysGenerated.length,
        keyTypes: summary.keysGenerated.map((k) => ({
          name: k.name,
          key: redactKey(k.key),
        })),
        triggerSource: summary.triggerSource,
        success: summary.success,
        error: summary.error,
      },
      timestamp: summary.timestamp,
      requestId: summary.requestId,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send notification when AI Miner keys are generated via monitoring
   */
  async notifyAIKeyGeneration(summary: KeyGenerationSummary): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const notification: AdminNotification = {
      type: "AI_MINER_GENERATED",
      title: `🤖 AI Miner Keys Generated - ${summary.keysGenerated.length} key(s)`,
      summary: `Auto-generated ${
        summary.keysGenerated.length
      } AI Edge Miner key(s) for ${redactEmail(summary.userEmail)}`,
      details: {
        userEmail: redactEmail(summary.userEmail),
        keyCount: summary.keysGenerated.length,
        keys: summary.keysGenerated.map((k) => redactKey(k.key)),
        parentAssignments: summary.parentAssignments?.map((p) => ({
          childId: p.childId,
          parentId: p.parentId,
          parentName: p.parentName,
        })),
        triggerSource: summary.triggerSource,
        success: summary.success,
        error: summary.error,
      },
      timestamp: summary.timestamp,
      requestId: summary.requestId,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send notification when monitoring session completes (only for activity)
   */
  async notifyMonitoringComplete(summary: MonitoringSummary): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const notification: AdminNotification = {
      type: "MONITORING_COMPLETE",
      title: `🔍 AI Miner Monitoring - ${summary.successCount} generated, ${summary.failCount} failed`,
      summary: `Processed ${
        summary.totalEligibleDevices
      } eligible devices from ${summary.triggerSource || "Unknown trigger"}`,
      details: {
        sessionId: summary.sessionId,
        triggerSource: summary.triggerSource,
        stats: {
          totalEligibleDevices: summary.totalEligibleDevices,
          successCount: summary.successCount,
          failCount: summary.failCount,
          emailsSent: summary.emailsSent,
          duration: `${summary.duration}ms`,
        },
        processedEmails: summary.processedEmails.map((email) =>
          redactEmail(email)
        ),
        errors: summary.errors.map((e) => ({
          deviceId: e.deviceId,
          email: redactEmail(e.email),
          error: e.error,
        })),
      },
      timestamp: summary.timestamp,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send health check notification (8-hour system status)
   */
  async notifyMonitoringHealthCheck(
    summary: HealthCheckSummary
  ): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const statusEmoji =
      summary.systemStatus === "healthy"
        ? "💚"
        : summary.systemStatus === "idle"
        ? "💙"
        : "⚠️";

    const notification: AdminNotification = {
      type: "MONITORING_HEALTH_CHECK",
      title: `${statusEmoji} System Health Check - AI Miner Monitoring Status`,
      summary: `System ${summary.systemStatus} - ${summary.consecutiveZeroSessions} consecutive hours with no eligible devices`,
      details: {
        sessionId: summary.sessionId,
        systemStatus: summary.systemStatus,
        consecutiveZeroHours: summary.consecutiveZeroSessions,
        hoursSinceLastNotification:
          Math.round(summary.hoursSinceLastNotification * 10) / 10,
        triggerReason: summary.triggerReason,
        stats: {
          totalMonitoringSessions: summary.totalMonitoringSessions,
          lastActivityTimestamp: summary.lastActivityTimestamp?.toISOString(),
          averageDevicesPerSession: summary.averageDevicesPerSession,
          hoursSinceActivity: summary.lastActivityTimestamp
            ? Math.round(
                ((Date.now() - summary.lastActivityTimestamp.getTime()) /
                  (1000 * 60 * 60)) *
                  10
              ) / 10
            : "Never",
        },
        healthCheck: {
          monitoringActive: true,
          databaseConnected: true,
          notificationSystemActive: true,
          lastHealthCheckTime: summary.timestamp.toISOString(),
        },
      },
      timestamp: summary.timestamp,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send notification when eligible devices are discovered during monitoring
   */
  async notifyEligibleDevicesDiscovered(
    discovery: EligibleDevicesDiscovery
  ): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const notification: AdminNotification = {
      type: "ELIGIBLE_DEVICES_DISCOVERED",
      title: `🔍 Eligible Devices Discovered - ${discovery.totalEligibleDevices} device(s) ready for AI mining`,
      summary: `Found ${discovery.totalEligibleDevices} eligible devices across ${discovery.uniqueEmails} email(s) that have completed registration and staking`,
      details: {
        sessionId: discovery.sessionId,
        triggerSource: discovery.triggerSource,
        stats: {
          totalEligibleDevices: discovery.totalEligibleDevices,
          uniqueEmails: discovery.uniqueEmails,
          devicesByNodeType: discovery.devicesByNodeType,
        },
        devicesByEmail: discovery.devicesByEmail,
        discoveryTimestamp: discovery.timestamp.toISOString(),
      },
      timestamp: discovery.timestamp,
      requestId: discovery.sessionId,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send system error notification
   */
  async notifySystemError(
    error: Error,
    context: string,
    requestId?: string
  ): Promise<void> {
    if (!this.enabled || !this.adminEmail) return;

    const notification: AdminNotification = {
      type: "SYSTEM_ERROR",
      title: `🚨 System Error - ${context}`,
      summary: `Error occurred in ${context}: ${error.message}`,
      details: {
        context,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
        requestId,
      },
      timestamp: new Date(),
      requestId,
    };

    await this.sendNotification(notification);
  }

  /**
   * Send the notification email using the dedicated admin email system
   */
  private async sendNotification(
    notification: AdminNotification
  ): Promise<void> {
    if (!this.adminEmail) return;

    try {
      const emailData: AdminEmailData = {
        subject: `[WixPayments] ${notification.title}`,
        title: notification.title,
        summary: notification.summary,
        details: notification.details,
        timestamp: notification.timestamp,
        requestId: notification.requestId,
        priority: this.getPriorityFromType(notification.type),
        category: this.getCategoryFromType(notification.type),
      };

      await sendAdminNotification(this.adminEmail, emailData);

      console.log(
        `📧 ADMIN NOTIFICATION SENT: ${notification.type} to ${redactEmail(
          this.adminEmail
        )}`
      );
    } catch (error) {
      console.error(`❌ FAILED TO SEND ADMIN NOTIFICATION:`, error);
    }
  }

  /**
   * Map notification type to priority level
   */
  private getPriorityFromType(
    type: AdminNotification["type"]
  ): AdminEmailData["priority"] {
    switch (type) {
      case "SYSTEM_ERROR":
        return "high";
      case "ELIGIBLE_DEVICES_DISCOVERED":
        return "high";
      case "MONITORING_COMPLETE":
        return "normal";
      case "MONITORING_HEALTH_CHECK":
        return "low";
      case "AI_MINER_GENERATED":
        return "normal";
      case "MINER_KEY_GENERATED":
        return "normal";
      default:
        return "normal";
    }
  }

  /**
   * Map notification type to category
   */
  private getCategoryFromType(
    type: AdminNotification["type"]
  ): AdminEmailData["category"] {
    switch (type) {
      case "SYSTEM_ERROR":
        return "system_error";
      case "ELIGIBLE_DEVICES_DISCOVERED":
        return "monitoring";
      case "MONITORING_COMPLETE":
        return "monitoring";
      case "MONITORING_HEALTH_CHECK":
        return "monitoring";
      case "AI_MINER_GENERATED":
        return "key_generation";
      case "MINER_KEY_GENERATED":
        return "key_generation";
      default:
        return "notification";
    }
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get admin email (redacted)
   */
  getAdminEmail(): string {
    return this.adminEmail ? redactEmail(this.adminEmail) : "Not configured";
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export helper functions for easy use
export async function notifyWixKeyGeneration(
  summary: KeyGenerationSummary
): Promise<void> {
  return notificationService.notifyWixKeyGeneration(summary);
}

export async function notifyAIKeyGeneration(
  summary: KeyGenerationSummary
): Promise<void> {
  return notificationService.notifyAIKeyGeneration(summary);
}

export async function notifyMonitoringComplete(
  summary: MonitoringSummary
): Promise<void> {
  return notificationService.notifyMonitoringComplete(summary);
}

export async function notifyMonitoringHealthCheck(
  summary: HealthCheckSummary
): Promise<void> {
  return notificationService.notifyMonitoringHealthCheck(summary);
}

export async function notifyEligibleDevicesDiscovered(
  discovery: EligibleDevicesDiscovery
): Promise<void> {
  return notificationService.notifyEligibleDevicesDiscovered(discovery);
}

export async function notifySystemError(
  error: Error,
  context: string,
  requestId?: string
): Promise<void> {
  return notificationService.notifySystemError(error, context, requestId);
}
