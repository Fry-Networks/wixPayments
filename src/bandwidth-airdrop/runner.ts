import { DeviceModel } from "../db/devices-schema.js";
import { generateMinerKey } from "../db/utils.js";
import { logger } from "./logger.js";
import {
  BANDWIDTH_MINER_INTERNAL_NAME,
  BANDWIDTH_MINER_PREFIX,
} from "./constants.js";
import type { AwardPlanEntry, MintedKey, NormalizedOrder } from "./types.js";
import { buildBandwidthAirdropEmailCopy } from "./email-copy.js";
import { sortKeysByOrderNumber } from "./email-utils.js";
import {
  sendBandwidthAirdropEmailsBatch,
  type BatchFailureDecision,
} from "./email-delivery.js";
import { redactEmail } from "../redact-utils.js";

interface QueuedKey {
  key: string;
  name: string;
  deviceId?: string;
  sourceOrderNumber?: string;
  sourceOrderDate?: string;
}

export interface ExecutionResult {
  createdDevices: number;
  skippedDevices: number;
  emailsSent: number;
  emailFailures: number;
  emailSkips: number;
  emailAborted: boolean;
  errors: Array<{ order: string; email: string; error: string }>;
  emailBreakdown: Record<string, number>;
  mintedKeys: MintedKey[];
}

export interface EmailOnlyResult {
  emailsSent: number;
  emailFailures: number;
  emailSkips: number;
  emailAborted: boolean;
  sentKeys: number;
  errors: Array<{ email: string; error: string }>;
  emailBreakdown: Record<string, number>;
}

