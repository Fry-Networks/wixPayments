export const BANDWIDTH_MINER_INTERNAL_NAME = "$FRY Bandwidth Miner";
export const BANDWIDTH_MINER_NEW_NAME = "Fry Bandwidth Gateway";
export const BANDWIDTH_MINER_PREFIX = "BM";

export const NODE_PRODUCT_NAMES = {
  modern: [
    "Fry Compute Node",
    "Fry Storage Node",
    "Fry Storage Validator Node",
    "Fry Contributor Node",
  ],
  legacy: [
    "$FRY Reward Decentralization Node",
    "$FRY Storage Decentralization Node",
    "$FRY Storage Validator Node",
    "$FRY Contributor Node",
  ],
};

export const BANDWIDTH_PRODUCT_NAMES = [
  BANDWIDTH_MINER_INTERNAL_NAME,
  BANDWIDTH_MINER_NEW_NAME,
];

export const SPECIAL_NON_WIX_ORDERS = [
  "99137",
  "99140",
  "HeliumDeploy",
  "HeliumDeploy2",
  "HeliumDeploy3",
];

export const ELIGIBLE_FULFILLMENT_STATUSES = [
  "FULFILLED",
  "PARTIALLY_FULFILLED",
  "NOT_FULFILLED",
  "UNFULFILLED",
];

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_RATE_LIMIT_MS = 35;

export const EXPORT_DIRECTORY = "bandwidth-airdrop-exports";
export const DEFAULT_WIX_CSV_PATH =
  "src/bandwidth-airdrop/wix-eligible-orders/wix-eligible-orders-BM-airdrop.csv";
