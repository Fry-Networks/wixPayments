import express from "express";
import bodyparser from "body-parser";
import { secrets } from "./config/secrets.js";
import UserModel from "./db/users-schema.js";
import { connect } from "./db/connect.js";
import { generateMinerKey, getMongoUser } from "./db/utils.js";
import { redactEmail, redactKey } from "./redact-utils.js";
import { DeviceModel } from "./db/devices-schema.js";
import { sendMail } from "./MailProcessor.js";
import {
  Product,
  dataproducts,
  fetchFulfillments,
  fetchOrder,
} from "./productUpdater.js";
import fs from "fs";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import { simulateAIMinerGeneration } from "./ai-edge-miner-2/service/simulation.js";
import { generateAIMinerKeysForEligibleUsers } from "./ai-edge-miner-2/service/keys.js";
import { migrateDeviceFields } from "./ai-edge-miner-2/migration/migrate-fields.js";
import { assignParentDeviceAtomic } from "./ai-edge-miner-2/assignment/parent.js";
import {
  notifyWixKeyGeneration,
  notifySystemError,
} from "./services/notification-service.js";

// This is the secret key your server uses to authenticate requests.
// In events.js, the constant WIX_PAYMENTS_API_KEY should have the SAME value as this environment variable.
const baseApiKey = secrets.baseApiKey;
const public_key = fs.readFileSync("public.pem", "utf8");
const app = express();
// Switched from bodyparser.text to bodyparser.json to handle Velo events
app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: true }));
/*
// This parser is for the old JWT-based webhooks and is no longer needed.
app.use(
  bodyparser.text({
    type: "text/plain",
  })
);
*/

app.get("/", function (req, res) {
  res.send("sneaking around huh ?");
});

