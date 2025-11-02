import { DeviceModel } from "../db/devices-schema.js";
import { secrets } from "../config/secrets.js";
import {
  ELIGIBLE_NODE_TYPES,
  ORDER_NUMBER_CUTOFF,
  ELIGIBLE_ORDER_STRINGS,
} from "../ai-edge-miner-2/common/constants.js";
import { generateAIMinerKey } from "../ai-edge-miner-2/service/keys.js";
import { sendMail } from "../MailProcessor.js";
import { redactEmail } from "../redact-utils.js";
import {
  MonitoringResult,
  MonitoringConfig,
  EligibilityStats,
  DEFAULT_MONITORING_CONFIG,
} from "./monitoring-types.js";
import {
  notifyAIKeyGeneration,
  notifyMonitoringComplete,
  notifyEligibleDevicesDiscovered,
  notifyMonitoringHealthCheck,
} from "./notification-service.js";
import {
  MonitoringSessionTracker,
  IMonitoringSession,
} from "../db/monitoring-sessions-schema.js";

/**
 * Standalone AI Miner Monitoring Service
 *
 * This service monitors existing devices that have received their node miner keys
 * but haven't completed the full registration and staking process yet. When devices
 * become fully eligible (complete registration and staking), it automatically
 * generates AEM keys, assigns parent relationships, and sends consolidated emails.
 */

/**
 * Enhanced logging utility for monitoring service
 */
const monitorLog = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] 🔍 MONITOR: ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ✅ MONITOR: ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ⚠️  MONITOR: ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ MONITOR: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.response?.data)
        console.log(`   Response: ${JSON.stringify(error.response.data)}`);
      if (error.stack && secrets.nodeEnv === "development")
        console.log(`   Stack: ${error.stack}`);
    }
  },
};

/**
 * Main monitoring service class
 */
export class AIMinerMonitoringService {
  private config: MonitoringConfig;

  constructor(config: MonitoringConfig = {}) {
    this.config = {
      ...DEFAULT_MONITORING_CONFIG,
      ...config,
    };
  }

