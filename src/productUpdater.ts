import axios from "axios";
import express from "express";
import { ProductModel } from "./db/products-schema.js";
import { connect } from "./db/connect.js";
import { secrets } from "./config/secrets.js";
import { Order } from "otherTypes.js";
import { OrderWithFulfillments } from "fulfillTypes.js";
const app = express();
app.use(express.json());

const baseUrl = `https://www.wixapis.com/stores/v1/products/query`;

let products: Product[] = [];

// Map new Wix product names to internal legacy names (maintains backward compatibility)
function mapWixNameToInternalName(wixName: string): string {
  const wixToInternalMapping: { [key: string]: string } = {
    "Fry AI Edge Agent": "$FRY AI Edge Miner",
    "Fry Storage Validator Node": "$FRY Storage Validator Node",
    "Fry Storage Node": "$FRY Storage Decentralization Node",
    "Fry Compute Node": "$FRY Reward Decentralization Node",
    "Fry Outdoor Low-End Water Quality Sensor":
      "$FRY Outdoor Low-End Water Quality Miner",
    "Fry Outdoor High-End Water Quality Sensor":
      "$FRY Outdoor High-End Water Quality Miner",
    "Fry Indoor High-End Air Quality Sensor":
      "$FRY Indoor High-End Air Quality Miner",
    "Fry Outdoor High-End Air Quality Sensor":
      "$FRY Outdoor High-End Air Quality Miner",
    "Fry Indoor Low-End Air Quality Sensor":
      "$FRY Indoor Low-End Air Quality Miner",
    "Fry Outdoor Mid-End Air Quality Sensor":
      "$FRY Outdoor Mid-End Air Quality Miner",
    "Fry Indoor Mid-End Air Quality Sensor":
      "$FRY Indoor Mid-End Air Quality Miner",
    "Fry Energy Gateway": "$FRY Energy Miner",
    "Fry Indoor Radiation Sensor": "$FRY Indoor Radiation Miner",
    "Fry AI Outdoor Weather Station Camera":
      "$FRY AI Outdoor Weather Station Camera Miner",
    "Fry AI Indoor Weather Station Camera":
      "$FRY AI Indoor Weather Station Camera Miner",
    "Fry AI Outdoor Wildlife Camera": "$FRY AI Outdoor Wildlife Camera Miner",
    "Fry AI Indoor Wildlife Camera": "$FRY AI Indoor Wildlife Camera Miner",
    "Fry AI Outdoor Sky Camera": "$FRY AI Outdoor Sky Camera Miner",
    "Fry AI Indoor Sky Camera": "$FRY AI Indoor Sky Camera Miner",
    "Fry AI Outdoor Traffic Camera": "$FRY AI Outdoor Traffic Camera Miner",
    "Fry AI Indoor Traffic Camera": "$FRY AI Indoor Traffic Camera Miner",
    "Fry High-End Weather Station": "$FRY High-End Weather Miner",
    "Fry Low-End Weather Station": "$FRY Low-End Weather Miner",
    "Fry Outdoor Noise Sensor": "$FRY Outdoor Decibel Miner",
    "Fry Indoor Noise Sensor": "$FRY Indoor Decibel Miner",
    "Fry Outdoor Satellite Sensor": "$FRY Outdoor Satellite Miner",
    "Fry Indoor Satellite Sensor": "$FRY Indoor Satellite Miner",
    "Fry Bandwidth Gateway": "$FRY Bandwidth Miner",
  };

  return wixToInternalMapping[wixName] || wixName;
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
    const names = response.data.products.map((product: any) => product.name);
    console.log("Wix product names:", names);

    products = response.data.products
      .filter((product: any) => product.name.includes("Fry"))
      .map((product: any) => {
        // Map new Wix name to internal legacy name
        const internalName = mapWixNameToInternalName(product.name);
        console.log(`Mapped: "${product.name}" -> "${internalName}"`);

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

    console.log("Product print!!!!");
    console.log(products);
  } catch (error: any) {
    console.error("Error fetching products:", error.response.data);
  }
  //check for unicity of keys
  let keys: string[] = [];
  products.forEach((product: any) => {
    if (keys.includes(product.key)) {
      throw new Error("Duplicate key: " + product.key);
    } else {
      keys.push(product.key);
    }
  });
  await connect();
  const promises = products.map(async (product: any) => {
    return new Promise(async (resolve, reject) => {
      if (await ProductModel.exists({ name: product.name })) {
        const old: Product | null = await ProductModel.findOne({
          name: product.name,
        });
        if (old) {
          let isTheSame = true;
          for (let key in old) {
            if (old[key as keyof Product] != product[key as keyof Product]) {
              isTheSame = false;
            }
          }
          if (!isTheSame) {
            await ProductModel.updateOne({ name: product.name }, product);
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
