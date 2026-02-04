#!/usr/bin/env node
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { connect } from "../db/connect.js";
import { logger } from "./logger.js";
import mongoose from "mongoose";
import {
  evaluateEligibility,
  evaluateEligibilityForEmail,
} from "./eligibility.js";
import { buildAwardPlan } from "./award-plan.js";
import { executeAwardPlan, sendEmailsForEligibleOrders } from "./runner.js";
import { exportResults } from "./exporter.js";
import {
  cleanupBmAirdropFieldsByDeviceIds,
  loadMintedDeviceIdsFromExportDir,
} from "./cleanup.js";
import {
  BANDWIDTH_MINER_INTERNAL_NAME,
  DEFAULT_WIX_CSV_PATH,
} from "./constants.js";
import { loadWixOrdersFromCsv } from "./csv-orders.js";
import { fetchSpecialOrderSnapshots } from "./special-orders.js";
import { DeviceModel } from "../db/devices-schema.js";
import { buildBandwidthAirdropEmailCopy } from "./email-copy.js";
import { sortKeysByOrderNumber } from "./email-utils.js";
import { sendBandwidthAirdropEmail } from "./email-delivery.js";
import { redactEmail } from "../redact-utils.js";
import type {
  CLIConfig,
  ExportPayload,
  NormalizedOrder,
  EligibilityResult,
  SpecialOrderSnapshot,
  MintedKey,
} from "./types.js";
import type { Order } from "../otherTypes.js";
import type { BatchFailureDecision } from "./email-delivery.js";

type PlannedAirdrop = {
  wixOrders: Order[];
  specialOrders: SpecialOrderSnapshot[];
  eligibleOrders: NormalizedOrder[];
  filteredEligible: NormalizedOrder[];
  excludedOrders: EligibilityResult["excludedOrders"];
  awardPlan: ReturnType<typeof buildAwardPlan>;
};

type PlannedEmailScope = {
  wixOrders: Order[];
  specialOrders: SpecialOrderSnapshot[];
  eligibleOrders: NormalizedOrder[];
  filteredEligible: NormalizedOrder[];
  excludedOrders: EligibilityResult["excludedOrders"];
};

type WorkflowResult = {
  plan: PlannedAirdrop;
  exportDir?: string;
};

function redactEmailMaybe(value?: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  return redactEmail(trimmed);
}

function redactEmailBreakdown(
  breakdown: Record<string, number>
): Array<{ email: string; count: number }> {
  return Object.entries(breakdown).map(([email, count]) => ({
    email: redactEmailMaybe(email),
    count,
  }));
}

function parseArgs(argv: string[]): CLIConfig {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }

  const dryRun = !args.has("execute");
  const skipEmail = args.has("skip-email");
  const csvPath = args.has("csv") ? String(args.get("csv")) : undefined;
  const emailFilter = args.has("emails")
    ? String(args.get("emails"))
        .split(",")
        .map((e) => e.trim().toLowerCase())
    : undefined;
  const ordersFilter = args.has("orders")
    ? String(args.get("orders"))
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : undefined;
  const exportDir = args.has("export-dir")
    ? String(args.get("export-dir"))
    : undefined;

  return {
    dryRun,
    skipEmail,
    csvPath,
    emailFilter,
    ordersFilter,
    exportDir,
  };
}

function filterOrders(
  orders: NormalizedOrder[],
  config: CLIConfig
): NormalizedOrder[] {
  let filtered = [...orders];
  if (config.emailFilter?.length) {
    const set = new Set(
      config.emailFilter.map((email) => email.trim().toLowerCase())
    );
    filtered = filtered.filter((order) => set.has(order.buyerEmail));
  }
  if (config.ordersFilter?.length) {
    const set = new Set(config.ordersFilter.map((order) => order.trim()));
    filtered = filtered.filter((order) => set.has(order.number));
  }
  return filtered;
}

async function confirmExecution(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({ input, output });
    rl.question(
      "⚠️  EXECUTION MODE: Type CONFIRM to mint Bandwidth Miner keys now: ",
      (answer) => {
        rl.close();
        if (answer.trim() !== "CONFIRM") {
          logger.warn("Confirmation not received. Aborting.");
          reject(new Error("Execution cancelled"));
        } else {
          resolve();
        }
      }
    );
  });
}

