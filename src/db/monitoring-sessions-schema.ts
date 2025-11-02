import mongoose from "mongoose";
import { MonitoringConfig } from "../services/monitoring-types.js";

export interface IMonitoringSession {
  _id: mongoose.Types.ObjectId;
  session_id: string;
  timestamp: Date;
  duration_ms: number;
  trigger_source: "scheduled_hourly" | "manual" | "webhook" | "startup";

  // Results
  devices_found: number;
  devices_processed: number;
  success_count: number;
  fail_count: number;
  emails_sent: number;

  // Notification tracking
  notification_sent: boolean;
  notification_type: "ACTIVITY" | "HEALTH_CHECK" | "NONE";
  notification_reason: string;

  // Optional metadata
  errors?: Array<{
    device_id: string;
    email: string;
    error: string;
  }>;
  config?: Partial<MonitoringConfig>;

  created_at: Date;
}

const monitoringSessionSchema = new mongoose.Schema<IMonitoringSession>({
  session_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  timestamp: {
    type: Date,
    required: true,
    index: true,
  },
  duration_ms: {
    type: Number,
    required: true,
  },
  trigger_source: {
    type: String,
    enum: ["scheduled_hourly", "manual", "webhook", "startup"],
    required: true,
    index: true,
  },

  // Results
  devices_found: {
    type: Number,
    required: true,
    default: 0,
  },
  devices_processed: {
    type: Number,
    required: true,
    default: 0,
  },
  success_count: {
    type: Number,
    required: true,
    default: 0,
  },
  fail_count: {
    type: Number,
    required: true,
    default: 0,
  },
  emails_sent: {
    type: Number,
    required: true,
    default: 0,
  },

  // Notification tracking
  notification_sent: {
    type: Boolean,
    required: true,
    default: false,
    index: true,
  },
  notification_type: {
    type: String,
    enum: ["ACTIVITY", "HEALTH_CHECK", "NONE"],
    required: true,
  },
  notification_reason: {
    type: String,
    required: true,
  },

  // Optional metadata
  errors: [
    {
      device_id: { type: String, required: true },
      email: { type: String, required: true },
      error: { type: String, required: true },
    },
  ],
  config: {
    type: mongoose.Schema.Types.Mixed,
  },

  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Indexes for efficient queries
monitoringSessionSchema.index({ trigger_source: 1, timestamp: -1 });
monitoringSessionSchema.index({ notification_sent: 1, timestamp: -1 });
monitoringSessionSchema.index({ timestamp: -1 });

// TTL index to automatically delete old sessions after 90 days
monitoringSessionSchema.index(
  { created_at: 1 },
  { expireAfterSeconds: 7776000 }
);

export const MonitoringSessionModel = mongoose.model<IMonitoringSession>(
  "MonitoringSession",
  monitoringSessionSchema
);

/**
 * Utility functions for monitoring session tracking
 */
export class MonitoringSessionTracker {
  /**
   * Create a new monitoring session record
   */
  static async createSession(
    sessionData: Omit<IMonitoringSession, "_id" | "created_at">
  ): Promise<IMonitoringSession> {
    const session = new MonitoringSessionModel({
      ...sessionData,
      created_at: new Date(),
    });

    return await session.save();
  }

  /**
   * Check if we should send a health check notification
   * Returns true if the last 8 scheduled hourly sessions had 0 devices found
   */
  static async shouldSendHealthCheck(): Promise<{
    shouldSend: boolean;
    consecutiveZeroSessions: number;
    lastHealthCheckHours: number;
    reason: string;
  }> {
    // Get last 8 scheduled hourly sessions
    const recentSessions = await MonitoringSessionModel.find({
      trigger_source: "scheduled_hourly",
    })
      .sort({ timestamp: -1 })
      .limit(8)
      .lean();

    if (recentSessions.length < 8) {
      return {
        shouldSend: false,
        consecutiveZeroSessions: recentSessions.length,
        lastHealthCheckHours: 0,
        reason: `Only ${recentSessions.length} scheduled sessions found, need 8 for health check`,
      };
    }

    // Check if all recent sessions had 0 devices
    const allZeroActivity = recentSessions.every((s) => s.devices_found === 0);

    if (!allZeroActivity) {
      const lastActivitySession = recentSessions.find(
        (s) => s.devices_found > 0
      );
      const activeSessions = recentSessions.filter(
        (s) => s.devices_found > 0
      ).length;
      return {
        shouldSend: false,
        consecutiveZeroSessions: recentSessions.length - activeSessions,
        lastHealthCheckHours: 0,
        reason: `Activity found in recent sessions (${activeSessions} sessions had devices)`,
      };
    }

    // Check when we last sent any notification
    const lastNotification = await MonitoringSessionModel.findOne({
      notification_sent: true,
      trigger_source: "scheduled_hourly",
    })
      .sort({ timestamp: -1 })
      .lean();

    if (!lastNotification) {
      return {
        shouldSend: true,
        consecutiveZeroSessions: 8,
        lastHealthCheckHours: Infinity,
        reason: "No previous notifications found, sending health check",
      };
    }

    const hoursSinceLastNotification =
      (Date.now() - lastNotification.timestamp.getTime()) / (1000 * 60 * 60);

    // Send health check if it's been more than 8 hours since last notification
    if (hoursSinceLastNotification >= 8) {
      return {
        shouldSend: true,
        consecutiveZeroSessions: 8,
        lastHealthCheckHours: hoursSinceLastNotification,
        reason: `${hoursSinceLastNotification.toFixed(
          1
        )} hours since last notification, time for health check`,
      };
    }

    return {
      shouldSend: false,
      consecutiveZeroSessions: 8,
      lastHealthCheckHours: hoursSinceLastNotification,
      reason: `Only ${hoursSinceLastNotification.toFixed(
        1
      )} hours since last notification, waiting for 8 hours`,
    };
  }

  /**
   * Check if we should send an activity notification
   */
  static shouldSendActivityNotification(
    devicesFound: number,
    successCount: number
  ): {
    shouldSend: boolean;
    reason: string;
  } {
    if (devicesFound === 0) {
      return {
        shouldSend: false,
        reason: "No devices found, no activity notification needed",
      };
    }

    if (successCount === 0 && devicesFound > 0) {
      return {
        shouldSend: true,
        reason:
          "Devices found but all failed processing - admin should be notified",
      };
    }

    return {
      shouldSend: true,
      reason: "Activity detected - admin notification required",
    };
  }

  /**
   * Get monitoring session statistics for debugging
   */
  static async getSessionStats(): Promise<{
    totalSessions: number;
    last24Hours: number;
    averageDevicesPerSession: number;
    lastActivityTimestamp: Date | null;
    recentHealthChecks: number;
  }> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalSessions, recent24h, lastActivity, recentHealthChecks] =
      await Promise.all([
        MonitoringSessionModel.countDocuments(),
        MonitoringSessionModel.countDocuments({
          timestamp: { $gte: last24Hours },
        }),
        MonitoringSessionModel.findOne({ devices_found: { $gt: 0 } })
          .sort({ timestamp: -1 })
          .lean(),
        MonitoringSessionModel.countDocuments({
          notification_type: "HEALTH_CHECK",
          timestamp: {
            $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);

    const allSessions = await MonitoringSessionModel.find()
      .select("devices_found")
      .lean();
    const totalDevices = allSessions.reduce(
      (sum, s) => sum + s.devices_found,
      0
    );
    const averageDevicesPerSession =
      allSessions.length > 0 ? totalDevices / allSessions.length : 0;

    return {
      totalSessions,
      last24Hours: recent24h,
      averageDevicesPerSession:
        Math.round(averageDevicesPerSession * 100) / 100,
      lastActivityTimestamp: lastActivity?.timestamp || null,
      recentHealthChecks,
    };
  }
}
