// Centralized constants for AI Edge Miner v2

export const AI_MINER_PREFIX = 'AEM';

// Orders below this number are eligible for free AI Edge Miner
export const ORDER_NUMBER_CUTOFF = 16607;

// Orders with these exact string values are also eligible
export const ELIGIBLE_ORDER_STRINGS = [
  '99137', 
  '99140',
  'HeliumDeploy',
  'HeliumDeploy2',
  'HeliumDeploy3'
] as const;

export const ELIGIBLE_NODE_TYPES = [
  "$FRY Reward Decentralization Node",
  "$FRY Storage Decentralization Node",
  "$FRY Contributor Node",
  "$FRY Storage Validator Node"
] as const;

export type EligibleNodeType = typeof ELIGIBLE_NODE_TYPES[number];