function buildExportPayload(
  totalOrdersFetched: number,
  filteredEligible: NormalizedOrder[],
  excluded: EligibilityResult["excludedOrders"],
  awardPlan: ReturnType<typeof buildAwardPlan>,
  config: CLIConfig,
  options?: { generatedAt?: string; mintedKeys?: MintedKey[] }
): ExportPayload {
  return {
    generatedAt: options?.generatedAt || new Date().toISOString(),
    dryRun: config.dryRun,
    totals: {
      fetchedOrders: totalOrdersFetched,
      eligibleOrders: filteredEligible.length,
      excludedOrders: excluded.length,
      bandwidthMinersToGenerate: awardPlan.totalUnits,
      emailsToSend: awardPlan.plan.reduce(
        (set, entry) => set.add(entry.email),
        new Set<string>()
      ).size,
    },
    eligibleOrders: filteredEligible,
    excludedOrders: excluded,
    awardPlan: awardPlan.plan,
    mintedKeys: options?.mintedKeys,
  };
}

async function planAirdrop(config: CLIConfig): Promise<PlannedAirdrop> {
  const csvPath = config.csvPath || DEFAULT_WIX_CSV_PATH;
  const wixOrders = loadWixOrdersFromCsv(csvPath);
  const specialOrders = await fetchSpecialOrderSnapshots();

  logger.info(
    `Fetched ${wixOrders.length} Wix orders and ${specialOrders.length} special orders`
  );

  const { eligibleOrders, excludedOrders } = await evaluateEligibility(
    wixOrders,
    specialOrders
  );

  const filteredEligible = filterOrders(eligibleOrders, config);
  const awardPlan = buildAwardPlan(filteredEligible);
  return {
    wixOrders,
    specialOrders,
    eligibleOrders,
    filteredEligible,
    excludedOrders,
    awardPlan,
  };
}

async function planEmailScope(config: CLIConfig): Promise<PlannedEmailScope> {
  const csvPath = config.csvPath || DEFAULT_WIX_CSV_PATH;
  const wixOrders = loadWixOrdersFromCsv(csvPath);
  const specialOrders = await fetchSpecialOrderSnapshots();

  logger.info(
    `Fetched ${wixOrders.length} Wix orders and ${specialOrders.length} special orders`
  );

  const { eligibleOrders, excludedOrders } = await evaluateEligibilityForEmail(
    wixOrders,
    specialOrders
  );

  const filteredEligible = filterOrders(eligibleOrders, config);
  return {
    wixOrders,
    specialOrders,
    eligibleOrders,
    filteredEligible,
    excludedOrders,
  };
}