// Test endpoint to verify email functionality
app.post("/test-email", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🧪 EMAIL TEST ENDPOINT [${requestId}] - Testing email functionality`
  );

  const { email, api_key } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for email test`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Email test authenticated`
  );

  if (!email) {
    log.error(`VALIDATION ERROR [${requestId}] - Email parameter required`);
    return res.status(400).json({ error: "Email parameter required" });
  }

  try {
    log.info(`EMAIL TEST START [${requestId}]`, {
      testEmail: redactEmail(email),
    });

    // Create test miner keys
    const testKeys = [
      {
        key: "TEST-ABCD1234EFGH5678IJKL9012MNOP3456",
        name: "$FRY Test Miner Key 1",
      },
      {
        key: "TEST-WXYZ9876STUV5432QRST1098LMNO7654",
        name: "$FRY Test Miner Key 2",
      },
    ];

    log.info(`TEST KEYS PREPARED [${requestId}]`, {
      keyCount: testKeys.length,
    });

    const emailResult = await sendMail(email, testKeys);

    log.success(
      `EMAIL TEST SUCCESS [${requestId}] - Test email sent successfully`,
      {
        recipient: redactEmail(email),
        keyCount: testKeys.length,
        emailResult: {
          messageId: emailResult?.data?.id,
          threadId: emailResult?.data?.threadId,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      recipient: redactEmail(email),
      keyCount: testKeys.length,
      requestId,
      testKeys,
    });
  } catch (error) {
    log.error(`EMAIL TEST FAILED [${requestId}] - Test email failed`, error);
    res.status(500).json({
      success: false,
      error: "Email test failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    });
  }
});

// Health check endpoint
app.get("/health", function (req, res) {
  const timestamp = new Date().toISOString();
  log.info(`💓 HEALTH CHECK - Server health check requested`);

  res.status(200).json({
    status: "healthy",
    timestamp,
    server: "WixPayments Webhook Server",
    version: "2.0.0",
    endpoints: {
      fulfillment: "/wix_fulfill",
      cancellation: "/wix_canceled",
      refund: "/wix_refunded",
      debug: "/wix_web",
      manual: "/newdevice",
      emailTest: "/test-email",
      health: "/health",
      aiMinerSimulation: "/ai-miner-simulation",
      generateFreeAIMiners: "/generate-free-ai-miners",
      migrateDeviceFields: "/migrate-device-fields",
      monitorRegistrations: "/monitor-registrations",
    },
  });
});

// Repair orphan AEM children missing parent links (reusable function)
async function repairAemParentLinks(
  limit: number = 100,
  requestId?: string
): Promise<{
  success: boolean;
  repaired: number;
  attempted: number;
  failures: Array<{ id: string; email: string; order: string; error: string }>;
  error?: string;
}> {
  const sessionId = requestId || Math.random().toString(36).substr(2, 9);
  log.info(
    `🛠️ AEM PARENT REPAIR [${sessionId}] - Starting repair of orphan AEM children`
  );

  try {
    const max = limit || 100;
    // Find AEM children without parent refs but with usable email+order
    const orphans = await DeviceModel.find({
      name: "$FRY AI Edge Miner",
      $or: [
        { parent_device_id: { $exists: false } },
        { parent_device_id: null },
      ],
      email: { $exists: true, $ne: "" },
      order: { $exists: true, $ne: "" },
    })
      .sort({ created_at: 1 })
      .limit(max)
      .lean();

    if (!orphans.length) {
      log.info(
        `AEM PARENT REPAIR [${sessionId}] - No orphan AEM children found`
      );
      return { success: true, repaired: 0, attempted: 0, failures: [] };
    }

    let repaired = 0;
    const failures: Array<{
      id: string;
      email: string;
      order: string;
      error: string;
    }> = [];

    for (const child of orphans) {
      try {
        const r = await assignParentDeviceAtomic(
          child.email,
          child.order,
          child._id.toString(),
          sessionId
        );
        if (r.success && r.parentDevice) {
          await DeviceModel.updateOne(
            { _id: child._id },
            {
              $set: {
                parent_device_id: r.parentDevice._id,
                parent_device_name: r.parentDevice.name,
                parent_device_miner_key: r.parentDevice.miner_key,
              },
            }
          );
          repaired += 1;
          log.success(
            `AEM PARENT REPAIR [${sessionId}] - Linked child ${child._id} to parent ${r.parentDevice._id}`
          );
        } else {
          log.warning(
            `AEM PARENT REPAIR [${sessionId}] - No available parent for child ${child._id}`
          );
        }
      } catch (err) {
        failures.push({
          id: String(child._id),
          email: child.email,
          order: child.order,
          error: err instanceof Error ? err.message : String(err),
        });
        log.error(
          `AEM PARENT REPAIR [${sessionId}] - Failed to repair child ${child._id}`,
          err
        );
      }
    }

    log.success(`AEM PARENT REPAIR COMPLETE [${sessionId}]`, {
      repaired,
      attempted: orphans.length,
      failures: failures.length,
    });
    return { success: true, repaired, attempted: orphans.length, failures };
  } catch (error) {
    log.error(`AEM PARENT REPAIR FAILED [${sessionId}]`, error);
    return {
      success: false,
      repaired: 0,
      attempted: 0,
      failures: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Repair orphan AEM children missing parent links (HTTP endpoint)
app.post("/repair-aem-parent-links", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);

  const { api_key, limit } = req.body;
  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for AEM repair`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - AEM repair authenticated`
  );

  const result = await repairAemParentLinks(
    limit ? parseInt(String(limit)) : 100,
    requestId
  );

  if (result.success) {
    return res.status(200).json({
      success: true,
      repaired: result.repaired,
      attempted: result.attempted,
      failures: result.failures,
      requestId,
    });
  } else {
    return res.status(500).json({
      success: false,
      error: result.error,
      requestId,
    });
  }
});

// AI Miner Simulation Endpoint - Test which devices would be eligible
app.post("/ai-miner-simulation", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(`🤖 AI MINER SIMULATION [${requestId}] - Starting simulation`);

  const { api_key } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for AI miner simulation`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - AI miner simulation authenticated`
  );

  try {
    const eligibleDevices = await simulateAIMinerGeneration();

    // Group by email for preview
    const grouped = eligibleDevices.reduce((acc, device) => {
      const normalized = (device.email || "").trim().toLowerCase();
      if (!normalized) return acc;
      if (!acc[normalized]) {
        acc[normalized] = {
          email: redactEmail(device.email),
          normalizedEmail: normalized,
          count: 0,
          devices: [] as { id: any; name: string; order: string }[],
        };
      }
      acc[normalized].count += 1;
      acc[normalized].devices.push({
        id: device._id,
        name: device.name,
        order: device.order,
      });
      return acc;
    }, {} as Record<string, { email: string; normalizedEmail: string; count: number; devices: { id: any; name: string; order: string }[] }>);

    const summary = {
      totalEligibleDevices: eligibleDevices.length,
      totalUniqueEmails: Object.keys(grouped).length,
      deviceBreakdown: eligibleDevices.reduce((acc, device) => {
        const nodeType = device.name;
        acc[nodeType] = (acc[nodeType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      eligibleDevices: eligibleDevices.map((device) => ({
        id: device._id,
        name: device.name,
        order: device.order,
        email: redactEmail(device.email),
        registrationStake: device.registration?.amount || 0,
        nodeStake: device.node?.amount || 0,
        aiMinerGenerated: device.ai_miner_generated,
      })),
      groupedByEmail: Object.values(grouped).map((g) => ({
        email: g.email,
        count: g.count,
        devices: g.devices,
      })),
    };

    log.success(`AI MINER SIMULATION COMPLETE [${requestId}]`, {
      totalEligibleDevices: summary.totalEligibleDevices,
      totalUniqueEmails: summary.totalUniqueEmails,
    });

    res.status(200).json({
      success: true,
      message: "AI Miner simulation completed successfully",
      requestId,
      ...summary,
    });
  } catch (error) {
    log.error(`AI MINER SIMULATION FAILED [${requestId}]`, error);
    res.status(500).json({
      success: false,
      error: "AI Miner simulation failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    });
  }
});

// Generate Free AI Miners for Existing Users - One-time execution
app.post("/generate-free-ai-miners", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🤖 GENERATE FREE AI MINERS [${requestId}] - Starting one-time generation`
  );

  const { api_key, emails } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for free AI miner generation`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Free AI miner generation authenticated`
  );

  try {
    let emailFilter: string[] | undefined = undefined;
    if (Array.isArray(emails)) {
      // Ensure strings and non-empty
      emailFilter = emails
        .map((e: any) => String(e))
        .map((e) => e.trim())
        .filter(Boolean);
    }

    const result = await generateAIMinerKeysForEligibleUsers(emailFilter);

    log.success(`FREE AI MINER GENERATION COMPLETE [${requestId}]`, result);

    res.status(200).json({
      success: true,
      message: "Free AI Miner generation completed successfully",
      requestId,
      successCount: result.successCount,
      failCount: result.failCount,
      totalProcessed: result.successCount + result.failCount,
    });
  } catch (error) {
    log.error(`FREE AI MINER GENERATION FAILED [${requestId}]`, error);
    res.status(500).json({
      success: false,
      error: "Free AI Miner generation failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    });
  }
});

