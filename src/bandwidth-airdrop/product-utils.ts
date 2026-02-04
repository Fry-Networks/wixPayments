import {
  BANDWIDTH_PRODUCT_NAMES,
  BANDWIDTH_MINER_INTERNAL_NAME,
  NODE_PRODUCT_NAMES,
} from "./constants.js";

const normalize = (value?: string): string =>
  (value || "").trim().toLowerCase();

const flatNodeNames = new Set(
  [...NODE_PRODUCT_NAMES.modern, ...NODE_PRODUCT_NAMES.legacy].map(normalize)
);

const bandwidthNames = new Set(
  BANDWIDTH_PRODUCT_NAMES.map((name) => normalize(name))
);

export function classifyProductName(
  value?: string
): "node" | "bandwidth" | "other" {
  const normalized = normalize(value);
  if (!normalized) return "other";
  if (flatNodeNames.has(normalized)) return "node";
  if (bandwidthNames.has(normalized)) return "bandwidth";
  return "other";
}

export function getCanonicalBandwidthName(): string {
  return BANDWIDTH_MINER_INTERNAL_NAME;
}

