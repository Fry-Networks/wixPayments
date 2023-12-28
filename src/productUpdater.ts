
const auth = "REDACTED_ROTATE_ME";
const site_id = "REDACTED_ROTATE_ME";

import axios from 'axios';
import express from 'express';

const app = express();
app.use(express.json());

const baseUrl = `https://www.wixapis.com/stores/v1/products/query`;

let products: any[] = [];

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
        products = response.data.products;
        console.log('Products fetched:', products);
    } catch (error) {
        console.error('Error fetching products:', error);
    }
    console.log('Products fetched:', products);
}

// Setting up a listener for new products
app.post('/product-created', async (req, res) => {
    console.log('New product created:', req.body);
    products.push(req.body); // Add the new product to the products array
    res.status(200).send('Received');
});

// Initialize products list and start the server
async function init() {
    await fetchAllProducts();
    /*
    const port = 3000;
    app.listen(port, () => console.log(`Server running on port ${port}`));
    */
}

init();





type Product = {
    name: string;
    price: number;
    key: string;
  };
  
  type Products = {
    [key: string]: Product;
  };

export const dataproducts: Products = {
    /*
    "9eedd82b-4168-b6d1-d020-6f8b12cc71bf": {
        name: "$FRY Decentralization Node",
        price: 230,
    },
    */
    "6fea7152-32a6-1935-5a47-22ae481c1edf": {
        name: "$FRY Outdoor Decibel Miner",
        price: 170,
        key: 'ODB'
    },
    "fa34127a-0d9a-b0ce-e7de-fbb03169dce0": {
        name: "$FRY Indoor Decibel Miner",
        price: 170,
        key: 'IDB'
    },
    "65fc3d33-b804-3745-6705-d2336d37c71d": {
        name: "$FRY Outdoor Satellite Miner",
        price: 230,
        key: 'OGPS'
    },
    /*
    "ab103f54-92fe-4c02-9da3-bc71f9e930b9": {
        name: "$FRY Recycled Poly Socks",
        price: 20
    },
    */
    "7b3bff0b-327c-411b-81de-b19c075110ab": {
        name: "$FRY Indoor Satellite Miner",
        price: 230,
        key: 'IGPS'
    },
    "b0b98ffd-f0a8-4d71-b1b2-6d65686c3f93": {
        name: "$FRY Bandwidth Miner",
        price: 230,
        key: 'VPN'
    }
}