// Database Migration Endpoint - Add ai_miner_generated field to existing devices
app.post("/migrate-device-fields", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(`🔄 DEVICE MIGRATION [${requestId}] - Starting database migration`);

  const { api_key } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for device migration`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Device migration authenticated`
  );

  try {
    await migrateDeviceFields();

    log.success(`DEVICE MIGRATION COMPLETE [${requestId}]`);

    res.status(200).json({
      success: true,
      message: "Device fields migration completed successfully",
      requestId,
    });
  } catch (error) {
    log.error(`DEVICE MIGRATION FAILED [${requestId}]`, error);
    res.status(500).json({
      success: false,
      error: "Device migration failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    });
  }
});

// Manual AI Miner Registration Monitoring Endpoint - Trigger monitoring on demand
app.post("/monitor-registrations", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🔍 MANUAL MONITORING [${requestId}] - Starting manual registration monitoring`
  );

  const { api_key, emails, dryRun, batchSize, rateLimit } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for manual monitoring`
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Manual monitoring authenticated`
  );

  try {
    // Import the monitoring service for advanced features
    const { AIMinerMonitoringService } = await import(
      "./services/ai-miner-monitor.js"
    );

    // Create a configured monitoring service instance
    const monitoringService = new AIMinerMonitoringService({
      emailFilter: Array.isArray(emails)
        ? emails.map((e: any) => String(e)).filter(Boolean)
        : undefined,
      dryRun: Boolean(dryRun),
      batchSize: batchSize ? parseInt(String(batchSize)) : 50,
      rateLimit: rateLimit ? parseInt(String(rateLimit)) : 30,
    });

    log.info(`MONITORING CONFIG [${requestId}]`, monitoringService.getConfig());

    // Get eligibility stats first
    const stats = await monitoringService.getEligibilityStats();
    log.info(`ELIGIBILITY STATS [${requestId}]`, stats);

    if (stats.totalEligibleDevices === 0) {
      log.info(
        `NO ELIGIBLE DEVICES [${requestId}] - No devices ready for AEM generation`
      );
      return res.status(200).json({
        success: true,
        message: "No eligible devices found for AEM generation",
        requestId,
        stats,
        result: {
          successCount: 0,
          failCount: 0,
          processedEmails: [],
          totalDevicesProcessed: 0,
          emailsSent: 0,
          errors: [],
        },
      });
    }

    // Run the monitoring process
    const startTime = Date.now();
    const result =
      await monitoringService.monitorNewRegistrationsAndGenerateAIMiners();
    const duration = Date.now() - startTime;

    log.success(`MANUAL MONITORING COMPLETE [${requestId}]`, result);

    // NOTE: Admin notification is now handled internally by the monitoring service
    // based on smart notification rules - no manual notification needed here
    if (!dryRun) {
      log.success(
        `MONITORING COMPLETE [${requestId}] - Smart notifications handled internally`
      );
    } else {
      log.info(
        `DRY RUN COMPLETE [${requestId}] - No notifications sent for dry run`
      );
    }

    res.status(200).json({
      success: true,
      message: dryRun
        ? "Dry run monitoring completed successfully"
        : "Manual monitoring completed successfully",
      requestId,
      stats,
      result,
      config: monitoringService.getConfig(),
    });
  } catch (error) {
    log.error(`MANUAL MONITORING FAILED [${requestId}]`, error);
    res.status(500).json({
      success: false,
      error: "Manual monitoring failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    });
  }
});

// Enhanced logging utility
const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ℹ️  ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ✅ ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ⚠️  ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if (error.response?.data)
        console.log(`   Response: ${JSON.stringify(error.response.data)}`);
      if (error.stack && secrets.nodeEnv === "development")
        console.log(`   Stack: ${error.stack}`);
    }
  },
  step: (step: number, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] 🔄 Step ${step}: ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  },
};

app.post("/wix_fulfill", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🚀 WEBHOOK RECEIVED [${requestId}] - Processing fulfillment webhook`
  );

  // Security check: Ensure the request comes from our Wix backend via events.js
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== baseApiKey) {
    log.error(`🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key`);
    return res.status(401).send("Unauthorized");
  }
  log.success(`🔒 AUTHENTICATION SUCCESS [${requestId}] - API key validated`);

  res.sendStatus(200); // Respond immediately to Wix to prevent timeouts
  log.info(`📤 RESPONSE SENT [${requestId}] - HTTP 200 sent to Wix`);

  try {
    /*
    // --- OLD JWT DECODING LOGIC (COMMENTED OUT) ---
    // This logic was for the deprecated Wix Webhooks system.
    const data = req.body;
    const decoded = jwt.decode(data);
    if (!decoded) {
      console.log("No data");
      return;
    }
    const str = typeof decoded === "string" ? decoded : decoded.data;
    const first = JSON.parse(str);
    const second: RootObject = JSON.parse(first.data);
    console.log(second.updatedEvent.currentEntity.orderId);
    console.log(JSON.stringify(second.updatedEvent));
    const fulfill_data = second.updatedEvent.currentEntity;
    const order_data = await fetchOrder(fulfill_data.orderId);
    */

    // --- PAYLOAD VALIDATION ---
    log.step(1, `PAYLOAD VALIDATION [${requestId}]`, {
      bodyKeys: Object.keys(req.body),
    });

    const { event } = req.body;
    if (!event) {
      log.error(
        `PAYLOAD ERROR [${requestId}] - Missing 'event' property in request body`
      );
      return;
    }

    const orderId =
      event?.order?.id || event?.data?.order?.id || event?.orderId;
    if (!orderId) {
      log.error(
        `PAYLOAD ERROR [${requestId}] - Order ID not found in event payload`,
        { event }
      );
      return;
    }
    log.success(`ORDER ID EXTRACTED [${requestId}] - Order ID: ${orderId}`);

    // --- FETCH ORDER DATA ---
    log.step(
      2,
      `FETCHING ORDER [${requestId}] - Retrieving order data from Wix API`
    );
    const order_data = await fetchOrder(orderId);
    if (!order_data) {
      log.error(
        `ORDER FETCH FAILED [${requestId}] - Order not found in Wix: ${orderId}`
      );
      return;
    }
    log.success(`ORDER FETCHED [${requestId}]`, {
      orderNumber: order_data.number,
      fulfillmentStatus: order_data.fulfillmentStatus,
      itemCount: order_data.lineItems?.length || 0,
      customerEmail: redactEmail(order_data.buyerInfo?.email),
    });
    // --- PRODUCT PROCESSING ---
    log.step(
      3,
      `PRODUCT PROCESSING [${requestId}] - Analyzing fulfillment status`
    );

    let products_ids: { productId: string; quantity: number }[] = [];
    const products: { product: Product; quantity: number }[] = [];

    if (order_data.fulfillmentStatus == "FULFILLED") {
      log.info(`FULL FULFILLMENT [${requestId}] - Processing all order items`);
      order_data.lineItems.map((item) => {
        const found = dataproducts[item.catalogReference.catalogItemId];
        if (found) {
          products.push({ product: found, quantity: item.quantity });
          log.info(`PRODUCT MATCHED [${requestId}]`, {
            productName: found.name,
            quantity: item.quantity,
            productKey: found.key,
          });
        } else {
          log.warning(
            `PRODUCT NOT FOUND [${requestId}] - No matching product for catalog ID: ${item.catalogReference.catalogItemId}`
          );
        }
      });
    } else {
      log.info(
        `PARTIAL FULFILLMENT [${requestId}] - Processing only fulfilled items`
      );
      const fulfill_data = await fetchFulfillments(order_data.id);
      const fulfillments = fulfill_data?.fulfillments;
      if (!fulfillments) {
        log.error(
          `FULFILLMENT DATA MISSING [${requestId}] - No fulfillments found for partial order`
        );
        return;
      }
      log.info(`FULFILLMENTS FOUND [${requestId}]`, {
        fulfillmentCount: fulfillments.length,
      });

      fulfillments.map((fulfillment) => {
        fulfillment.lineItems.map((item) => {
          const index = parseInt(item.id.replaceAll("-", "")) - 1;
          const found = order_data.lineItems[index];
          if (found)
            products_ids.push({
              productId: found.catalogReference.catalogItemId,
              quantity: found.quantity,
            });
        });
      });
      products_ids.map((product) => {
        const found = dataproducts[product.productId];
        if (found) {
          products.push({ product: found, quantity: product.quantity });
          log.info(`PARTIAL PRODUCT MATCHED [${requestId}]`, {
            productName: found.name,
            quantity: product.quantity,
            productKey: found.key,
          });
        }
      });
    }

    log.success(`PRODUCT PROCESSING COMPLETE [${requestId}]`, {
      totalProductsToProcess: products.length,
      productNames: products.map((p) => p.product.name),
    });

    // --- CUSTOMER & ORDER INFO ---
    const email = order_data.buyerInfo.email;
    const order = order_data.number;
    log.step(4, `CUSTOMER INFO [${requestId}]`, {
      email: redactEmail(email),
      orderNumber: order,
      productsToProcess: products.length,
    });

    // --- CHECK EXISTING KEYS ---
    log.step(
      5,
      `CHECKING EXISTING KEYS [${requestId}] - Looking for previously generated keys`
    );
    const existingKeys = await DeviceModel.find({ order });
    log.info(`EXISTING KEYS FOUND [${requestId}]`, {
      existingKeyCount: existingKeys.length,
      existingKeys: existingKeys.map((k) => ({
        name: k.name,
        key: redactKey(k.miner_key),
      })),
    });
    const existingKeysMap = new Map<
      string,
      {
        quantity: number;
        type: string;
      }
    >();
    existingKeys.map((key) => {
      const type = key.name;
      if (existingKeysMap.has(type)) {
        const current = existingKeysMap.get(type)!;
        existingKeysMap.set(type, {
          quantity: current.quantity + 1,
          type,
        });
      } else {
        existingKeysMap.set(type, {
          quantity: 1,
          type,
        });
      }
    });
    const currentKeys = new Map<
      string,
      {
        quantity: number;
        type: string;
      }
    >();
    products.map((product) => {
      if (!product.product) return false;
      const type = product.product.name;
      if (currentKeys.has(type)) {
        const current = currentKeys.get(type)!;
        currentKeys.set(type, {
          quantity: current.quantity + product.quantity,
          type,
        });
      } else {
        currentKeys.set(type, {
          quantity: product.quantity,
          type,
        });
      }
    });

    log.info(`CURRENT ORDER REQUIREMENTS [${requestId}]`, {
      currentKeys: Array.from(currentKeys.entries()).map(([name, data]) => ({
        name,
        quantity: data.quantity,
      })),
    });

    const filtered = Array.from(currentKeys)
      .map(([key, value]) => {
        const existing = existingKeysMap.get(key);
        const productKey = Object.keys(dataproducts).find(
          (product) => dataproducts[product].name === key
        )!;
        const product = dataproducts[productKey];
        if (!existing) {
          log.info(
            `NEW PRODUCT [${requestId}] - ${key}: Need ${value.quantity} keys (none exist)`
          );
          return { product, quantity: value.quantity };
        }
        if (existing.quantity < value.quantity) {
          const needed = value.quantity - existing.quantity;
          log.info(
            `ADDITIONAL KEYS NEEDED [${requestId}] - ${key}: Need ${needed} more keys (${existing.quantity} exist, ${value.quantity} required)`
          );
          return { product, quantity: needed };
        }
        log.info(
          `SUFFICIENT KEYS [${requestId}] - ${key}: ${existing.quantity} keys already exist (${value.quantity} required)`
        );
        return false;
      })
      .filter((item) => item !== false) as {
      product: Product;
      quantity: number;
    }[];

    log.success(`KEY REQUIREMENTS CALCULATED [${requestId}]`, {
      keysToGenerate: filtered.length,
      totalNewKeys: filtered.reduce((sum, item) => sum + item.quantity, 0),
      breakdown: filtered.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
      })),
    });

    // --- MINER KEY GENERATION ---
    if (filtered.length === 0) {
      log.success(
        `NO NEW KEYS NEEDED [${requestId}] - All required keys already exist`
      );
      return;
    }

    log.step(
      6,
      `MINER KEY GENERATION [${requestId}] - Starting key generation process`
    );

    let keysObjects: {
      key: string;
      name: string;
    }[] = [];

    const user = await getMongoUser({ email });
    if (!user) {
      log.error(
        `USER NOT FOUND [${requestId}] - No user found for email: ${redactEmail(
          email
        )}`
      );
      throw new Error(`User not found for email: ${redactEmail(email)}`);
    }
    log.success(`USER FOUND [${requestId}]`, {
      userId: user._id,
      userEmail: redactEmail(user.email),
    });

    await Promise.all(
      filtered.map(async (product) => {
        const quantity = product.quantity ?? 1;
        log.info(
          `GENERATING KEYS [${requestId}] - ${product.product.name}: ${quantity} keys`
        );

        for (let i = 0; i < quantity; i++) {
          try {
            const minerKey = await generateMinerKey(product.product.key);

            const device = await DeviceModel.create({
              user_id: user._id,
              miner_key: minerKey,
              order: order.toString(),
              created_at: new Date(),
              is_registered: false,
              name: product.product.name,
              // Persist purchaser email for all devices (incl. AEM hardware)
              email: email,
            });

            log.success(`KEY GENERATED [${requestId}]`, {
              minerKey: redactKey(minerKey),
              orderNumber: order.toString(),
              productName: product.product.name,
              userEmail: redactEmail(user.email),
              keyIndex: i + 1,
              totalForProduct: quantity,
            });

            keysObjects.push({
              key: minerKey,
              name: product.product.name,
            });
          } catch (error) {
            log.error(
              `KEY GENERATION FAILED [${requestId}] - Failed to generate key ${
                i + 1
              }/${quantity} for ${product.product.name}`,
              error
            );
            throw error;
          }
        }
      })
    );

    log.success(`ALL KEYS GENERATED [${requestId}]`, {
      totalKeysGenerated: keysObjects.length,
      keysSummary: keysObjects.map((k) => ({
        name: k.name,
        key: redactKey(k.key),
      })),
    });

    // --- EMAIL SENDING ---
    let emailSuccess = false;
    if (keysObjects.length > 0) {
      log.step(
        7,
        `EMAIL SENDING [${requestId}] - Attempting to send miner keys via email`
      );
      try {
        const emailResult = await sendMail(email, keysObjects);
        emailSuccess = true;
        log.success(`EMAIL SENT SUCCESSFULLY [${requestId}]`, {
          recipient: redactEmail(email),
          keyCount: keysObjects.length,
          emailResult: {
            messageId: emailResult?.data?.id,
            threadId: emailResult?.data?.threadId,
          },
        });
      } catch (emailError) {
        log.error(
          `EMAIL SENDING FAILED [${requestId}] - Failed to send email to ${redactEmail(
            email
          )}`,
          emailError
        );
        log.warning(
          `KEYS GENERATED BUT EMAIL FAILED [${requestId}] - Miner keys were created in database but email notification failed`
        );
        // Don't throw here - keys were successfully generated
      }

      // --- ADMIN NOTIFICATION ---
      log.step(
        8,
        `ADMIN NOTIFICATION [${requestId}] - Sending admin notification`
      );
      try {
        await notifyWixKeyGeneration({
          type: "wix_order",
          triggerSource: "Wix Webhook",
          userEmail: email,
          orderNumber: order.toString(),
          keysGenerated: keysObjects.map((k) => ({
            key: k.key,
            name: k.name,
            type: k.name,
          })),
          success: emailSuccess,
          error: emailSuccess ? undefined : "Email delivery failed",
          timestamp: new Date(),
          requestId,
        });
        log.success(
          `ADMIN NOTIFICATION SENT [${requestId}] - Admin notified of key generation`
        );
      } catch (notificationError) {
        log.error(
          `ADMIN NOTIFICATION FAILED [${requestId}] - Failed to send admin notification`,
          notificationError
        );
        // Don't throw here - this shouldn't block the main process
      }
    } else {
      log.info(`NO EMAIL NEEDED [${requestId}] - No new keys were generated`);
    }

    log.success(
      `🎉 WEBHOOK PROCESSING COMPLETE [${requestId}] - Successfully processed fulfillment webhook`
    );
  } catch (error) {
    log.error(
      `💥 WEBHOOK PROCESSING FAILED [${requestId}] - Unexpected error during webhook processing`,
      error
    );

    // Send admin notification for critical webhook failures
    try {
      await notifySystemError(
        error instanceof Error ? error : new Error(String(error)),
        "Wix Webhook Processing",
        requestId
      );
    } catch (notificationError) {
      log.error(
        `FAILED TO SEND ERROR NOTIFICATION [${requestId}]`,
        notificationError
      );
    }
  }
});

