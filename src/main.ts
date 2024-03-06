import express from 'express';
import bodyparser from 'body-parser';
import 'dotenv/config'
import { connect } from './db/connect.js';
import { generateMinerKey, getMongoUser } from './db/utils.js';
import { DeviceModel } from './db/devices-schema.js';
import { sendMail } from './MailProcessor.js';
import { Product, dataproducts, fetchOrder } from './productUpdater.js';
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
        if (!decoded) return;
        const str = typeof decoded === 'string' ? decoded : decoded.data
        const first = JSON.parse(str);
        const second: RootObject = JSON.parse(first.data);
        console.log(JSON.stringify(second));
        const fulfill_data = second.updatedEvent.currentEntity;
        const order_data = await fetchOrder(fulfill_data.orderId);
        console.log(JSON.stringify(order_data));
        if(!order_data) return;
        let products_ids: { productId: string, quantity: number }[] = [];
        order_data.fulfillments.map((fulfillment) => {
            fulfillment.lineItems.map((item) => {
                const found = order_data.lineItems.find((orderItem) => orderItem.index === item.index);
                if(found) products_ids.push({productId: found.productId, quantity: found.quantity});
            });
        });
        const email = order_data.buyerInfo.email;
        const order_no = order_data.number
        const products : {product: Product, quantity: number}[] = [];
        products_ids.map((product) => {
            const found = dataproducts[product.productId];
            if(found) products.push({product: found, quantity: product.quantity});
        });
        const filtered = products.filter(product => product.product !== undefined);
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
