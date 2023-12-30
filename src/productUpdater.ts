
const auth = "IST.REDACTED_ROTATE_ME";
const site_id = "REDACTED_ROTATE_ME";

import axios from 'axios';
import express from 'express';
import { ProductModel } from './db/products-schema.js';
import { connect } from './db/connect.js';
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
                'Authorization': auth,
                'wix-site-id': site_id
            },

        });
        products = response.data.products
        .filter((product: any) => product.name.includes("$FRY")).map((product: any) => {
            return {
                wix_id: product.id,
                name: product.name,
                price: product.price.price,
                key: product.name.replace("$FRY ", "").split(" ").map((word: string) => word[0]).join("")
            }
        });

        
    } catch (error) {
        console.error('Error fetching products:', error);
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
    setInterval(fetchAllProducts, 1000 * 60 * 10);
}

init();





type Product = {
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
