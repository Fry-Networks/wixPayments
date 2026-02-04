import { DeviceModel } from "../db/devices-schema.js";
import { classifyProductName } from "./product-utils.js";
import {
  BANDWIDTH_MINER_INTERNAL_NAME,
  ELIGIBLE_FULFILLMENT_STATUSES,
} from "./constants.js";
import { logger } from "./logger.js";
import type {
  EligibilityResult,
  NormalizedLineItem,
  NormalizedOrder,
  NormalizedOrderSource,
  SpecialOrderSnapshot,
} from "./types.js";
import type { Order, LineItem } from "../otherTypes.js";

const normalizeName = (name?: string) => (name || "").trim();
const normalizeFulfillment = (value?: string) =>
  (value || "").trim().toUpperCase().replace(/\s+/g, "_");

async function countExistingBandwidthMiners(
  orderNumber: string,
  email?: string
): Promise<number> {
  const query: Record<string, any> = {
    name: BANDWIDTH_MINER_INTERNAL_NAME,
    airdrop_source_order: orderNumber,
  };
  if (email) {
    query.email = email;
  }
  return DeviceModel.countDocuments(query);
}

function summarizeLineItems(lineItems: LineItem[]): NormalizedLineItem[] {
  return lineItems.map((item) => {
    const productName =
      item?.productName?.original ||
      item?.productName?.translated ||
      item?.descriptionLines?.[0]?.plainText?.original ||
      item?.descriptionLines?.[0]?.plainText?.translated ||
      "Unknown Item";

    return {
      name: productName,
      quantity: item.quantity || 0,
      type: classifyProductName(productName),
    };
  });
}

