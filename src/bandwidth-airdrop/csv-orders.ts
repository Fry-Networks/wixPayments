import fs from "node:fs";
import path from "node:path";
import type { Order, LineItem } from "../otherTypes.js";
import { logger } from "./logger.js";

type CsvRow = {
  orderNumber: string;
  createdDate?: string;
  email: string;
  item: string;
  quantity: number;
  paymentStatus: string;
  fulfillmentStatus: string;
};

type LoadOptions = {
  limit?: number;
  fromDate?: Date;
  toDate?: Date;
  csvPath?: string;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let insideQuotes = false;
  let row: string[] = [];

  const pushCell = () => {
    row.push(current);
    current = "";
  };

  const pushRow = () => {
    if (row.length === 0) return;
    rows.push(row.map((cell) => cell.trim()));
    row = [];
  };

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (insideQuotes && content[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      pushCell();
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && content[i + 1] === "\n") {
        i++;
      }
      pushCell();
      pushRow();
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }
  return rows;
}

function mapHeaders(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((value, index) => {
    map[value.trim().toLowerCase()] = index;
  });
  return map;
}

function readCsvRows(filePath: string): CsvRow[] {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`CSV file not found at ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, "utf8");
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const headerMap = mapHeaders(rows[0]);

  const getValue = (row: string[], key: string): string => {
    const idx = headerMap[key.toLowerCase()];
    if (idx === undefined) return "";
    return row[idx] || "";
  };

  const dataRows: CsvRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const orderNumber = getValue(row, "Order number").trim();
    const email = getValue(row, "Contact email").trim().toLowerCase();
    const item = getValue(row, "Item").trim();
    const qty = parseInt(getValue(row, "Qty"), 10) || 0;

    if (!orderNumber || !email || qty <= 0) continue;

    dataRows.push({
      orderNumber,
      createdDate: getValue(row, "Date created").trim(),
      email,
      item,
      quantity: qty,
      paymentStatus: getValue(row, "Payment status").trim() || "PAID",
      fulfillmentStatus:
        getValue(row, "Fulfillment status").trim() || "FULFILLED",
    });
  }

  return dataRows;
}

function buildLineItem(
  key: string,
  item: string,
  quantity: number
): LineItem {
  const amount = { amount: "0", formattedAmount: "0" };
  return {
    id: `${key}-${Math.random().toString(36).slice(2, 9)}`,
    productName: { original: item, translated: item },
    catalogReference: {
      catalogItemId: item,
      appId: "",
      options: { options: {}, variantId: "" },
    },
    quantity,
    totalDiscount: amount,
    descriptionLines: [],
    image: { id: "", url: "", height: 0, width: 0 },
    physicalProperties: { sku: "", shippable: true },
    itemType: { preset: "" },
    price: amount,
    priceBeforeDiscounts: amount,
    totalPriceBeforeTax: amount,
    totalPriceAfterTax: amount,
    paymentOption: "",
    taxDetails: {
      taxableAmount: amount,
      taxRate: "0",
      totalTax: amount,
    },
    shippingGroupId: "",
    locations: [],
    lineItemPrice: amount,
    customLineItem: false,
  };
}

export function loadWixOrdersFromCsv(
  csvPath: string,
  options: LoadOptions = {}
): Order[] {
  let rows = readCsvRows(csvPath);
  if (!rows.length) {
    logger.warn(`No rows found in ${csvPath}`);
    return [];
  }

  if (options.fromDate || options.toDate) {
    const fromMs = options.fromDate?.getTime();
    const toMs = options.toDate?.getTime();
    rows = rows.filter((row) => {
      if (!row.createdDate) return true;
      const timestamp = new Date(row.createdDate).getTime();
      if (Number.isNaN(timestamp)) return true;
      if (fromMs && timestamp < fromMs) return false;
      if (toMs && timestamp > toMs) return false;
      return true;
    });
  }

  const groups = new Map<
    string,
    {
      orderNumber: string;
      email: string;
      createdDate?: string;
      paymentStatus: string;
      fulfillmentStatus: string;
      lineItems: LineItem[];
    }
  >();

  for (const row of rows) {
    const key = `${row.orderNumber}||${row.email}`;
    let group = groups.get(key);
    if (!group) {
      if (options.limit && groups.size >= options.limit) {
        break;
      }
      group = {
        orderNumber: row.orderNumber,
        email: row.email,
        createdDate: row.createdDate,
        paymentStatus: row.paymentStatus || "PAID",
        fulfillmentStatus: row.fulfillmentStatus || "FULFILLED",
        lineItems: [],
      };
      groups.set(key, group);
    }
    group.lineItems.push(buildLineItem(key, row.item, row.quantity));
  }

  const orders: Order[] = [];
  for (const group of groups.values()) {
    const createdAt = group.createdDate
      ? new Date(group.createdDate).toISOString()
      : undefined;
    const order: Partial<Order> = {
      id: `${group.orderNumber}-${group.email}`,
      number: group.orderNumber,
      createdDate: createdAt,
      updatedDate: createdAt,
      buyerInfo: { email: group.email } as any,
      paymentStatus: group.paymentStatus,
      fulfillmentStatus: group.fulfillmentStatus,
      status: group.fulfillmentStatus,
      lineItems: group.lineItems,
    };
    orders.push(order as Order);
  }

  logger.info(
    `Loaded ${orders.length} Wix orders from CSV ${path.resolve(csvPath)}`
  );
  return orders;
}
