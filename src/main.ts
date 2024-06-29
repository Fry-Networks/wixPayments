import express from 'express';
import bodyparser from 'body-parser';
import 'dotenv/config'
import { connect } from './db/connect.js';
import { generateMinerKey, getMongoUser } from './db/utils.js';
import { DeviceModel } from './db/devices-schema.js';
import { sendMail } from './MailProcessor.js';
import { Product, dataproducts, fetchFulfillments, fetchOrder } from './productUpdater.js';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { RootObject } from 'types.js';

const baseApiKey = process.env.BASE_API_KEY;
const public_key = fs.readFileSync('public.pem', 'utf8');
const app = express();
app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: true }));
app.use(bodyparser.text({
    type: 'text/plain'
}));

app.get('/', function (req, res) {
    res.send('sneaking around huh ?')
})

app.post('/wix_fulfill', async function (req, res) {
    res.sendStatus(200);
    try {
        const data = req.body;
        const decoded = jwt.decode(data);
        if (!decoded) {
            console.log('No data');
            return;
        }
        const str = typeof decoded === 'string' ? decoded : decoded.data
        const first = JSON.parse(str);
        const second: RootObject = JSON.parse(first.data);
        console.log(second.updatedEvent.currentEntity.orderId);
        const fulfill_data = second.updatedEvent.currentEntity;
        const order_data = await fetchOrder(fulfill_data.orderId);
        if (!order_data) {
            console.log('Order not found');
            return;
        }
        let products_ids: { productId: string, quantity: number }[] = [];
        const products: { product: Product, quantity: number }[] = [];
        if (order_data.fulfillmentStatus == 'FULFILLED') {
            console.log('Order entirely fulfilled');
            order_data.lineItems.map((item) => {

                const found = dataproducts[item.catalogReference.catalogItemId];

                if (found) products.push({ product: found, quantity: item.quantity });
            });
        } else {
            console.log('Order partially fulfilled');
            const fulfill_data = await fetchFulfillments(order_data.id);
            const fulfillments = fulfill_data?.fulfillments;
            if (!fulfillments) {
                console.log('No fulfillments');
                return;
            }
            fulfillments.map((fulfillment) => {
                fulfillment.lineItems.map((item) => {
                    const index = parseInt(item.id.replaceAll('-', '')) - 1;
                    const found = order_data.lineItems[index];
                    if (found) products_ids.push({ productId: found.catalogReference.catalogItemId, quantity: found.quantity });
                });
            });
            products_ids.map((product) => {
                const found = dataproducts[product.productId];
                if (found) products.push({ product: found, quantity: product.quantity });
            });
        }

        const email = order_data.buyerInfo.email;
        const order_no = order_data.number
        console.log(products)
        const existingKeys = await DeviceModel.find({ order_no })
        const existingKeysMap = new Map<string, {
            quantity: number,
            type: string
        }>();
        existingKeys.map(key => {
            const type = key.name;
            if (existingKeysMap.has(type)) {
                const current = existingKeysMap.get(type)!;
                existingKeysMap.set(type, {
                    quantity: current.quantity + 1,
                    type
                });
            } else {
                existingKeysMap.set(type, {
                    quantity: 1,
                    type
                });
            }
        });
        const currentKeys = new Map<string, {
            quantity: number,
            type: string
        }>();
        products.map(product => {
            if (!product.product) return false;
            const type = product.product.name;
            if (currentKeys.has(type)) {
                const current = currentKeys.get(type)!;
                currentKeys.set(type, {
                    quantity: current.quantity + product.quantity,
                    type
                });
            } else {
                currentKeys.set(type, {
                    quantity: product.quantity,
                    type
                });
            }
        });
        const filtered = Array.from(currentKeys).map(([key, value]) => {
            const existing = existingKeysMap.get(key);
            const productKey = Object.keys(dataproducts).find((product) => dataproducts[product].name === key)!;
            const product = dataproducts[productKey];
            if (!existing) return { product, quantity: value.quantity };
            if (existing.quantity < value.quantity) {
                return { product, quantity: value.quantity - existing.quantity };
            }
            return false;
        }).filter(item => item !== false) as { product: Product, quantity: number }[];

        let keysObjects: {
            key: string,
            name: string
        }[] = [];
        const user = await getMongoUser({ email });
        if (!user) {
            throw new Error('User not found');
        }
        await Promise.all(filtered.map(async product => {
            const quantity = product.quantity ?? 1;
            for (let i = 0; i < quantity; i++) {
                const minerKey = await generateMinerKey(product.product.key);

                const device = await DeviceModel.create({
                    user_id: user._id,
                    miner_key: minerKey,
                    order_no,
                    created_at: new Date(),
                    is_registered: false,
                    name: product.product.name
                });
                await device.save();

                keysObjects.push({
                    key: minerKey,
                    name: product.product.name
                });
            }
        }));
        console.log(keysObjects);
        await sendMail(email, keysObjects);
    }
    catch (error) {
        console.log(error);
    }


});

app.post('/wix_canceled', async function (req, res) {
    res.sendStatus(200);
    const data = req.body;
    const decoded = jwt.decode(data);
    if (!decoded) return;
    const str = typeof decoded === 'string' ? decoded : decoded.data
    const first = JSON.parse(str);
    const second: any = JSON.parse(first.data).order;
    const order_no = second.number;
    DeviceModel.deleteMany({ order_no }).exec();
    console.log(`Order ${order_no} canceled`);

});

app.post('/wix_refunded', async function (req, res) {
    res.sendStatus(200);
    const data = req.body;
    const decoded = jwt.decode(data);
    if (!decoded) return;
    const str = typeof decoded === 'string' ? decoded : decoded.data
    const first = JSON.parse(str);
    const second: any = JSON.parse(first.data).order
    const order_no = second.number;
    DeviceModel.deleteMany({ order_no }).exec();
    console.log(`Order ${order_no} refunded`);

});

app.post('/wix_web', async function (req, res) {
    res.sendStatus(200);
    const data = req.body;
    const decoded = jwt.decode(data);
    if (!decoded) return;
    const str = typeof decoded === 'string' ? decoded : decoded.data
    const first = JSON.parse(str);
    const second = JSON.parse(first.data)
    console.log(JSON.stringify(second));

});


app.post('/newdevice', async function (req, res) {
    const { email, device_name, api_key, device_type } = req.body;
    if (api_key !== baseApiKey) {
        res.status(401).send('Unauthorized');
        return;
    }
    const user = (await getMongoUser({ email }))!;
    const minerKey = await generateMinerKey(device_type);

    const device = await DeviceModel.create({
        user_id: user._id,
        miner_key: minerKey,
        created_at: new Date(),
        is_registered: false,
        name: device_name
    });
    await device.save();

    await sendMail(email, [{
        key: minerKey,
        name: device_name
    }]);

    res.status(200).json({ message: "ok" });
});


async function startApi() {
    const port = process.env.PORT || 3000;
    await connect();
    app.listen(port, () => {
        console.log(`Listening on port ${port}`);
    });
}

startApi();


export default app
