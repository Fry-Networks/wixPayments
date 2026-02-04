import fs from "fs";
import path from "path";

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), "logs");
const LOG_FILE_TEMPLATE = process.env.LOG_FILE;
const LOG_FILE_PREFIX = process.env.LOG_FILE_PREFIX || "wixpayments-";
const LOG_TO_FILE = process.env.LOG_TO_FILE !== "false";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const OBJECT_ID_RE = /\b[0-9a-f]{24}\b/gi;

let fileLoggingAvailable = true;
let warnedFileLogging = false;

function ensureLogDir(): void {
  if (!LOG_TO_FILE || !fileLoggingAvailable) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (error) {
    fileLoggingAvailable = false;
    if (!warnedFileLogging) {
      warnedFileLogging = true;
      // Fall back to console only if we cannot create the directory.
      console.error(
        `[${new Date().toISOString()}] ❌ LOGGING: Failed to ensure log dir ${LOG_DIR}. File logging disabled.`
      );
    }
  }
}

function redactIdsInString(value: string): string {
  return value.replace(UUID_RE, "[redacted-id]").replace(OBJECT_ID_RE, "[redacted-id]");
}

function shouldRedactKey(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  if (lower === "id" || lower === "_id") return true;
  if (lower.includes("id")) {
    if (typeof value === "string" && value.length >= 6) return true;
    if (typeof value === "number") return true;
  }
  return false;
}

function redactValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactIdsInString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      message: value.message ? redactIdsInString(value.message) : undefined,
      stack: value.stack ? redactIdsInString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (shouldRedactKey(key, entry)) {
        result[key] = "[redacted-id]";
      } else {
        result[key] = redactValue(entry);
      }
    }
    return result;
  }
  return value;
}

function sanitizeMessage(message: string): string {
  return redactIdsInString(message);
}

function sanitizeError(error: any): any {
  if (!error) return undefined;
  if (error instanceof Error) {
    const errAny = error as any;
    return {
      message: error.message ? redactIdsInString(error.message) : undefined,
      stack: error.stack ? redactIdsInString(error.stack) : undefined,
      responseData: errAny?.response?.data ? redactValue(errAny.response.data) : undefined,
    };
  }
  if (typeof error === "string") return { message: redactIdsInString(error) };
  if (typeof error === "object") {
    return {
      message: error.message ? redactIdsInString(String(error.message)) : undefined,
      responseData: error?.response?.data ? redactValue(error.response.data) : undefined,
      raw: redactValue(error),
    };
  }
  return { message: String(error) };
}

function resolveLogFile(dateStr: string): string {
  if (LOG_FILE_TEMPLATE) {
    if (LOG_FILE_TEMPLATE.includes("{date}")) {
      return LOG_FILE_TEMPLATE.replace("{date}", dateStr);
    }
    const ext = path.extname(LOG_FILE_TEMPLATE);
    const base = ext
      ? LOG_FILE_TEMPLATE.slice(0, -ext.length)
      : LOG_FILE_TEMPLATE;
    return `${base}-${dateStr}${ext || ".log"}`;
  }
  return path.join(LOG_DIR, `${LOG_FILE_PREFIX}${dateStr}.log`);
}

function writeFileEntry(entry: Record<string, unknown>, timestamp: string): void {
  if (!LOG_TO_FILE || !fileLoggingAvailable) return;
  ensureLogDir();
  if (!fileLoggingAvailable) return;
  try {
    const dateStr = timestamp.slice(0, 10);
    const logFile = resolveLogFile(dateStr);
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    fileLoggingAvailable = false;
    if (!warnedFileLogging) {
      warnedFileLogging = true;
      console.error(
        `[${new Date().toISOString()}] ❌ LOGGING: Failed to write log file in ${LOG_DIR}. File logging disabled.`
      );
    }
  }
}

function emit(
  level: "info" | "success" | "warning" | "error" | "step" | "detail",
  message: string,
  data?: any,
  error?: any,
  step?: number
): void {
  const timestamp = new Date().toISOString();
  const sanitizedMessage = sanitizeMessage(message);
  const sanitizedData = data !== undefined ? redactValue(data) : undefined;
  const sanitizedError = error !== undefined ? sanitizeError(error) : undefined;

  const fileEntry: Record<string, unknown> = {
    timestamp,
    level,
    message: sanitizedMessage,
  };
  if (step !== undefined) fileEntry.step = step;
  if (sanitizedData !== undefined) fileEntry.data = sanitizedData;
  if (sanitizedError !== undefined) fileEntry.error = sanitizedError;
  writeFileEntry(fileEntry, timestamp);

  if (level === "detail") return;

  const prefix =
    level === "info"
      ? "ℹ️"
      : level === "success"
      ? "✅"
      : level === "warning"
      ? "⚠️"
      : level === "error"
      ? "❌"
      : "🔄";

  if (level === "step") {
    console.log(`[${timestamp}] ${prefix} Step ${step}: ${sanitizedMessage}`);
    return;
  }

  console.log(`[${timestamp}] ${prefix} ${sanitizedMessage}`);

  if (level === "error" && sanitizedError) {
    const details = sanitizedError as { message?: string; responseData?: unknown; stack?: string };
    if (details.message) console.log(`   Error: ${details.message}`);
    if (details.responseData)
      console.log(`   Response: ${JSON.stringify(details.responseData)}`);
    if (details.stack && process.env.NODE_ENV === "development")
      console.log(`   Stack: ${details.stack}`);
  }
}

export const log = {
  info: (message: string, data?: any) => emit("info", message, data),
  success: (message: string, data?: any) => emit("success", message, data),
  warning: (message: string, data?: any) => emit("warning", message, data),
  error: (message: string, errorOrData?: any, data?: any) => {
    const isErrorLike =
      errorOrData instanceof Error ||
      (errorOrData && typeof errorOrData === "object" && "stack" in errorOrData) ||
      (errorOrData && typeof errorOrData === "object" && "response" in errorOrData) ||
      (errorOrData && typeof errorOrData === "object" && "code" in errorOrData);
    const error = isErrorLike ? errorOrData : undefined;
    const payload = isErrorLike ? data : errorOrData;
    emit("error", message, payload, error);
  },
  step: (step: number, message: string, data?: any) => emit("step", message, data, undefined, step),
  detail: (message: string, data?: any) => emit("detail", message, data),
};
