import { redactEmail } from "../redact-utils.js";

const timestamp = () => new Date().toISOString();

function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "string" && looksLikeEmail(v)) {
        return redactEmail(v);
      }
      return v;
    },
    2
  );
}

export const logger = {
  info(message: string, data?: any) {
    console.log(
      `[${timestamp()}] ℹ️  ${message}`,
      data ? safeStringify(data) : ""
    );
  },
  success(message: string, data?: any) {
    console.log(
      `[${timestamp()}] ✅ ${message}`,
      data ? safeStringify(data) : ""
    );
  },
  warn(message: string, data?: any) {
    console.log(
      `[${timestamp()}] ⚠️  ${message}`,
      data ? safeStringify(data) : ""
    );
  },
  error(message: string, error?: any) {
    console.log(`[${timestamp()}] ❌ ${message}`);
    if (error) {
      if (typeof error === "string") {
        console.log(`   → ${error}`);
      } else if (error.message) {
        console.log(`   → ${error.message}`);
      }
      if (error.stack) {
        console.log(error.stack);
      }
    }
  },
};
