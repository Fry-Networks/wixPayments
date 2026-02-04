import { AwardPlanEntry, NormalizedOrder } from "./types.js";

export function buildAwardPlan(
  orders: NormalizedOrder[]
): { plan: AwardPlanEntry[]; totalUnits: number } {
  const plan: AwardPlanEntry[] = [];
  let total = 0;

  for (const order of orders) {
    if (order.outstandingBandwidthMiners <= 0) continue;

    plan.push({
      orderNumber: order.number,
      email: order.buyerEmail,
      units: order.outstandingBandwidthMiners,
      source: order.source,
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus: order.paymentStatus,
      status: order.status,
      metadata: {
        nodesPurchased: order.nodesPurchased,
        existingBandwidthMiners: order.existingBandwidthMiners,
        lineItems: order.lineItems,
        specialReason: order.specialReason,
        sourceOrderDate: order.createdDate
          ? order.createdDate.toISOString()
          : undefined,
        purchaserEmail: order.buyerEmail,
      },
    });

    total += order.outstandingBandwidthMiners;
  }

  return { plan, totalUnits: total };
}
