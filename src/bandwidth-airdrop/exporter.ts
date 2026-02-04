import fs from "node:fs";
import path from "node:path";
import {
  ExportPayload,
  AwardPlanEntry,
  NormalizedOrder,
  MintedKey,
} from "./types.js";
import { logger } from "./logger.js";
import { EXPORT_DIRECTORY } from "./constants.js";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toCsvRow(values: Array<string | number>): string {
  return values
    .map((value) => {
      const str = String(value ?? "");
      if (str.includes(",") || str.includes("\"")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(",");
}

function ordersToCsv(orders: NormalizedOrder[]): string {
  const header = [
    "orderNumber",
    "email",
    "source",
    "status",
    "paymentStatus",
    "fulfillmentStatus",
    "nodesPurchased",
    "existingBandwidthMiners",
    "outstandingBandwidthMiners",
  ];
  const rows = orders.map((order) =>
    toCsvRow([
      order.number,
      order.buyerEmail,
      order.source,
      order.status,
      order.paymentStatus,
      order.fulfillmentStatus,
      order.nodesPurchased,
      order.existingBandwidthMiners,
      order.outstandingBandwidthMiners,
    ])
  );
  return [header.join(","), ...rows].join("\n");
}

function planToCsv(plan: AwardPlanEntry[]): string {
  const header = [
    "orderNumber",
    "email",
    "source",
    "units",
    "fulfillmentStatus",
    "paymentStatus",
    "status",
  ];
  const rows = plan.map((item) =>
    toCsvRow([
      item.orderNumber,
      item.email,
      item.source,
      item.units,
      item.fulfillmentStatus,
      item.paymentStatus,
      item.status,
    ])
  );
  return [header.join(","), ...rows].join("\n");
}

function mintedKeysToCsv(keys: MintedKey[]): string {
  const header = [
    "deviceId",
    "minerKey",
    "purchaserEmail",
    "deliveryEmail",
    "orderNumber",
    "createdAt",
    "sourceOrderDate",
  ];
  const rows = keys.map((item) =>
    toCsvRow([
      item.deviceId,
      item.minerKey,
      item.purchaserEmail,
      item.deliveryEmail,
      item.orderNumber,
      item.createdAt,
      item.sourceOrderDate || "",
    ])
  );
  return [header.join(","), ...rows].join("\n");
}

export function exportResults(payload: ExportPayload, dir?: string): string {
  const exportDir = path.join(
    process.cwd(),
    dir || EXPORT_DIRECTORY,
    payload.generatedAt.replace(/[:.]/g, "-")
  );
  ensureDir(exportDir);

  const jsonPath = path.join(exportDir, "bandwidth-airdrop-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const eligibleCsvPath = path.join(
    exportDir,
    "eligible-orders.csv"
  );
  fs.writeFileSync(eligibleCsvPath, ordersToCsv(payload.eligibleOrders), "utf8");

  const planCsvPath = path.join(exportDir, "award-plan.csv");
  fs.writeFileSync(planCsvPath, planToCsv(payload.awardPlan), "utf8");

  let mintedKeysCsvPath: string | undefined;
  if (payload.mintedKeys?.length) {
    mintedKeysCsvPath = path.join(exportDir, "minted-keys.csv");
    fs.writeFileSync(
      mintedKeysCsvPath,
      mintedKeysToCsv(payload.mintedKeys),
      "utf8"
    );
  }

  logger.success(
    `Exported JSON/CSV artifacts to ${exportDir}`,
    { jsonPath, eligibleCsvPath, planCsvPath, mintedKeysCsvPath }
  );

  return exportDir;
}
