import axios from "axios";
import express from "express";
import { ProductModel } from "./db/products-schema.js";
import { connect } from "./db/connect.js";
import { secrets } from "./config/secrets.js";
import { Order } from "otherTypes.js";
import { OrderWithFulfillments } from "fulfillTypes.js";
import { log } from "./logger.js";
const app = express();
app.use(express.json());

const baseUrl = `https://www.wixapis.com/stores/v1/products/query`;

let products: Product[] = [];
let hasLoggedProductSummary = false;

// Post-FEM migration: all Wix products map to single internal name
function mapWixNameToInternalName(wixName: string): string {
  return "Fry Edge Miner";
}

// Function to fetch all products
async function fetchAllProducts() {
  try {
    const requestBody = {
      includeVariants: true,
    };

    const response = await axios.post(baseUrl, requestBody, {
      headers: {
        Authorization: secrets.authToken,
        "wix-site-id": secrets.siteId,
      },
    });
    let mappedCount = 0;
    const totalCount = response.data.products.length;
    const names = response.data.products.map((product: any) => product.name);
    log.detail("Wix product names", names);
    products = response.data.products
      .filter((product: any) => product.name.includes("Fry"))
      .map((product: any) => {
        // Map new Wix name to internal legacy name
        const internalName = mapWixNameToInternalName(product.name);
        if (internalName !== product.name) mappedCount += 1;
        if (internalName !== product.name) {
          log.detail("Product mapped", { from: product.name, to: internalName });
        }

        const key = internalName
          .replace("$FRY ", "")
          .split(" ")
          .map((word: string) => word[0])
          .join("");
        let type = "mac";

        // Define the conditions for each type
        if (
          [
            "BM",
            "ISM",
            "OSM",
            "IDM",
            "ODM",
            "CN",
            "SDN",
            "RDN",
            "SVN",
          ].includes(key)
        ) {
          type = "hardware"; // Bandwidth Miner / Indoor & Outdoor Satellite / Indoor & Outdoor Decibel
        } else if (
          ["HWM", "LWM", "OWQM", "OHWQM", "OLWQM", "EM"].includes(key)
        ) {
          type = "apikey"; // High & Low End Weather / Water Quality / Energy
        } else if (
          [
            "IWCM",
            "OWCM",
            "AOWSCM",
            "AOWCM",
            "AIWCM",
            "AIWSCM",
            "AISCM",
            "AOSCM",
            "OWSCM",
            "IWSCM",
            "AITCM",
            "AOTCM",
          ].includes(key)
        ) {
          type = "rtsp"; // All Camera Miners
        } else if (["IRM", "IHAQM", "OHAQM", "ILAQM"].includes(key)) {
          type = "mac"; // Radiation Miner / Indoor & Outdoor Air Quality
        }

        return {
          wix_id: product.id,
          name: internalName, // Use internal legacy name for all downstream processing
          price: product.price.price,
          type: type,
          key: key,
        };
      });

    log.detail("Product list", products);
    if (!hasLoggedProductSummary) {
      log.info(
        `Wix products fetched (startup): total=${totalCount}, fry=${products.length}, mapped=${mappedCount}`
      );
      hasLoggedProductSummary = true;
    }
  } catch (error: any) {
    log.error("Error fetching products", error);
  }
  // Post-FEM migration: all products share key=FEM; unicity enforced by wix_id unique index
  await connect();
  const promises = products.map(async (product: any) => {
    return new Promise(async (resolve, reject) => {
      if (await ProductModel.exists({ wix_id: product.wix_id })) {
        const old: Product | null = await ProductModel.findOne({
          wix_id: product.wix_id,
        });
        if (old) {
          let isTheSame = true;
          for (let key in old) {
            if (old[key as keyof Product] != product[key as keyof Product]) {
              isTheSame = false;
            }
          }
          if (!isTheSame) {
            await ProductModel.updateOne({ wix_id: product.wix_id }, product);
          }
        }
      } else {
        await ProductModel.create(product);
      }
      resolve(void 0);
    });
  });
  await Promise.all(promises);
  dataproducts = products.reduce((acc: Products, product: Product) => {
    acc[product.wix_id] = product;
    return acc;
  }, {});
}

// Initialize products list and start the server
async function init() {
  await fetchAllProducts();
  console.log("Products fetched!");
  setInterval(fetchAllProducts, 1000 * 60 * 10);
}

init();

export async function fetchOrder(order_id: string): Promise<Order | undefined> {
  try {
    const response = await axios.get(
      `https://www.wixapis.com/ecom/v1/orders/${order_id}`,
      {
        headers: {
          Authorization: secrets.authToken,
          "wix-site-id": secrets.siteId,
        },
      }
    );
    return response.data.order;
  } catch (error: any) {
    console.error("Error fetching order:", error.response.data);
  }
}
export async function fetchFulfillments(
  order_id: string
): Promise<OrderWithFulfillments | undefined> {
  try {
    const response = await axios.get(
      `https://www.wixapis.com/ecom/v1/fulfillments/orders/${order_id}`,
      {
        headers: {
          Authorization: secrets.authToken,
          "wix-site-id": secrets.siteId,
        },
      }
    );
    return response.data.orderWithFulfillments;
  } catch (error: any) {
    console.error("Error fetching fulfillments:", error.response.data);
  }
}

export type Product = {
  wix_id: string;
  name: string;
  price: number;
  key: string;
};

type Products = {
  [key: string]: Product;
};

export let dataproducts: Products = products.reduce(
  (acc: Products, product: Product) => {
    acc[product.wix_id] = product;
    return acc;
  },
  {}
);