export async function sendEmailsForEligibleOrders(
  eligibleOrders: NormalizedOrder[],
  options?: {
    onEmailFailure?: (
      email: string,
      error: unknown
    ) => Promise<BatchFailureDecision>;
  }
): Promise<EmailOnlyResult> {
  const eligiblePairs = new Set(
    eligibleOrders.map(
      (order) => `${order.number}||${order.buyerEmail.toLowerCase()}`
    )
  );
  const uniqueOrders = [
    ...new Set(eligibleOrders.map((order) => order.number).filter(Boolean)),
  ];
  const uniqueEmails = [
    ...new Set(
      eligibleOrders
        .map((order) => order.buyerEmail.toLowerCase())
        .filter(Boolean)
    ),
  ];

  const metaByPair = new Map<
    string,
    { nodesPurchased: number; sourceOrderDate?: string }
  >(
    eligibleOrders.map((order) => [
      `${order.number}||${order.buyerEmail.toLowerCase()}`,
      {
        nodesPurchased: order.nodesPurchased,
        sourceOrderDate: order.createdDate
          ? order.createdDate.toISOString()
          : undefined,
      },
    ])
  );

  const errors: EmailOnlyResult["errors"] = [];
  const emailBreakdown: Record<string, number> = {};
  let emailSkips = 0;

  if (!uniqueOrders.length || !uniqueEmails.length) {
    return {
      emailsSent: 0,
      emailFailures: 0,
      emailSkips: 0,
      emailAborted: false,
      sentKeys: 0,
      errors: [],
      emailBreakdown: {},
    };
  }

  // Only pick BM airdrop-generated keys that have not yet been emailed.
  const pendingDevices = await DeviceModel.find({
    name: BANDWIDTH_MINER_INTERNAL_NAME,
    airdrop_source_order: { $in: uniqueOrders },
    email: { $in: uniqueEmails },
    // Only email keys created by the airdrop flow (new docs set `email_sent: false`);
    // avoid re-emailing older BM devices that lack `email_sent` entirely.
    email_sent: { $exists: true, $eq: false },
  })
    .select(
      "_id miner_key name email airdrop_source_order airdrop_source_order_date created_at"
    )
    .lean();

  const pendingByEmail = pendingDevices.reduce<Record<string, any[]>>(
    (acc, device: any) => {
      const email = (device.email || "").trim().toLowerCase();
      const orderNumber = (device.airdrop_source_order || "").toString();
      if (!email || !orderNumber) return acc;
      if (!eligiblePairs.has(`${orderNumber}||${email}`)) return acc;
      if (!acc[email]) acc[email] = [];
      acc[email].push(device);
      return acc;
    },
    {}
  );

  const items: Array<{
    to: string;
    keys: Array<{
      key: string;
      name: string;
      sourceOrderNumber?: string;
      sourceOrderDate?: string;
    }>;
    customization: ReturnType<typeof buildBandwidthAirdropEmailCopy>;
    afterSuccess: () => Promise<void>;
  }> = [];

  for (const [email, devices] of Object.entries(pendingByEmail)) {
    const queuedKeys = devices.map((device: any) => {
      const orderNumber = (device.airdrop_source_order || "").toString();
      const pairKey = `${orderNumber}||${email}`;
      const meta = metaByPair.get(pairKey);
      const sourceOrderDate =
        meta?.sourceOrderDate ||
        (device.airdrop_source_order_date
          ? new Date(device.airdrop_source_order_date).toISOString()
          : device.created_at
          ? new Date(device.created_at).toISOString()
          : undefined);
      return {
        key: device.miner_key,
        name: device.name || BANDWIDTH_MINER_INTERNAL_NAME,
        deviceId: device._id.toString(),
        sourceOrderNumber: orderNumber,
        sourceOrderDate,
      };
    });

    const sortedKeys = sortKeysByOrderNumber(queuedKeys);
    const ids = sortedKeys.map((k) => k.deviceId).filter(Boolean) as string[];
    const uniqueOrderNumbers = [
      ...new Set(sortedKeys.map((k) => k.sourceOrderNumber).filter(Boolean)),
    ] as string[];
    const totalNodes = uniqueOrderNumbers.reduce((sum, orderNumber) => {
      const meta = metaByPair.get(`${orderNumber}||${email}`);
      return sum + (meta?.nodesPurchased || 0);
    }, 0);
    const totalKeys = sortedKeys.length;
    const customization = buildBandwidthAirdropEmailCopy({
      totalNodes: totalNodes || totalKeys,
      totalKeys,
    });

    items.push({
      to: email,
      keys: sortedKeys.map((k) => ({
        key: k.key,
        name: k.name,
        sourceOrderNumber: k.sourceOrderNumber,
        sourceOrderDate: k.sourceOrderDate,
      })),
      customization,
      afterSuccess: async () => {
        if (!ids.length) return;
        await DeviceModel.updateMany(
          { _id: { $in: ids } },
          { $set: { email_sent: true, email_sent_at: new Date() } }
        );
      },
    });
    emailBreakdown[email] = totalKeys;
  }

  if (!items.length) {
    return {
      emailsSent: 0,
      emailFailures: 0,
      emailSkips,
      emailAborted: false,
      sentKeys: 0,
      errors: [],
      emailBreakdown,
    };
  }

  const batchResult = await sendBandwidthAirdropEmailsBatch(items, {
    onFailure: options?.onEmailFailure,
  });

  for (const email of batchResult.failedRecipients) {
    errors.push({
      email,
      error: "Failed to send BM airdrop email after retries",
    });
  }

  return {
    emailsSent: batchResult.sentRecipients,
    emailFailures: batchResult.failedRecipients.length,
    emailSkips: batchResult.skippedRecipients.length,
    emailAborted: batchResult.aborted,
    sentKeys: batchResult.sentKeys,
    errors,
    emailBreakdown,
  };
}

