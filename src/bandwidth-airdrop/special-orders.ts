import { DeviceModel } from "../db/devices-schema.js";
import {
  SPECIAL_NON_WIX_ORDERS,
  NODE_PRODUCT_NAMES,
} from "./constants.js";
import { logger } from "./logger.js";
import type { SpecialOrderSnapshot } from "./types.js";

const nodeNames = new Set([
  ...NODE_PRODUCT_NAMES.modern.map((n) => n.toLowerCase()),
  ...NODE_PRODUCT_NAMES.legacy.map((n) => n.toLowerCase()),
]);

export async function fetchSpecialOrderSnapshots(): Promise<
  SpecialOrderSnapshot[]
> {
  const devices = await DeviceModel.find({
    order: { $in: SPECIAL_NON_WIX_ORDERS.map((o) => o.toString()) },
    name: { $exists: true },
  })
    .select("name email order")
    .lean();

  const grouped = new Map<
    string,
    { order: string; email: string; nodes: number }
  >();

  for (const device of devices) {
    const order = (device.order || "").toString();
    const email = (device.email || "").trim().toLowerCase();
    if (!order || !email) continue;
    if (!nodeNames.has((device.name || "").toLowerCase())) continue;

    const key = `${order}||${email}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.nodes += 1;
    } else {
      grouped.set(key, { order, email, nodes: 1 });
    }
  }

  const snapshots: SpecialOrderSnapshot[] = Array.from(grouped.values()).map(
    (entry) => ({
      order: entry.order,
      email: entry.email,
      nodes: entry.nodes,
      note: "Special manual order",
    })
  );

  if (!snapshots.length) {
    logger.warn("No special-order node devices found in Mongo.");
  } else {
    logger.info(
      `Prepared ${snapshots.length} special-order snapshots across ${SPECIAL_NON_WIX_ORDERS.length} order ids`
    );
  }

  return snapshots;
}
