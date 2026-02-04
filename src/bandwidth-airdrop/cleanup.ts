import fs from "node:fs";
import path from "node:path";
import { DeviceModel } from "../db/devices-schema.js";
import { logger } from "./logger.js";
import { BANDWIDTH_MINER_INTERNAL_NAME } from "./constants.js";

type CleanupResult = {
  matched: number;
  modified: number;
  missingIds: string[];
};

type BandwidthAirdropReport = {
  mintedKeys?: Array<{ deviceId: string }>;
};

export function loadMintedDeviceIdsFromExportDir(exportDir: string): string[] {
  const reportPath = path.resolve(exportDir, "bandwidth-airdrop-report.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found at ${reportPath}`);
  }
  const raw = fs.readFileSync(reportPath, "utf8");
  const parsed = JSON.parse(raw) as BandwidthAirdropReport;
  const ids = (parsed.mintedKeys || [])
    .map((k) => (k.deviceId || "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export async function cleanupBmAirdropFieldsByDeviceIds(
  deviceIds: string[],
  options: { dryRun: boolean }
): Promise<CleanupResult> {
  const ids = [...new Set(deviceIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) {
    return { matched: 0, modified: 0, missingIds: [] };
  }

  const existing = await DeviceModel.find({ _id: { $in: ids } })
    .select("_id name airdrop_source_order")
    .lean();
  const existingSet = new Set(existing.map((d: any) => d._id.toString()));
  const missingIds = ids.filter((id) => !existingSet.has(id));

  const filter = {
    _id: { $in: ids.filter((id) => existingSet.has(id)) },
    name: BANDWIDTH_MINER_INTERNAL_NAME,
    airdrop_source_order: { $exists: true },
  };

  const toUnset = {
    registration: 1,
    node: 1,
    ai_miner_generated: 1,
    ai_edge_miner_assigned: 1,
  };

  if (options.dryRun) {
    const matched = await DeviceModel.countDocuments(filter);
    logger.info("BM cleanup dry-run", { matched, missingIds: missingIds.length });
    return { matched, modified: 0, missingIds };
  }

  const result = await DeviceModel.updateMany(filter, { $unset: toUnset });
  return {
    matched: result.matchedCount,
    modified: result.modifiedCount,
    missingIds,
  };
}