app.post("/wix_canceled", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🚫 CANCELLATION WEBHOOK RECEIVED [${requestId}] - Processing order cancellation`
  );

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for cancellation`
    );
    return res.status(401).send("Unauthorized");
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Cancellation webhook authenticated`
  );

  res.sendStatus(200);
  log.info(
    `📤 RESPONSE SENT [${requestId}] - HTTP 200 sent to Wix for cancellation`
  );

  try {
    const { event } = req.body;
    const order_data = event?.order || event?.data?.order;
    if (!order_data || !order_data.number) {
      log.error(
        `PAYLOAD ERROR [${requestId}] - Could not extract order number from cancellation event`,
        { event }
      );
      return;
    }

    const order = order_data.number;
    log.info(
      `ORDER CANCELLATION [${requestId}] - Processing cancellation for order: ${order}`
    );

    const deleteResult = await DeviceModel.deleteMany({ order });
    log.success(
      `KEYS DELETED [${requestId}] - Removed ${deleteResult.deletedCount} miner keys for canceled order ${order}`
    );
  } catch (error) {
    log.error(
      `💥 CANCELLATION PROCESSING FAILED [${requestId}] - Error processing cancellation`,
      error
    );
  }
});

app.post("/wix_refunded", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `💰 REFUND WEBHOOK RECEIVED [${requestId}] - Processing order refund`
  );

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for refund`
    );
    return res.status(401).send("Unauthorized");
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Refund webhook authenticated`
  );

  res.sendStatus(200);
  log.info(`📤 RESPONSE SENT [${requestId}] - HTTP 200 sent to Wix for refund`);

  try {
    const { event } = req.body;
    const order_data = event?.order || event?.data?.order;
    if (!order_data || !order_data.number) {
      log.error(
        `PAYLOAD ERROR [${requestId}] - Could not extract order number from refund event`,
        { event }
      );
      return;
    }

    const order = order_data.number;
    log.info(
      `ORDER REFUND [${requestId}] - Processing refund for order: ${order}`
    );

    const deleteResult = await DeviceModel.deleteMany({ order });
    log.success(
      `KEYS DELETED [${requestId}] - Removed ${deleteResult.deletedCount} miner keys for refunded order ${order}`
    );
  } catch (error) {
    log.error(
      `💥 REFUND PROCESSING FAILED [${requestId}] - Error processing refund`,
      error
    );
  }
});

app.post("/wix_web", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🔍 DEBUG WEBHOOK RECEIVED [${requestId}] - Raw webhook debugging endpoint`
  );

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for debug webhook`
    );
    return res.status(401).send("Unauthorized");
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Debug webhook authenticated`
  );

  res.sendStatus(200);
  log.info(
    `📤 RESPONSE SENT [${requestId}] - HTTP 200 sent to Wix for debug webhook`
  );

  log.info(`🔍 RAW WEBHOOK PAYLOAD [${requestId}]`, {
    headers: req.headers,
    body: req.body,
    method: req.method,
    url: req.url,
  });
});