  /**
   * Main monitoring function - finds eligible devices and generates AEM keys
   * This is the atomic version with smart notification integration
   */
  async monitorNewRegistrationsAndGenerateAIMiners(
    triggerSource:
      | "scheduled_hourly"
      | "manual"
      | "webhook"
      | "startup" = "manual"
  ): Promise<MonitoringResult> {
    const sessionId = `monitor_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const sessionStartTime = Date.now();
    monitorLog.info(`Starting monitoring session [${sessionId}]`, {
      config: this.config,
      eligibleNodeTypes: ELIGIBLE_NODE_TYPES,
      orderCutoff: ORDER_NUMBER_CUTOFF,
      triggerSource,
    });

    let successCount = 0;
    let failCount = 0;
    const processedEmails: string[] = [];
    const errors: Array<{ deviceId: string; email: string; error: string }> =
      [];
    let notificationSent = false;
    let notificationType: "ACTIVITY" | "HEALTH_CHECK" | "NONE" = "NONE";
    let notificationReason = "";

    try {
      // Find newly eligible devices
      const eligibilityQuery = {
        $and: [
          {
            $or: ELIGIBLE_NODE_TYPES.map((type) => ({
              name: {
                $regex: type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                $options: "i",
              },
            })),
          },
          { "registration.amount": { $gt: 0 } },
          { "node.amount": { $gt: 0 } },
          { is_registered: true },
          { ai_miner_generated: false },
          {
            $or: [
              { order: { $lt: ORDER_NUMBER_CUTOFF.toString() } },
              { order: { $in: ELIGIBLE_ORDER_STRINGS as unknown as string[] } },
            ],
          },
          { email: { $exists: true, $ne: "" } },
        ],
      };

      monitorLog.info(`Searching for eligible devices [${sessionId}]`, {
        query: eligibilityQuery,
      });

      const newlyEligible = await DeviceModel.find(eligibilityQuery);

      if (newlyEligible.length === 0) {
        monitorLog.info(`No eligible devices found [${sessionId}]`);

        const result = {
          successCount: 0,
          failCount: 0,
          processedEmails: [],
          totalDevicesProcessed: 0,
          emailsSent: 0,
          errors: [],
        };

        // Smart notification logic for zero-device sessions
        let healthCheckDecision: {
          shouldSend: boolean;
          consecutiveZeroSessions: number;
          lastHealthCheckHours: number;
          reason: string;
        } | null = null;

        if (triggerSource === "scheduled_hourly") {
          healthCheckDecision =
            await MonitoringSessionTracker.shouldSendHealthCheck();

          if (healthCheckDecision.shouldSend) {
            try {
              const sessionStats =
                await MonitoringSessionTracker.getSessionStats();
              const sessionDuration = Date.now() - sessionStartTime;

              await notifyMonitoringHealthCheck({
                sessionId,
                consecutiveZeroSessions:
                  healthCheckDecision.consecutiveZeroSessions,
                hoursSinceLastNotification:
                  healthCheckDecision.lastHealthCheckHours,
                totalMonitoringSessions: sessionStats.totalSessions,
                lastActivityTimestamp: sessionStats.lastActivityTimestamp,
                averageDevicesPerSession: sessionStats.averageDevicesPerSession,
                systemStatus:
                  healthCheckDecision.lastHealthCheckHours === Infinity
                    ? "idle"
                    : "healthy",
                triggerReason: healthCheckDecision.reason,
                timestamp: new Date(),
              });

              notificationSent = true;
              notificationType = "HEALTH_CHECK";
              notificationReason = healthCheckDecision.reason;
              monitorLog.success(
                `Health check notification sent [${sessionId}] - ${healthCheckDecision.reason}`
              );
            } catch (notificationError) {
              monitorLog.error(
                `Failed to send health check notification [${sessionId}]`,
                notificationError
              );
              notificationReason = `Health check notification failed: ${notificationError}`;
            }
          } else {
            notificationType = "NONE";
            notificationReason = healthCheckDecision.reason;
            monitorLog.info(
              `No notification sent [${sessionId}] - ${healthCheckDecision.reason}`
            );
          }
        } else {
          notificationType = "NONE";
          notificationReason =
            "Manual/non-scheduled trigger - no auto-notification";
          monitorLog.info(
            `No notification for non-scheduled trigger [${sessionId}] - ${triggerSource}`
          );
        }

        // Record session in database
        try {
          const sessionDuration = Date.now() - sessionStartTime;
          await MonitoringSessionTracker.createSession({
            session_id: sessionId,
            timestamp: new Date(sessionStartTime),
            duration_ms: sessionDuration,
            trigger_source: triggerSource,
            devices_found: 0,
            devices_processed: 0,
            success_count: 0,
            fail_count: 0,
            emails_sent: 0,
            notification_sent: notificationSent,
            notification_type: notificationType,
            notification_reason: notificationReason,
            errors: [],
            config: this.config,
          });

          monitorLog.success(
            `Session recorded [${sessionId}] - No devices found`
          );
        } catch (dbError) {
          monitorLog.error(`Failed to record session [${sessionId}]`, dbError);
        }

        return result;
      }

      monitorLog.success(
        `Found ${newlyEligible.length} eligible devices [${sessionId}]`
      );

      // Group devices by email for consolidated processing
      const devicesByEmail = newlyEligible.reduce<Record<string, any[]>>(
        (acc, device) => {
          const email = (device.email || "").trim().toLowerCase();
          if (!email) return acc;
          if (!acc[email]) acc[email] = [];
          acc[email].push(device);
          return acc;
        },
        {}
      );

      monitorLog.info(`Grouped devices by email [${sessionId}]`, {
        uniqueEmails: Object.keys(devicesByEmail).length,
        emailBreakdown: Object.entries(devicesByEmail).map(
          ([email, devices]) => ({
            email: redactEmail(email),
            deviceCount: devices.length,
          })
        ),
      });

      // --- ADMIN NOTIFICATION FOR ELIGIBLE DEVICES DISCOVERED ---
      try {
        const devicesByNodeType = newlyEligible.reduce<Record<string, number>>(
          (acc, device) => {
            const nodeType =
              ELIGIBLE_NODE_TYPES.find((type) => device.name?.includes(type)) ||
              "Unknown";
            acc[nodeType] = (acc[nodeType] || 0) + 1;
            return acc;
          },
          {}
        );

        await notifyEligibleDevicesDiscovered({
          sessionId,
          triggerSource: this.config.dryRun
            ? "Manual Monitoring (Dry Run)"
            : "Automated Monitoring",
          totalEligibleDevices: newlyEligible.length,
          uniqueEmails: Object.keys(devicesByEmail).length,
          devicesByEmail: Object.entries(devicesByEmail).map(
            ([email, devices]) => ({
              email: redactEmail(email),
              deviceCount: devices.length,
              devices: devices.map((d) => ({
                id: d._id.toString(),
                name: d.name,
                order: d.order,
              })),
            })
          ),
          devicesByNodeType,
          timestamp: new Date(),
        });

        monitorLog.success(
          `Admin notified of eligible devices discovery [${sessionId}]`
        );
      } catch (notificationError) {
        monitorLog.error(
          `Failed to send eligible devices discovery notification [${sessionId}]`,
          notificationError
        );
        // Don't throw here - this shouldn't block the main process
      }

      // Apply email filter if provided and not empty
      const hasValidEmailFilter =
        this.config.emailFilter &&
        Array.isArray(this.config.emailFilter) &&
        this.config.emailFilter.length > 0 &&
        this.config.emailFilter.some((email) => email.trim().length > 0);

      const emailsToProcess = hasValidEmailFilter
        ? Object.keys(devicesByEmail).filter((email) =>
            this.config.emailFilter!.some((filterEmail) =>
              email.toLowerCase().includes(filterEmail.toLowerCase())
            )
          )
        : Object.keys(devicesByEmail);

      if (hasValidEmailFilter) {
        monitorLog.info(`Email filter applied [${sessionId}]`, {
          filter: this.config.emailFilter,
          originalEmailCount: Object.keys(devicesByEmail).length,
          filteredEmailCount: emailsToProcess.length,
        });

        if (emailsToProcess.length === 0) {
          monitorLog.warning(`No devices match email filter [${sessionId}]`, {
            filter: this.config.emailFilter,
            availableEmails: Object.keys(devicesByEmail).map((email) =>
              redactEmail(email)
            ),
          });
          return {
            successCount: 0,
            failCount: 0,
            processedEmails: [],
            totalDevicesProcessed: 0,
            emailsSent: 0,
            errors: [],
          };
        }
      } else {
        monitorLog.info(
          `No email filter applied - processing all eligible emails [${sessionId}]`,
          {
            totalEmailsToProcess: emailsToProcess.length,
          }
        );
      }

      // Process each email group
      for (const email of emailsToProcess) {
        const devices = devicesByEmail[email];
        const emailSessionId = `${sessionId}_${email.substring(0, 5)}`;

        monitorLog.info(`Processing email group [${emailSessionId}]`, {
          email: redactEmail(email),
          deviceCount: devices.length,
          devices: devices.map((d) => ({
            id: d._id,
            name: d.name,
            order: d.order,
          })),
        });

        if (this.config.dryRun) {
          monitorLog.info(
            `DRY RUN: Would process ${devices.length} devices for ${redactEmail(
              email
            )} [${emailSessionId}]`
          );
          successCount += devices.length;
          processedEmails.push(email);
          continue;
        }

        const createdDeviceIds: any[] = [];

        // Generate AEM keys for each device
        for (const device of devices) {
          try {
            monitorLog.info(
              `Generating AEM key for device [${emailSessionId}]`,
              {
                deviceId: device._id,
                deviceName: device.name,
                order: device.order,
              }
            );

            const result = await generateAIMinerKey(device);

            if (result.success && result.aiMinerDevice?._id) {
              successCount++;
              createdDeviceIds.push(result.aiMinerDevice._id);
              monitorLog.success(
                `AEM key generated successfully [${emailSessionId}]`,
                {
                  originalDeviceId: device._id,
                  newAEMDeviceId: result.aiMinerDevice._id,
                  parentAssigned: !!result.parentDevice,
                }
              );
            } else {
              failCount++;
              const errorMsg = result.message || "Unknown generation error";
              errors.push({
                deviceId: device._id.toString(),
                email: redactEmail(email),
                error: errorMsg,
              });
              monitorLog.error(
                `AEM key generation failed [${emailSessionId}]`,
                {
                  deviceId: device._id,
                  error: errorMsg,
                }
              );
            }
          } catch (error) {
            failCount++;
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            errors.push({
              deviceId: device._id.toString(),
              email: redactEmail(email),
              error: errorMsg,
            });
            monitorLog.error(
              `Exception during AEM generation [${emailSessionId}]`,
              {
                deviceId: device._id,
                error: errorMsg,
              }
            );
          }

          // Rate limiting between device processing
          if (this.config.rateLimit! > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.rateLimit)
            );
          }
        }

        // Send consolidated email if any keys were created
        let emailSuccess = false;
        if (createdDeviceIds.length > 0) {
          try {
            const createdChildren = await DeviceModel.find({
              _id: { $in: createdDeviceIds },
            })
              .select(
                "_id miner_key parent_device_id parent_device_name parent_device_miner_key"
              )
              .lean();

            const emailKeys = createdChildren.map((device) => ({
              key: device.miner_key,
              name: "$FRY AI Edge Miner",
              parentDeviceName: (device as any).parent_device_name,
              parentDeviceKey: (device as any).parent_device_miner_key,
            }));

            monitorLog.info(`Sending consolidated email [${emailSessionId}]`, {
              email: redactEmail(email),
              keyCount: emailKeys.length,
            });

            await sendMail(email, emailKeys);
            emailSuccess = true;

            // Mark emails as sent
            await DeviceModel.updateMany(
              { _id: { $in: createdDeviceIds } },
              {
                $set: {
                  email_sent: true,
                  email_sent_at: new Date(),
                },
              }
            );

            processedEmails.push(email);
            monitorLog.success(
              `Consolidated email sent successfully [${emailSessionId}]`,
              {
                email: redactEmail(email),
                keyCount: emailKeys.length,
              }
            );

            // --- ADMIN NOTIFICATION FOR AI MINER GENERATION ---
            try {
              const parentAssignments = createdChildren
                .filter((child) => child.parent_device_id)
                .map((child) => ({
                  childId: child._id.toString(),
                  parentId: child.parent_device_id!.toString(),
                  parentName: child.parent_device_name || "Unknown",
                }));

              await notifyAIKeyGeneration({
                type: "ai_monitoring",
                triggerSource: this.config.dryRun
                  ? "Manual Monitoring (Dry Run)"
                  : "Automated Monitoring",
                userEmail: email,
                keysGenerated: emailKeys.map((k) => ({
                  key: k.key,
                  name: k.name,
                  type: "AI Edge Miner",
                })),
                parentAssignments,
                success: emailSuccess,
                error: emailSuccess ? undefined : "Email delivery failed",
                timestamp: new Date(),
                requestId: emailSessionId,
              });

              monitorLog.success(
                `Admin notification sent for AI key generation [${emailSessionId}]`
              );
            } catch (notificationError) {
              monitorLog.error(
                `Failed to send admin notification [${emailSessionId}]`,
                notificationError
              );
              // Don't throw here - this shouldn't block the main process
            }
          } catch (emailError) {
            monitorLog.error(
              `Failed to send consolidated email [${emailSessionId}]`,
              {
                email: redactEmail(email),
                error: emailError,
              }
            );

            // Still send admin notification for failed email
            try {
              await notifyAIKeyGeneration({
                type: "ai_monitoring",
                triggerSource: this.config.dryRun
                  ? "Manual Monitoring (Dry Run)"
                  : "Automated Monitoring",
                userEmail: email,
                keysGenerated: createdDeviceIds.map(() => ({
                  key: "KEY_GENERATED_EMAIL_FAILED",
                  name: "$FRY AI Edge Miner",
                  type: "AI Edge Miner",
                })),
                success: false,
                error: `Email delivery failed: ${
                  emailError instanceof Error
                    ? emailError.message
                    : String(emailError)
                }`,
                timestamp: new Date(),
                requestId: emailSessionId,
              });
            } catch (notificationError) {
              monitorLog.error(
                `Failed to send admin notification for email failure [${emailSessionId}]`,
                notificationError
              );
            }
          }
        }

        processedEmails.push(email);
      }

      const result: MonitoringResult = {
        successCount,
        failCount,
        processedEmails,
        totalDevicesProcessed: newlyEligible.length,
        emailsSent: processedEmails.length,
        errors,
      };

      monitorLog.success(`Monitoring session completed [${sessionId}]`, result);

      // Smart notification logic for activity sessions
      const activityNotification =
        MonitoringSessionTracker.shouldSendActivityNotification(
          result.totalDevicesProcessed,
          result.successCount
        );

      if (activityNotification.shouldSend) {
        try {
          const sessionDuration = Date.now() - sessionStartTime;
          await notifyMonitoringComplete({
            sessionId,
            totalEligibleDevices: result.totalDevicesProcessed,
            successCount: result.successCount,
            failCount: result.failCount,
            processedEmails: result.processedEmails,
            emailsSent: result.emailsSent,
            errors: result.errors,
            duration: sessionDuration,
            timestamp: new Date(),
            triggerSource:
              triggerSource === "scheduled_hourly"
                ? "Automated Monitoring"
                : "Manual Monitoring",
          });

          notificationSent = true;
          notificationType = "ACTIVITY";
          notificationReason = activityNotification.reason;
          monitorLog.success(
            `Activity notification sent [${sessionId}] - ${activityNotification.reason}`
          );
        } catch (notificationError) {
          monitorLog.error(
            `Failed to send activity notification [${sessionId}]`,
            notificationError
          );
          notificationReason = `Activity notification failed: ${notificationError}`;
        }
      } else {
        notificationType = "NONE";
        notificationReason = activityNotification.reason;
        monitorLog.info(
          `No notification sent [${sessionId}] - ${activityNotification.reason}`
        );
      }

      // Record session in database
      try {
        const sessionDuration = Date.now() - sessionStartTime;
        await MonitoringSessionTracker.createSession({
          session_id: sessionId,
          timestamp: new Date(sessionStartTime),
          duration_ms: sessionDuration,
          trigger_source: triggerSource,
          devices_found: result.totalDevicesProcessed,
          devices_processed: result.totalDevicesProcessed,
          success_count: result.successCount,
          fail_count: result.failCount,
          emails_sent: result.emailsSent,
          notification_sent: notificationSent,
          notification_type: notificationType,
          notification_reason: notificationReason,
          errors: result.errors.map((e) => ({
            device_id: e.deviceId,
            email: e.email,
            error: e.error,
          })),
          config: this.config,
        });

        monitorLog.success(
          `Session recorded [${sessionId}] - Activity processed`
        );
      } catch (dbError) {
        monitorLog.error(`Failed to record session [${sessionId}]`, dbError);
      }

      return result;
    } catch (error) {
      monitorLog.error(`Monitoring session failed [${sessionId}]`, error);
      throw error;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    monitorLog.info("Configuration updated", this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): MonitoringConfig {
    return { ...this.config };
  }

  /**
   * Get monitoring statistics without processing
   */
  async getEligibilityStats(): Promise<EligibilityStats> {
    const eligibilityQuery = {
      $or: ELIGIBLE_NODE_TYPES.map((type) => ({
        name: {
          $regex: type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      })),
      "registration.amount": { $gt: 0 },
      "node.amount": { $gt: 0 },
      is_registered: true,
      ai_miner_generated: false,
      order: { $lt: ORDER_NUMBER_CUTOFF.toString() },
      email: { $exists: true, $ne: "" },
    };

    const eligibleDevices = await DeviceModel.find(eligibilityQuery)
      .select("name email")
      .lean();

    const devicesByEmail = eligibleDevices.reduce<Record<string, number>>(
      (acc, device: any) => {
        const email = (device.email || "").trim().toLowerCase();
        if (!email) return acc;
        acc[email] = (acc[email] || 0) + 1;
        return acc;
      },
      {}
    );

    const devicesByNodeType = eligibleDevices.reduce<Record<string, number>>(
      (acc, device: any) => {
        const nodeType =
          ELIGIBLE_NODE_TYPES.find((type) => device.name?.includes(type)) ||
          "Unknown";
        acc[nodeType] = (acc[nodeType] || 0) + 1;
        return acc;
      },
      {}
    );

    return {
      totalEligibleDevices: eligibleDevices.length,
      uniqueEmails: Object.keys(devicesByEmail).length,
      devicesByNodeType,
      devicesByEmail: Object.fromEntries(
        Object.entries(devicesByEmail).map(([email, count]) => [
          redactEmail(email),
          count,
        ])
      ),
    };
  }
}

/**
 * Default monitoring service instance
 */
export const defaultMonitoringService = new AIMinerMonitoringService();

/**
 * Main export function for backward compatibility with cron job
 */
export async function monitorNewRegistrationsAndGenerateAIMinersAtomic(
  triggerSource: "scheduled_hourly" | "manual" = "scheduled_hourly"
): Promise<{ successCount: number; failCount: number }> {
  const result =
    await defaultMonitoringService.monitorNewRegistrationsAndGenerateAIMiners(
      triggerSource
    );
  return {
    successCount: result.successCount,
    failCount: result.failCount,
  };
}