function computeNodesPurchased(items: NormalizedLineItem[]): number {
  return items
    .filter((i) => i.type === "node")
    .reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function buildNormalizedOrder(
  order: Order,
  source: NormalizedOrderSource
): NormalizedOrder {
  const lineItems = summarizeLineItems(order.lineItems || []);
  const nodesPurchased = computeNodesPurchased(lineItems);
  const status = (order.status || "").trim().toUpperCase();
  const paymentStatus = (order.paymentStatus || "").trim().toUpperCase();
  const fulfillmentStatus = normalizeFulfillment(order.fulfillmentStatus);

  return {
    source,
    id: order.id,
    number: order.number,
    buyerEmail: normalizeName(order.buyerInfo?.email).toLowerCase(),
    status,
    paymentStatus,
    fulfillmentStatus,
    createdDate: order.createdDate ? new Date(order.createdDate) : undefined,
    updatedDate: order.updatedDate ? new Date(order.updatedDate) : undefined,
    nodesPurchased,
    existingBandwidthMiners: 0,
    outstandingBandwidthMiners: 0,
    lineItems,
    raw: order,
  };
}

export async function evaluateEligibility(
  wixOrders: Order[],
  specialOrders: SpecialOrderSnapshot[]
): Promise<EligibilityResult> {
  const eligible: NormalizedOrder[] = [];
  const excluded: EligibilityResult["excludedOrders"] = [];

  for (const order of wixOrders) {
    const normalized = buildNormalizedOrder(order, "wix");
    if (!normalized.buyerEmail) {
      excluded.push({
        orderNumber: normalized.number,
        email: "missing",
        reason: "Missing buyer email",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (!ELIGIBLE_FULFILLMENT_STATUSES.includes(normalized.fulfillmentStatus)) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: `Ineligible fulfillment status: ${normalized.fulfillmentStatus}`,
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (normalized.status?.toUpperCase() === "CANCELED") {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: "Order canceled",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    const paymentStatus = (normalized.paymentStatus || "").toUpperCase();
    if (paymentStatus !== "PAID") {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: `Payment status ${normalized.paymentStatus} is not PAID`,
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (paymentStatus.includes("REFUND")) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: `Refunded order (${normalized.paymentStatus})`,
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (normalized.nodesPurchased <= 0) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: "No nodes purchased in order",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    normalized.existingBandwidthMiners = await countExistingBandwidthMiners(
      normalized.number
    );
    normalized.outstandingBandwidthMiners = Math.max(
      0,
      normalized.nodesPurchased - normalized.existingBandwidthMiners
    );

    if (normalized.outstandingBandwidthMiners <= 0) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: "Sufficient Bandwidth Miners already exist for this order",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    eligible.push(normalized);
  }

  for (const special of specialOrders) {
    const normalizedEmail = (special.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      excluded.push({
        orderNumber: special.order,
        email: "missing",
        reason: "Special order missing email reference",
        status: "SPECIAL",
        fulfillmentStatus: "SPECIAL",
        paymentStatus: "SPECIAL",
        source: "special",
      });
      continue;
    }

    const nodesPurchased = special.nodes;
    const existing = await countExistingBandwidthMiners(
      special.order,
      normalizedEmail
    );
    const outstanding = Math.max(0, nodesPurchased - existing);

    if (outstanding <= 0) {
      excluded.push({
        orderNumber: special.order,
        email: special.email,
        reason: "Special order already has Bandwidth Miners or zero nodes",
        status: "SPECIAL",
        fulfillmentStatus: "SPECIAL",
        paymentStatus: "SPECIAL",
        source: "special",
      });
      continue;
    }

    const normalized: NormalizedOrder = {
      source: "special",
      id: special.order,
      number: special.order,
      buyerEmail: normalizedEmail,
      status: "SPECIAL",
      paymentStatus: "PAID",
      fulfillmentStatus: "SPECIAL",
      createdDate: undefined,
      updatedDate: undefined,
      nodesPurchased,
      existingBandwidthMiners: existing,
      outstandingBandwidthMiners: outstanding,
      lineItems: [
        {
          name: `Special Node Bundle (${special.nodes})`,
          quantity: special.nodes,
          type: "node",
        },
      ],
      raw: undefined,
      specialReason: special.note,
    };

    eligible.push(normalized);
  }

  logger.success(
    `Eligibility evaluation complete. Eligible: ${eligible.length}, excluded: ${excluded.length}`
  );
  return { eligibleOrders: eligible, excludedOrders: excluded };
}

export async function evaluateEligibilityForEmail(
  wixOrders: Order[],
  specialOrders: SpecialOrderSnapshot[]
): Promise<EligibilityResult> {
  const eligible: NormalizedOrder[] = [];
  const excluded: EligibilityResult["excludedOrders"] = [];

  for (const order of wixOrders) {
    const normalized = buildNormalizedOrder(order, "wix");
    if (!normalized.buyerEmail) {
      excluded.push({
        orderNumber: normalized.number,
        email: "missing",
        reason: "Missing buyer email",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (!ELIGIBLE_FULFILLMENT_STATUSES.includes(normalized.fulfillmentStatus)) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: `Ineligible fulfillment status: ${normalized.fulfillmentStatus}`,
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (normalized.status?.toUpperCase() === "CANCELED") {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: "Order canceled",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    const paymentStatus = (normalized.paymentStatus || "").toUpperCase();
    if (paymentStatus !== "PAID") {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: `Payment status ${normalized.paymentStatus} is not PAID`,
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    if (normalized.nodesPurchased <= 0) {
      excluded.push({
        orderNumber: normalized.number,
        email: normalized.buyerEmail,
        reason: "No nodes purchased in order",
        status: normalized.status,
        fulfillmentStatus: normalized.fulfillmentStatus,
        paymentStatus: normalized.paymentStatus,
        source: "wix",
      });
      continue;
    }

    // Intentionally do NOT require outstandingBandwidthMiners > 0 here:
    // email-only workflows need to allow fully-minted orders so they can send pending emails.
    eligible.push(normalized);
  }

  for (const special of specialOrders) {
    const normalizedEmail = (special.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      excluded.push({
        orderNumber: special.order,
        email: "missing",
        reason: "Special order missing email reference",
        status: "SPECIAL",
        fulfillmentStatus: "SPECIAL",
        paymentStatus: "SPECIAL",
        source: "special",
      });
      continue;
    }

    if (!special.nodes || special.nodes <= 0) {
      excluded.push({
        orderNumber: special.order,
        email: special.email,
        reason: "Special order has zero nodes",
        status: "SPECIAL",
        fulfillmentStatus: "SPECIAL",
        paymentStatus: "SPECIAL",
        source: "special",
      });
      continue;
    }

    eligible.push({
      source: "special",
      id: special.order,
      number: special.order,
      buyerEmail: normalizedEmail,
      status: "SPECIAL",
      paymentStatus: "PAID",
      fulfillmentStatus: "SPECIAL",
      createdDate: undefined,
      updatedDate: undefined,
      nodesPurchased: special.nodes,
      existingBandwidthMiners: 0,
      outstandingBandwidthMiners: 0,
      lineItems: [
        {
          name: `Special Node Bundle (${special.nodes})`,
          quantity: special.nodes,
          type: "node",
        },
      ],
      raw: undefined,
      specialReason: special.note,
    });
  }

  logger.success(
    `Email eligibility evaluation complete. Eligible: ${eligible.length}, excluded: ${excluded.length}`
  );
  return { eligibleOrders: eligible, excludedOrders: excluded };
}