function logAnalytics(plan: PlannedAirdrop) {
  const statusCounts = plan.wixOrders.reduce<Record<string, number>>(
    (acc, order) => {
      const status = order.fulfillmentStatus || "UNKNOWN";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {}
  );
  logger.info("Fulfillment Status Breakdown", statusCounts);

  const paymentCounts = plan.wixOrders.reduce<Record<string, number>>(
    (acc, order) => {
      const status = order.paymentStatus || "UNKNOWN";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {}
  );
  logger.info("Payment Status Breakdown", paymentCounts);

  logger.info("Eligible orders after filtering", {
    totalEligible: plan.filteredEligible.length,
    totalBandwidthMinersNeeded: plan.awardPlan.totalUnits,
    uniqueEmails: new Set(plan.filteredEligible.map((o) => o.buyerEmail)).size,
  });
}

async function runAirdrop(
  config: CLIConfig,
  options?: {
    exportResults?: boolean;
    onEmailFailure?: (
      email: string,
      error: unknown
    ) => Promise<BatchFailureDecision>;
  }
): Promise<WorkflowResult> {
  const plan = await planAirdrop(config);
  logAnalytics(plan);

  const generatedAt = new Date().toISOString();
  let exportDir: string | undefined;
  const shouldExport = options?.exportResults !== false;
  if (config.dryRun) {
    if (shouldExport) {
      const exportPayload = buildExportPayload(
        plan.wixOrders.length + plan.specialOrders.length,
        plan.filteredEligible,
        plan.excludedOrders,
        plan.awardPlan,
        config,
        { generatedAt }
      );
      exportDir = exportResults(exportPayload, config.exportDir);
    }
    if (shouldExport && exportDir) {
      logger.success(
        `Dry run complete. Review export artifacts at ${exportDir} before executing.`
      );
    } else {
      logger.success(`Dry run complete. No files were exported.`);
    }
    return { plan, exportDir };
  }

  if (plan.awardPlan.totalUnits === 0) {
    logger.warn(
      "No Bandwidth Miner keys are required for the selected filters."
    );
    if (shouldExport) {
      const exportPayload = buildExportPayload(
        plan.wixOrders.length + plan.specialOrders.length,
        plan.filteredEligible,
        plan.excludedOrders,
        plan.awardPlan,
        config,
        { generatedAt }
      );
      exportDir = exportResults(exportPayload, config.exportDir);
    }
    return { plan, exportDir };
  }

  const execution = await executeAwardPlan(plan.awardPlan.plan, {
    dryRun: config.dryRun,
    skipEmail: config.skipEmail,
    onEmailFailure: options?.onEmailFailure,
  });

  if (shouldExport) {
    const exportPayload = buildExportPayload(
      plan.wixOrders.length + plan.specialOrders.length,
      plan.filteredEligible,
      plan.excludedOrders,
      plan.awardPlan,
      config,
      { generatedAt, mintedKeys: execution.mintedKeys }
    );
    exportDir = exportResults(exportPayload, config.exportDir);
  }

  logger.info("=== EXECUTION SUMMARY ===");
  logger.success("Bandwidth Miner airdrop complete", {
    createdDevices: execution.createdDevices,
    skippedDevices: execution.skippedDevices,
    emailsSent: execution.emailsSent,
    emailFailures: execution.emailFailures,
    emailSkips: execution.emailSkips,
    emailAborted: execution.emailAborted,
    emailBreakdownRedacted: redactEmailBreakdown(execution.emailBreakdown),
    errors: execution.errors,
  });
  logger.success(
    `All done! Created ${execution.createdDevices} ${BANDWIDTH_MINER_INTERNAL_NAME} keys.`
  );

  return { plan, exportDir };
}

class BandwidthAirdropInteractiveCLI {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output });
  }

  async start(): Promise<void> {
    let running = true;
    while (running) {
      this.printMenu();
      const choice = (await this.prompt("Select an option")).trim();
      try {
        if (choice === "1") {
          await this.handleDryRun();
        } else if (choice === "2") {
          await this.handleExecute();
        } else if (choice === "3") {
          await this.handleStats();
        } else if (choice === "4") {
          await this.handleSingleOrderGenerate();
        } else if (choice === "5") {
          await this.handleResendEmails();
        } else if (choice === "6") {
          await this.handleCleanupDocs();
        } else if (choice === "0") {
          running = false;
        } else {
          console.log("Unknown option, try again.");
        }
      } catch (error) {
        logger.error("Operation failed", error);
      }
    }
    this.rl.close();
  }

  private printMenu() {
    console.log(
      "\n================ Bandwidth Miner Airdrop CLI ================"
    );
    console.log("1. Dry Run + Export");
    console.log("2. Execute Airdrop");
    console.log("3. Preview Eligibility Stats + Export option");
    console.log("4. Single Order Generate + Send");
    console.log("5. Resend Bandwidth Miner Email (order or email)");
    console.log("6. Cleanup BM airdrop docs (unset AEM fields)");
    console.log("0. Exit");
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(`${question}: `, resolve));
  }

  private parseDate(value: string): Date | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? undefined : date;
  }

  private parseNumber(value: string): number | undefined {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  private parseList(value: string): string[] | undefined {
    const normalized = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length ? normalized : undefined;
  }

  private async collectFilters(options?: {
    skipOrdersPrompt?: boolean;
    skipEmailPrompt?: boolean;
  }): Promise<{
    csvPath?: string;
    emailFilter?: string[];
    ordersFilter?: string[];
    exportDir?: string;
  }> {
    const csvPathInput = (
      await this.prompt(`Path to Wix CSV (default ${DEFAULT_WIX_CSV_PATH})`)
    ).trim();
    const emailInput = options?.skipEmailPrompt
      ? ""
      : (
          await this.prompt(
            "Restrict to specific emails (comma-separated, optional)"
          )
        ).trim();
    const orderInput = options?.skipOrdersPrompt
      ? ""
      : (
          await this.prompt(
            "Restrict to specific order numbers (comma-separated, optional)"
          )
        ).trim();
    const exportDirInput = (
      await this.prompt("Export directory (default bandwidth-airdrop-exports)")
    ).trim();
    return {
      csvPath: csvPathInput || DEFAULT_WIX_CSV_PATH,
      emailFilter: emailInput
        ? this.parseList(emailInput)?.map((e) => e.toLowerCase())
        : undefined,
      ordersFilter: orderInput ? this.parseList(orderInput) : undefined,
      exportDir: exportDirInput || undefined,
    };
  }

  private buildConfig(
    base: {
      csvPath?: string;
      emailFilter?: string[];
      ordersFilter?: string[];
      exportDir?: string;
    },
    overrides: { dryRun: boolean; skipEmail: boolean }
  ): CLIConfig {
    return {
      dryRun: overrides.dryRun,
      skipEmail: overrides.skipEmail,
      csvPath: base.csvPath,
      emailFilter: base.emailFilter,
      ordersFilter: base.ordersFilter,
      exportDir: base.exportDir,
    };
  }

  private async handleDryRun() {
    const filters = await this.collectFilters();
    const config = this.buildConfig(filters, {
      dryRun: true,
      skipEmail: false,
    });
    await runAirdrop(config);
  }

  private async handleExecute() {
    console.log("\nExecute Airdrop:");
    console.log("1. Generate Bandwidth Miner keys only (no emails)");
    console.log("2. Send emails for generated keys (no minting)");
    console.log("0. Back");

    const mode = (await this.prompt("Select an option")).trim();
    if (mode === "0") return;

    const onEmailFailure = async (
      email: string,
      error: unknown
    ): Promise<BatchFailureDecision> => {
      console.log("\n❌ Failed to send BM airdrop email");
      console.log(`Recipient: ${redactEmailMaybe(email)}`);
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
      const choice = (await this.prompt("Choose: (R)etry / (S)kip / (A)bort"))
        .trim()
        .toLowerCase();
      if (choice.startsWith("r")) return "retry";
      if (choice.startsWith("a")) return "abort";
      return "skip";
    };

    if (mode === "1") {
      const filters = await this.collectFilters();
      const confirmation = (
        await this.prompt("Type CONFIRM to mint keys (anything else to cancel)")
      ).trim();
      if (confirmation !== "CONFIRM") {
        logger.warn("Execution cancelled.");
        return;
      }
      const config = this.buildConfig(filters, {
        dryRun: false,
        skipEmail: true,
      });
      await runAirdrop(config, { onEmailFailure });
      return;
    }

    if (mode === "2") {
      const filters = await this.collectFilters();
      const confirmation = (
        await this.prompt("Type CONFIRM to send emails (anything else to cancel)")
      ).trim();
      if (confirmation !== "CONFIRM") {
        logger.warn("Send cancelled.");
        return;
      }

      const config = this.buildConfig(filters, {
        dryRun: true,
        skipEmail: false,
      });
      const scope = await planEmailScope(config);
      if (!scope.filteredEligible.length) {
        logger.warn("No eligible orders found for the selected filters.");
        return;
      }

      const result = await sendEmailsForEligibleOrders(scope.filteredEligible, {
        onEmailFailure,
      });
      logger.success("BM airdrop email-only run complete", result);
      return;
    }

    console.log("Unknown option, try again.");
  }

  private async handleStats() {
    const filters = await this.collectFilters();
    const config = this.buildConfig(filters, {
      dryRun: true,
      skipEmail: false,
    });
    const plan = await planAirdrop(config);
    logAnalytics(plan);
    console.log(
      `Total eligible orders (after filters): ${plan.filteredEligible.length}`
    );
    console.log(`Bandwidth Miner keys needed: ${plan.awardPlan.totalUnits}`);

    const shouldExport = (
      await this.prompt("Export this plan to JSON/CSV? (y/N)")
    )
      .trim()
      .toLowerCase()
      .startsWith("y");
    if (shouldExport) {
      const payload = buildExportPayload(
        plan.wixOrders.length + plan.specialOrders.length,
        plan.filteredEligible,
        plan.excludedOrders,
        plan.awardPlan,
        config
      );
      const exportDir = exportResults(payload, config.exportDir);
      logger.success(`Plan exported to ${exportDir}`);
    }
  }

  private async handleSingleOrderGenerate() {
    const orderNumber = (
      await this.prompt("Order number (leave blank to target by email)")
    ).trim();
    const purchaserEmailInput = (
      await this.prompt(
        "Purchaser email (optional, required if no order number)"
      )
    ).trim();
    const purchaserEmail = purchaserEmailInput
      ? purchaserEmailInput.toLowerCase()
      : "";

    if (!orderNumber && !purchaserEmail) {
      console.log("Please provide an order number or purchaser email.");
      return;
    }

    const overrideEmail = (
      await this.prompt(
        "Override delivery email? (leave blank to use purchaser email)"
      )
    ).trim();

    const limitInput = (
      await this.prompt(
        "Limit number of Bandwidth Miners to mint (optional number)"
      )
    ).trim();
    const limitUnits = limitInput ? Number(limitInput) : undefined;
    if (
      limitUnits !== undefined &&
      (!Number.isInteger(limitUnits) || limitUnits <= 0)
    ) {
      console.log("Limit must be a positive integer.");
      return;
    }

    const skipEmail = (await this.prompt("Skip email send for this run? (y/N)"))
      .trim()
      .toLowerCase()
      .startsWith("y");

    const filters = await this.collectFilters({
      skipOrdersPrompt: true,
      skipEmailPrompt: true,
    });
    if (orderNumber) {
      filters.ordersFilter = [orderNumber];
    }
    if (purchaserEmail) {
      filters.emailFilter = [purchaserEmail];
    }

    const plan = await planAirdrop(
      this.buildConfig(filters, { dryRun: true, skipEmail })
    );

    const matchesEntry = (entry: (typeof plan.awardPlan)["plan"][number]) => {
      const orderMatches = orderNumber
        ? entry.orderNumber === orderNumber
        : true;
      const emailMatches = purchaserEmail
        ? entry.email.toLowerCase() === purchaserEmail
        : true;
      return orderMatches && emailMatches;
    };

    const entries = plan.awardPlan.plan.filter(matchesEntry);
    if (!entries.length) {
      console.log(
        "No eligible Bandwidth Miner units found for the provided criteria."
      );
      return;
    }

    let remaining =
      limitUnits && limitUnits > 0
        ? limitUnits
        : entries.reduce((sum, entry) => sum + entry.units, 0);

    if (remaining <= 0) {
      console.log("Limit must be greater than zero.");
      return;
    }

    const customPlan = [];
    for (const entry of entries) {
      if (remaining <= 0) break;
      const units = Math.min(entry.units, remaining);
      customPlan.push({
        ...entry,
        units,
        deliveryEmail: overrideEmail || entry.deliveryEmail,
      });
      remaining -= units;
    }

    const scopeDescription = [
      orderNumber ? `order ${orderNumber}` : "",
      purchaserEmail ? `email ${redactEmailMaybe(purchaserEmail)}` : "",
    ]
      .filter(Boolean)
      .join(" & ");
    const totalUnits = customPlan.reduce((sum, entry) => sum + entry.units, 0);
    console.log(
      `About to mint ${totalUnits} Bandwidth Miner key(s) for ${scopeDescription}.`
    );

    const confirmation = (
      await this.prompt("Type CONFIRM to continue (anything else to cancel)")
    ).trim();
    if (confirmation !== "CONFIRM") {
      console.log("Operation cancelled.");
      return;
    }

    const execution = await executeAwardPlan(customPlan, {
      dryRun: false,
      skipEmail,
    });

    logger.success("Single-order generation complete", {
      createdDevices: execution.createdDevices,
      skippedDevices: execution.skippedDevices,
      emailsSent: execution.emailsSent,
      emailFailures: execution.emailFailures,
      emailSkips: execution.emailSkips,
      emailAborted: execution.emailAborted,
      errors: execution.errors,
    });
  }

  private async handleResendEmails() {
    const orderNumber = (
      await this.prompt("Order number (leave blank to target by email)")
    ).trim();
    const purchaserEmailInput = (
      await this.prompt(
        "Purchaser email (optional, required if no order number)"
      )
    ).trim();
    const purchaserEmail = purchaserEmailInput
      ? purchaserEmailInput.toLowerCase()
      : "";

    if (!orderNumber && !purchaserEmail) {
      console.log("Please provide an order number or purchaser email.");
      return;
    }

    const query: Record<string, unknown> = {
      name: BANDWIDTH_MINER_INTERNAL_NAME,
      airdrop_source_order: { $exists: true },
    };
    if (orderNumber) {
      query.order = orderNumber;
    }
    if (purchaserEmail) {
      query.email = purchaserEmail;
    }

    const criteriaDescription =
      [
        orderNumber ? `order ${orderNumber}` : "",
        purchaserEmail ? `email ${redactEmailMaybe(purchaserEmail)}` : "",
      ]
        .filter(Boolean)
        .join(" & ") || "the provided filters";

    const devices = await DeviceModel.find(query)
      .sort({ created_at: 1 })
      .lean();

    if (devices.length === 0) {
      console.log(
        `No Bandwidth Miner keys on record for ${criteriaDescription}.`
      );
      return;
    }

    const uniqueEmails = [
      ...new Set(
        devices
          .map((d) => (d.email || "").trim().toLowerCase())
          .filter((email) => !!email)
      ),
    ];
    const defaultEmail = uniqueEmails[0] || "";
    const defaultEmailDisplay = defaultEmail ? redactEmail(defaultEmail) : "";

    const targetEmailInput = (
      await this.prompt(
        `Recipient email (leave blank to use ${
          defaultEmailDisplay || "the stored email"
        })`
      )
    ).trim();
    const targetEmail = (targetEmailInput || defaultEmail).trim().toLowerCase();
    if (!targetEmail) {
      console.log("Recipient email is required.");
      return;
    }

    const keys = devices.map((device) => ({
      key: device.miner_key,
      name: device.name,
      sourceOrderNumber: device.airdrop_source_order || device.order,
      sourceOrderDate: device.airdrop_source_order_date
        ? new Date(device.airdrop_source_order_date).toISOString()
        : device.created_at
        ? new Date(device.created_at).toISOString()
        : undefined,
      parentDeviceName: undefined,
      parentDeviceKey: undefined,
    }));

    const sortedKeys = sortKeysByOrderNumber(keys);
    const customization = buildBandwidthAirdropEmailCopy({
      totalNodes: sortedKeys.length,
      totalKeys: sortedKeys.length,
    });
    await sendBandwidthAirdropEmail(targetEmail, sortedKeys, customization);
    await DeviceModel.updateMany(
      { _id: { $in: devices.map((d) => d._id) } },
      { $set: { email_sent: true, email_sent_at: new Date() } }
    );

    logger.success(
      `Resent ${keys.length} Bandwidth Miner key(s) for ${criteriaDescription} to ${redactEmailMaybe(
        targetEmail
      )}`
    );
  }

  private async handleCleanupDocs() {
    const exportDir = (
      await this.prompt(
        "Export directory containing bandwidth-airdrop-report.json (e.g. bandwidth-airdrop-exports/<timestamp>)"
      )
    ).trim();
    if (!exportDir) {
      console.log("Export directory is required.");
      return;
    }

    let ids: string[];
    try {
      ids = loadMintedDeviceIdsFromExportDir(exportDir);
    } catch (error) {
      logger.error("Failed to load minted device ids from export directory", error);
      return;
    }

    if (!ids.length) {
      console.log("No minted device ids found in report (mintedKeys empty).");
      return;
    }

    const dryRun = await cleanupBmAirdropFieldsByDeviceIds(ids, { dryRun: true });
    console.log(
      `Dry run: would match ${dryRun.matched} BM airdrop documents (missing ids: ${dryRun.missingIds.length}).`
    );

    const confirmation = (
      await this.prompt("Type CONFIRM to apply cleanup (anything else to cancel)")
    ).trim();
    if (confirmation !== "CONFIRM") {
      console.log("Cleanup cancelled.");
      return;
    }

    const result = await cleanupBmAirdropFieldsByDeviceIds(ids, { dryRun: false });
    logger.success("BM airdrop cleanup complete", {
      matched: result.matched,
      modified: result.modified,
      missingIds: result.missingIds.length,
    });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const hasArgs = argv.length > 0;

  if (hasArgs) {
    const config = parseArgs(argv);
    logger.info("Starting Bandwidth Miner airdrop planner", config);
    if (!config.dryRun) {
      await confirmExecution();
    }
    await connect();
    await runAirdrop(config);
    return;
  }

  await connect();
  const cli = new BandwidthAirdropInteractiveCLI();
  await cli.start();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(0);
}

main().catch((error) => {
  logger.error("Fatal error running Bandwidth Miner CLI", error);
  process.exit(1);
});
