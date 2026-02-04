import axios from "axios";
import { secrets } from "../config/secrets.js";
import { logger } from "./logger.js";
import { DEFAULT_PAGE_SIZE, DEFAULT_RATE_LIMIT_MS } from "./constants.js";
import type { Order } from "../otherTypes.js";

const WIX_ORDERS_QUERY_URL = "https://www.wixapis.com/ecom/v1/orders/query";

export interface FetchOrdersOptions {
  limit?: number;
  fromDate?: Date;
  toDate?: Date;
  batchDelayMs?: number;
}

export async function fetchOrdersFromWix(
  options: FetchOrdersOptions = {}
): Promise<Order[]> {
  const records: Order[] = [];
  let cursor: string | undefined;
  let done = false;
  const limit = options.limit;
  const delayMs = options.batchDelayMs ?? DEFAULT_RATE_LIMIT_MS;

  while (!done) {
    let payload: any;
    if (cursor) {
      payload = { query: { cursor } };
    } else {
      const query: any = {
        sort: [{ fieldName: "createdDate", order: "DESC" }],
        paging: { limit: DEFAULT_PAGE_SIZE },
      };
      if (options.fromDate || options.toDate) {
        query.filter = {};
        if (options.fromDate) {
          query.filter.createdDate = query.filter.createdDate || {};
          query.filter.createdDate.$gte = options.fromDate.toISOString();
        }
        if (options.toDate) {
          query.filter.createdDate = query.filter.createdDate || {};
          query.filter.createdDate.$lte = options.toDate.toISOString();
        }
      }
      payload = { query };
    }

    try {
      const response = await axios.post(WIX_ORDERS_QUERY_URL, payload, {
        headers: {
          Authorization: secrets.authToken,
          "wix-site-id": secrets.siteId,
          "Content-Type": "application/json",
        },
      });

      const batch: Order[] = response.data?.orders || [];
      logger.info(
        `Fetched ${batch.length} orders from Wix (running total: ${
          records.length + batch.length
        })`
      );
      records.push(...batch);

      if (limit && records.length >= limit) {
        done = true;
      } else if (response.data?.pagingMetadata?.cursors?.next) {
        cursor = response.data.pagingMetadata.cursors.next;
      } else {
        done = true;
      }
    } catch (error: any) {
      logger.error("Failed to fetch orders from Wix", {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
      throw error;
    }

    if (!done && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (limit && records.length > limit) {
    return records.slice(0, limit);
  }

  return records;
}
