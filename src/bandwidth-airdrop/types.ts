import type { Order } from "../otherTypes.js";

export type NormalizedOrderSource = "wix" | "special";

export interface NormalizedOrder {
  source: NormalizedOrderSource;
  id: string;
  number: string;
  buyerEmail: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdDate?: Date;
  updatedDate?: Date;
  nodesPurchased: number;
  existingBandwidthMiners: number;
  outstandingBandwidthMiners: number;
  lineItems: NormalizedLineItem[];
  raw?: Order | SpecialOrderSnapshot;
  specialReason?: string;
}

export interface NormalizedLineItem {
  name: string;
  quantity: number;
  type: "node" | "bandwidth" | "other";
}

export interface EligibilityResult {
  eligibleOrders: NormalizedOrder[];
  excludedOrders: Array<{
    orderNumber: string;
    email: string;
    reason: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    source: NormalizedOrderSource;
  }>;
}

export interface AwardPlanMetadata {
  nodesPurchased: number;
  existingBandwidthMiners: number;
  lineItems: NormalizedLineItem[];
  specialReason?: string;
  sourceOrderDate?: string;
  purchaserEmail?: string;
}

export interface AwardPlanEntry {
  orderNumber: string;
  email: string;
  deliveryEmail?: string;
  units: number;
  source: NormalizedOrderSource;
  fulfillmentStatus: string;
  paymentStatus: string;
  status: string;
  metadata?: AwardPlanMetadata;
}

export interface SpecialOrderSnapshot {
  order: string;
  email: string;
  nodes: number;
  note?: string;
}

export interface ExportPayload {
  generatedAt: string;
  dryRun: boolean;
  totals: {
    fetchedOrders: number;
    eligibleOrders: number;
    excludedOrders: number;
    bandwidthMinersToGenerate: number;
    emailsToSend: number;
  };
  eligibleOrders: NormalizedOrder[];
  excludedOrders: EligibilityResult["excludedOrders"];
  awardPlan: AwardPlanEntry[];
  mintedKeys?: MintedKey[];
}

export interface MintedKey {
  deviceId: string;
  minerKey: string;
  purchaserEmail: string;
  deliveryEmail: string;
  orderNumber: string;
  createdAt: string;
  sourceOrderDate?: string;
}

export interface CLIConfig {
  dryRun: boolean;
  skipEmail: boolean;
  csvPath?: string;
  emailFilter?: string[];
  ordersFilter?: string[];
  exportDir?: string;
  exportKeys?: boolean;
}
