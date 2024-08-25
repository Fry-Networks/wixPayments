
import axios from 'axios';
import express from 'express';
import { ProductModel } from './db/products-schema.js';
import { connect } from './db/connect.js';
import 'dotenv/config';
import { Order } from 'otherTypes.js';
import { OrderWithFulfillments } from 'fulfillTypes.js';
const app = express();
app.use(express.json());

const baseUrl = `https://www.wixapis.com/stores/v1/products/query`;

let products: Product[] = [];

// Function to fetch all products
async function fetchAllProducts() {
    try {
        const requestBody = {
            includeVariants: true
        };

        const response = await axios.post(baseUrl, requestBody, {
            headers: {
                'Authorization': process.env.AUTH_TOKEN,
                'wix-site-id': process.env.SITE_ID
            },

        });
        products = response.data.products
            .filter((product: any) => product.name.includes("$FRY")).map((product: any) => {
                const key = product.name.replace("$FRY ", "").split(" ").map((word: string) => word[0]).join("")
                let type = 'mac';

                // Define the conditions for each type
                if (['BM', 'ISM', 'OSM', 'IDM', 'ODM', 'CN','SDN','RDN', 'SVN'].includes(key)) {
                    type = 'hardware'; // Bandwidth Miner / Indoor & Outdoor Satellite / Indoor & Outdoor Decibel
                } else if (['HWM', 'LWM', 'OWQM', 'OHWQM', 'OLWQM', 'EM'].includes(key)) {
                    type = 'apikey'; // High & Low End Weather / Water Quality / Energy
                } else if (['IWCM', 'OWCM', 'AOWSCM','AOWCM', 'AIWCM', 'AIWSCM','AISCM', 'AOSCM', 'OWSCM', 'IWSCM', 'AITCM', 'AOTCM'].includes(key)) {
                    type = 'rtsp'; // All Camera Miners
                } else if (['IRM', 'IHAQM', 'OHAQM','ILAQM'].includes(key)) {
                    type = 'mac'; // Radiation Miner / Indoor & Outdoor Air Quality
                }

                return {
                    wix_id: product.id,
                    name: product.name,
                    price: product.price.price,
                    type: type,
                    key: key,
                }
            });

    } catch (error: any) {
        console.error('Error fetching products:', error.response.data);
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
                const old: Product | null = await ProductModel.findOne({ name: product.name });
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
        }
        );
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
    console.log('Products fetched');
    setInterval(fetchAllProducts, 1000 * 60 * 10);
}

init();

export async function fetchOrder(order_id: string): Promise<Order | undefined> {
    try {
        const response = await axios.get(`https://www.wixapis.com/ecom/v1/orders/${order_id}`, {
            headers: {
                'Authorization': process.env.AUTH_TOKEN,
                'wix-site-id': process.env.SITE_ID
            }
        });
        return response.data.order
    } catch (error: any) {
        console.error('Error fetching order:', error.response.data);
    }

}
export async function fetchFulfillments(order_id: string): Promise<OrderWithFulfillments | undefined> {
    try {
        const response = await axios.get(`https://www.wixapis.com/ecom/v1/fulfillments/orders/${order_id}`, {
            headers: {
                'Authorization': process.env.AUTH_TOKEN,
                'wix-site-id': process.env.SITE_ID
            }
        });
        return response.data.orderWithFulfillments
    } catch (error: any) {
        console.error('Error fetching fulfillments:', error.response.data);
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

export let dataproducts: Products = products.reduce((acc: Products, product: Product) => {
    acc[product.wix_id] = product;
    return acc;
}, {});