export async function executeAwardPlan(
  plan: AwardPlanEntry[],
  options: {
    dryRun: boolean;
    skipEmail: boolean;
    onEmailFailure?: (email: string, error: unknown) => Promise<BatchFailureDecision>;
  }
): Promise<ExecutionResult> {
  let createdDevices = 0;
  let skippedDevices = 0;
  let emailsSent = 0;
  let emailFailures = 0;
  let emailSkips = 0;
  let emailAborted = false;
  const errors: ExecutionResult["errors"] = [];
  const emailBreakdown: Record<string, number> = {};
  const mintedKeys: MintedKey[] = [];
  const expectedUnitsToMint = plan.reduce((sum, entry) => {
    const persistEmail = entry.email?.toLowerCase();
    if (!persistEmail) return sum;
    return sum + (entry.units || 0);
  }, 0);
  const emailQueue: Record<
    string,
    {
      email: string;
      entries: AwardPlanEntry[];
      deviceIds: string[];
      totalNodes: number;
      totalKeys: number;
    }
  > = {};

  // Phase 1: Mint everything first (no emails until we know minting succeeded).
  for (const entry of plan) {
    const persistEmail = entry.email?.toLowerCase();
    if (!persistEmail) {
      logger.warn(
        `Skipping order ${entry.orderNumber} due to missing email in award plan`
      );
      skippedDevices += entry.units;
      continue;
    }
    if (options.dryRun) {
      createdDevices += entry.units;
      continue;
    }

    const deliveryEmail = (entry.deliveryEmail || entry.email).toLowerCase();
    if (!emailQueue[deliveryEmail]) {
      emailQueue[deliveryEmail] = {
        email: deliveryEmail,
        entries: [],
        deviceIds: [],
        totalNodes: 0,
        totalKeys: 0,
      };
    }
    const queue = emailQueue[deliveryEmail];
    queue.entries.push(entry);
    const nodesPurchased = entry.metadata?.nodesPurchased ?? entry.units;
    queue.totalNodes += nodesPurchased;
    queue.totalKeys += entry.units;

    for (let i = 0; i < entry.units; i++) {
      try {
        const minerKey = await generateMinerKey(BANDWIDTH_MINER_PREFIX);
        const createdAt = new Date();
        const sourceOrderDate = entry.metadata?.sourceOrderDate
          ? new Date(entry.metadata.sourceOrderDate)
          : undefined;
        const insertResult = await DeviceModel.collection.insertOne({
          miner_key: minerKey,
          name: BANDWIDTH_MINER_INTERNAL_NAME,
          order: entry.orderNumber,
          email: persistEmail,
          created_at: createdAt,
          is_registered: false,
          enabled: false,
          email_sent: false,
          airdrop_source_order: entry.orderNumber,
          airdrop_source_order_date: sourceOrderDate,
        });
        const deviceId = insertResult.insertedId.toString();
        mintedKeys.push({
          deviceId,
          minerKey,
          purchaserEmail: persistEmail,
          deliveryEmail,
          orderNumber: entry.orderNumber,
          createdAt: createdAt.toISOString(),
          sourceOrderDate: entry.metadata?.sourceOrderDate,
        });

        queue.deviceIds.push(deviceId);

        createdDevices += 1;
        emailBreakdown[deliveryEmail] =
          (emailBreakdown[deliveryEmail] || 0) + 1;
      } catch (error) {
        errors.push({
          order: entry.orderNumber,
          email: deliveryEmail,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error(
          `Failed to create Bandwidth Miner for order ${entry.orderNumber}`,
          error
        );
      }
    }
  }

  // Phase 1b: Verify all intended keys exist in Mongo before emailing.
  let mintVerifiedOk = true;
  if (!options.dryRun) {
    if (createdDevices !== mintedKeys.length) {
      // Defensive: these should always match.
      logger.warn("Minted key tracking mismatch", {
        createdDevices,
        mintedKeys: mintedKeys.length,
      });
    }

    if (mintedKeys.length !== expectedUnitsToMint) {
      mintVerifiedOk = false;
      logger.error(
        `Aborting BM airdrop emails: minted ${mintedKeys.length}/${expectedUnitsToMint} keys successfully`
      );
    } else if (mintedKeys.length > 0) {
      const ids = mintedKeys.map((k) => k.deviceId);
      const persisted = await DeviceModel.countDocuments({ _id: { $in: ids } });
      if (persisted !== ids.length) {
        mintVerifiedOk = false;
        logger.error(
          `Aborting BM airdrop emails: expected ${ids.length} minted device records in Mongo, found ${persisted}`
        );
      }
    }
  }

  // Phase 2: Email only after minting fully succeeded and is persisted.
  if (!options.dryRun && !options.skipEmail) {
    emailAborted = !mintVerifiedOk;
    if (emailAborted) {
      emailFailures += Object.keys(emailQueue).length;
      for (const recipient of Object.keys(emailQueue)) {
        errors.push({
          order: "multiple",
          email: recipient,
          error: "Email not attempted because minting did not fully succeed",
        });
      }
      return {
        createdDevices,
        skippedDevices,
        emailsSent,
        emailFailures,
        emailSkips,
        emailAborted,
        errors,
        emailBreakdown,
        mintedKeys,
      };
    }

    const mintedById = new Map(mintedKeys.map((key) => [key.deviceId, key]));

    const items: Array<{
      to: string;
      keys: Array<{ key: string; name: string; sourceOrderNumber?: string; sourceOrderDate?: string }>;
      customization: ReturnType<typeof buildBandwidthAirdropEmailCopy>;
      afterSuccess: () => Promise<void>;
    }> = [];

    for (const queue of Object.values(emailQueue)) {
      const deviceIds = queue.deviceIds.filter(Boolean);
      if (!deviceIds.length) continue;

      // Phase 2 is DB-driven: fetch the keys to email from Mongo using the minted device ids.
      const devices = await DeviceModel.find({ _id: { $in: deviceIds } })
        .select(
          "miner_key name airdrop_source_order airdrop_source_order_date order created_at"
        )
        .lean();
      const keys: QueuedKey[] = devices.map((device: any) => {
        const deviceId = device._id.toString();
        const minted = mintedById.get(deviceId);
        const sourceOrderNumber =
          minted?.orderNumber ||
          device.airdrop_source_order ||
          device.order ||
          undefined;
        const sourceOrderDate =
          minted?.sourceOrderDate ||
          (device.airdrop_source_order_date
            ? new Date(device.airdrop_source_order_date).toISOString()
            : device.created_at
            ? new Date(device.created_at).toISOString()
            : undefined);
        return {
          key: device.miner_key,
          name: device.name || BANDWIDTH_MINER_INTERNAL_NAME,
          deviceId,
          sourceOrderNumber,
          sourceOrderDate,
        };
      });

      const sortedKeys = sortKeysByOrderNumber(keys);
      const payload = sortedKeys.map((k) => ({
        key: k.key,
        name: k.name,
        sourceOrderNumber: k.sourceOrderNumber,
        sourceOrderDate: k.sourceOrderDate,
      }));
      const customization = buildBandwidthAirdropEmailCopy({
        totalNodes: queue.totalNodes,
        totalKeys: queue.totalKeys,
      });
      const ids = sortedKeys.map((k) => k.deviceId).filter(Boolean) as string[];
      items.push({
        to: queue.email,
        keys: payload,
        customization,
        afterSuccess: async () => {
          if (!ids.length) return;
          await DeviceModel.updateMany(
            { _id: { $in: ids } },
            { $set: { email_sent: true, email_sent_at: new Date() } }
          );
        },
      });
    }

    const batchResult = await sendBandwidthAirdropEmailsBatch(items, {
      onFailure: options.onEmailFailure,
    });
    emailsSent += batchResult.sentRecipients;
    emailSkips += batchResult.skippedRecipients.length;
    emailAborted = batchResult.aborted;
    emailFailures += batchResult.failedRecipients.length;

    for (const email of batchResult.failedRecipients) {
      errors.push({
        order: "multiple",
        email,
        error: "Failed to send BM airdrop email after retries",
      });
    }
  }

  return {
    createdDevices,
    skippedDevices,
    emailsSent,
    emailFailures,
    emailSkips,
    emailAborted,
    errors,
    emailBreakdown,
    mintedKeys,
  };
}