// Simple One-Click Unsubscribe endpoint
app.get("/unsubscribe", async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  const token = (req.query.token as string) || "";
  console.log(
    `[${new Date().toISOString()}] 📭 UNSUBSCRIBE REQUEST [${requestId}]`
  );
  if (!token) {
    res.status(400).send("<h2>Invalid request</h2><p>Missing token.</p>");
    return;
  }
  try {
    const decoded: any = jwt.verify(token, secrets.unsubscribeSecret);
    const email = (decoded?.email || "").toString().trim().toLowerCase();
    if (!email) {
      res
        .status(400)
        .send("<h2>Invalid request</h2><p>Invalid token payload.</p>");
      return;
    }
    await UserModel.updateOne(
      { email },
      { $set: { do_not_email: true } },
      { upsert: true }
    );
    console.log(
      `[${new Date().toISOString()}] ✅ UNSUBSCRIBED [${requestId}] ${email}`
    );
    res
      .status(200)
      .send(
        "<h2>You have been unsubscribed.</h2><p>You will no longer receive emails from FRY Networks at this address.</p>"
      );
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}] ❌ UNSUBSCRIBE ERROR [${requestId}]`,
      err?.message || err
    );
    res
      .status(400)
      .send(
        "<h2>Invalid or expired link</h2><p>Please contact support if you continue receiving emails.</p>"
      );
  }
});

app.post("/newdevice", async function (req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  log.info(
    `🔧 MANUAL DEVICE CREATION [${requestId}] - Processing manual device creation request`
  );

  const { email, device_name, api_key, device_type } = req.body;

  if (api_key !== baseApiKey) {
    log.error(
      `🔒 AUTHENTICATION FAILED [${requestId}] - Invalid API key for manual device creation`
    );
    res.status(401).send("Unauthorized");
    return;
  }
  log.success(
    `🔒 AUTHENTICATION SUCCESS [${requestId}] - Manual device creation authenticated`
  );

  try {
    log.info(`MANUAL DEVICE REQUEST [${requestId}]`, {
      email: redactEmail(email),
      device_name,
      device_type,
    });

    const user = await getMongoUser({ email });
    if (!user) {
      log.error(
        `USER NOT FOUND [${requestId}] - No user found for email: ${redactEmail(
          email
        )}`
      );
      res.status(404).json({ error: "User not found" });
      return;
    }
    log.success(`USER FOUND [${requestId}]`, {
      userId: user._id,
      userEmail: redactEmail(user.email),
    });

    const minerKey = await generateMinerKey(device_type);
    log.success(`MINER KEY GENERATED [${requestId}]`, {
      minerKey: redactKey(minerKey),
      deviceType: device_type,
    });

    const device = await DeviceModel.create({
      user_id: user._id,
      miner_key: minerKey,
      created_at: new Date(),
      is_registered: false,
      name: device_name,
      // Persist requester email for manual device creation
      email: email,
    });
    await device.save();
    log.success(`DEVICE SAVED [${requestId}]`, {
      deviceId: device._id,
      minerKey: redactKey(minerKey),
    });

    try {
      await sendMail(email, [{ key: minerKey, name: device_name }]);
      log.success(
        `EMAIL SENT [${requestId}] - Manual device key sent to ${redactEmail(
          email
        )}`
      );
    } catch (emailError) {
      log.error(
        `EMAIL FAILED [${requestId}] - Failed to send manual device key email`,
        emailError
      );
      // Continue anyway - device was created successfully
    }

    log.success(
      `🎉 MANUAL DEVICE CREATED [${requestId}] - Successfully created manual device`
    );
    res.status(200).json({
      message: "Device created successfully",
      minerKey,
      deviceName: device_name,
      requestId,
    });
  } catch (error) {
    log.error(
      `💥 MANUAL DEVICE CREATION FAILED [${requestId}] - Error creating manual device`,
      error
    );
    res.status(500).json({ error: "Internal server error", requestId });
  }
});

// Global variable to track if cron job is already scheduled
let cronJobScheduled = false;

async function startApi() {
  const port = secrets.port;
  await connect();

  // Auto-run AEM parent links repair on dev startup
  if (secrets.nodeEnv === "development") {
    const startupRepairId = Math.random().toString(36).substr(2, 9);
    log.info(
      `🚀 DEV STARTUP [${startupRepairId}] - Running automatic AEM parent links repair`
    );

    try {
      const repairResult = await repairAemParentLinks(100, startupRepairId);
      if (repairResult.success) {
        log.success(
          `🚀 DEV STARTUP REPAIR COMPLETE [${startupRepairId}] - Repaired ${repairResult.repaired}/${repairResult.attempted} orphan AEM children`
        );
      } else {
        log.error(
          `🚀 DEV STARTUP REPAIR FAILED [${startupRepairId}] - ${repairResult.error}`
        );
      }
    } catch (error) {
      log.error(
        `🚀 DEV STARTUP REPAIR ERROR [${startupRepairId}] - Unexpected error during startup repair`,
        error
      );
    }
  }

  // Schedule hourly job to monitor for new AI miner eligibility (only once)
  if (!cronJobScheduled) {
    cron.schedule("0 * * * *", async () => {
      const sessionId = Math.random().toString(36).substr(2, 9);
      log.info(
        `🕐 SCHEDULED JOB [${sessionId}] - Starting hourly AI miner monitoring`
      );

      try {
        // Import the monitoring service for full functionality with smart notifications
        const { defaultMonitoringService } = await import(
          "./services/ai-miner-monitor.js"
        );

        // Run monitoring with proper trigger source for smart notification logic
        const result =
          await defaultMonitoringService.monitorNewRegistrationsAndGenerateAIMiners(
            "scheduled_hourly"
          );

        log.success(
          `🕐 SCHEDULED JOB COMPLETE [${sessionId}] - Hourly monitoring finished`,
          {
            devicesFound: result.totalDevicesProcessed,
            successCount: result.successCount,
            failCount: result.failCount,
            emailsSent: result.emailsSent,
          }
        );

        // NOTE: Notification logic is now handled internally by the monitoring service
        // based on smart notification rules (no spam, 8-hour health checks, activity alerts)
      } catch (error) {
        log.error(
          `🕐 SCHEDULED JOB FAILED [${sessionId}] - Hourly AI miner monitoring error`,
          error
        );

        // Send error notification for failed monitoring
        try {
          await notifySystemError(
            error instanceof Error ? error : new Error(String(error)),
            "Scheduled AI Miner Monitoring",
            sessionId
          );
        } catch (notificationError) {
          log.error(
            `FAILED TO SEND MONITORING ERROR NOTIFICATION [${sessionId}]`,
            notificationError
          );
        }
      }
    });

    cronJobScheduled = true;
    log.info(
      "🕐 SCHEDULED JOB CONFIGURED - Smart notification system enabled for hourly monitoring"
    );
  } else {
    log.info("🕐 SCHEDULED JOB SKIPPED - Cron job already configured");
  }

  app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    log.info(`🚀 SERVER STARTED - AI Edge Miner system ready on port ${port}`);
  });
}

startApi();

export default app;
