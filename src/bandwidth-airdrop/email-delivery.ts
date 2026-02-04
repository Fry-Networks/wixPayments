import { sendMail } from "../MailProcessor.js";
import type { MailCustomizationOptions } from "../MailProcessor.js";
import { logger } from "./logger.js";
import { redactEmail } from "../redact-utils.js";

type MailKeyDescriptor = Parameters<typeof sendMail>[1][number];

type GmailSendSettings = {
  perRecipientDelayMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

const toInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
};

function getSettings(): GmailSendSettings {
  const perRecipientDelayMs =
    toInt(process.env.BANDWIDTH_AIRDROP_GMAIL_DELAY_MS) ?? 1100;
  const maxRetries = toInt(process.env.BANDWIDTH_AIRDROP_GMAIL_MAX_RETRIES) ?? 6;
  const baseBackoffMs =
    toInt(process.env.BANDWIDTH_AIRDROP_GMAIL_BACKOFF_BASE_MS) ?? 2000;
  const maxBackoffMs =
    toInt(process.env.BANDWIDTH_AIRDROP_GMAIL_BACKOFF_MAX_MS) ?? 60000;

  return {
    perRecipientDelayMs: Math.max(0, perRecipientDelayMs),
    maxRetries: Math.max(0, maxRetries),
    baseBackoffMs: Math.max(0, baseBackoffMs),
    maxBackoffMs: Math.max(0, maxBackoffMs),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHttpCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const anyError = error as any;
  if (typeof anyError.code === "number") return anyError.code;
  if (typeof anyError.response?.status === "number") return anyError.response.status;
  return undefined;
}

function getGmailReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const anyError = error as any;
  const reason =
    anyError?.response?.data?.error?.errors?.[0]?.reason ||
    anyError?.response?.data?.error?.status ||
    anyError?.errors?.[0]?.reason;
  return typeof reason === "string" ? reason : undefined;
}

function isRetryableGmailError(error: unknown): boolean {
  const code = getHttpCode(error);
  if (code === 429) return true;
  if (code && code >= 500 && code <= 599) return true;

  if (code === 403) {
    const reason = (getGmailReason(error) || "").toLowerCase();
    if (
      reason.includes("rate") ||
      reason.includes("quota") ||
      reason.includes("user")
    ) {
      return true;
    }
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("temporarily") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

function computeBackoffMs(
  attempt: number,
  settings: GmailSendSettings
): number {
  const exp = Math.min(10, attempt);
  const base = settings.baseBackoffMs * 2 ** exp;
  const capped = Math.min(settings.maxBackoffMs, base);
  const jitter = Math.floor(Math.random() * 250);
  return capped + jitter;
}

export async function sendBandwidthAirdropEmail(
  to: string,
  keys: MailKeyDescriptor[],
  customization: MailCustomizationOptions,
  options?: { skipInitialDelay?: boolean }
): Promise<void> {
  const settings = getSettings();
  const startDelay = settings.perRecipientDelayMs;
  if (!options?.skipInitialDelay && startDelay > 0) {
    await sleep(startDelay);
  }

  let attempt = 0;
  while (true) {
    try {
      await sendMail(to, keys, customization);
      return;
    } catch (error) {
      attempt += 1;
      const retryable = isRetryableGmailError(error);
      const code = getHttpCode(error);
      const reason = getGmailReason(error);

      if (!retryable || attempt > settings.maxRetries) {
        logger.error(
          `Gmail send failed (attempt ${attempt}${code ? `, HTTP ${code}` : ""}${
            reason ? `, reason ${reason}` : ""
          })`,
          error
        );
        throw error;
      }

      const backoffMs = computeBackoffMs(attempt - 1, settings);
      logger.warn(
        `Gmail rate/temporary error (attempt ${attempt}${
          code ? `, HTTP ${code}` : ""
        }${reason ? `, reason ${reason}` : ""}); retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
}

type BatchSettings = {
  batchSize: number;
  delayBetweenBatchesMs: number;
};

function getBatchSettings(): BatchSettings {
  const batchSize = toInt(process.env.BANDWIDTH_AIRDROP_EMAIL_BATCH_SIZE) ?? 20;
  const delayBetweenBatchesMs =
    toInt(process.env.BANDWIDTH_AIRDROP_EMAIL_DELAY_BETWEEN_BATCHES_MS) ??
    15000;
  return {
    batchSize: Math.max(1, batchSize),
    delayBetweenBatchesMs: Math.max(0, delayBetweenBatchesMs),
  };
}

export type BatchFailureDecision = "retry" | "skip" | "abort" | "fail";

export async function sendBandwidthAirdropEmailsBatch(
  items: Array<{
    to: string;
    keys: MailKeyDescriptor[];
    customization: MailCustomizationOptions;
    afterSuccess?: () => Promise<void>;
  }>,
  options?: {
    onFailure?: (
      email: string,
      error: unknown
    ) => Promise<BatchFailureDecision>;
  }
): Promise<{
  sentRecipients: number;
  sentKeys: number;
  failedRecipients: string[];
  skippedRecipients: string[];
  aborted: boolean;
}> {
  const settings = getBatchSettings();
  const failedRecipients: string[] = [];
  const skippedRecipients: string[] = [];
  let sentRecipients = 0;
  let sentKeys = 0;
  let aborted = false;

  const totalBatches = Math.ceil(items.length / settings.batchSize);
  for (let i = 0; i < items.length; i += settings.batchSize) {
    const batch = items.slice(i, i + settings.batchSize);
    const currentBatch = Math.floor(i / settings.batchSize) + 1;
    logger.info(
      `Sending BM airdrop emails batch ${currentBatch}/${totalBatches} (${batch.length} recipients)`
    );

    for (const item of batch) {
      const { to, keys, customization, afterSuccess } = item;
      try {
        await sendBandwidthAirdropEmail(to, keys, customization);
        if (afterSuccess) {
          await afterSuccess();
        }
        sentRecipients += 1;
        sentKeys += keys.length;
      } catch (error) {
        const decide = options?.onFailure
          ? await options.onFailure(to, error)
          : ("fail" as const);

        if (decide === "retry") {
          try {
            await sendBandwidthAirdropEmail(to, keys, customization, {
              skipInitialDelay: true,
            });
            if (afterSuccess) {
              await afterSuccess();
            }
            sentRecipients += 1;
            sentKeys += keys.length;
          } catch (retryError) {
            failedRecipients.push(to);
            logger.error(`Retry failed for ${redactEmail(to)}`, retryError);
          }
        } else if (decide === "abort") {
          aborted = true;
          break;
        } else if (decide === "fail") {
          failedRecipients.push(to);
        } else {
          skippedRecipients.push(to);
        }
      }
    }

    if (aborted) break;
    if (i + settings.batchSize < items.length && settings.delayBetweenBatchesMs) {
      await sleep(settings.delayBetweenBatchesMs);
    }
  }

  return {
    sentRecipients,
    sentKeys,
    failedRecipients,
    skippedRecipients,
    aborted,
  };
}
