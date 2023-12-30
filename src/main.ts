import express from 'express';
import bodyparser from 'body-parser';
import 'dotenv/config'
import { connect } from './db/connect.js';
import { generateMinerKey, getMongoUser } from './db/utils.js';
import { DeviceModel } from './db/devices-schema.js';
import { sendMail } from './MailProcessor.js';
import { dataproducts } from './productUpdater.js';

const baseApiKey = process.env.BASE_API_KEY;

const app = express()
app.use(bodyparser.json());

app.get('/', function (req, res) {
    res.send('Hello World')
})

app.post('/neworder', async function (req, res) {
    //verify that the request is coming from wix

    const order: wixProductWebhook = req.body;

    const products_ids: string[] = JSON.parse(order.data['product-ids']);

    const products_ordered = products_ids.map(id => dataproducts[id]);

    const email = order.data['contact.Email[0]'];
    let keysObjects: {
        key: string,
        name: string
    }[] = [];

    await Promise.all(products_ordered.map(async product => {
        const user = (await getMongoUser({email}))!;

        const minerKey = await generateMinerKey(product.key);

        const device = await DeviceModel.create({
            user_id: user._id,
            miner_key: minerKey,
            created_at: new Date(),
            is_registered: false,       
            name: product.name
        });
        await device.save();

        keysObjects.push({
            key: minerKey,
            name: product.name
        });
    }));

    await sendMail(email, keysObjects);
});

app.post('/supersecretwebhook', async function (req, res) {
    const data = req.body;
    console.log(data);
});


app.post('/newdevice', async function (req, res) {
    const { email, device_name, api_key, device_type } = req.body;
    if (api_key !== baseApiKey) {
        res.status(401).send('Unauthorized');
        return;
    }
    const user = (await getMongoUser({email}))!;
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

interface wixProductWebhook {
    data: {
        'contact.Name.Last': string,
        'contact.Address[0].Country': string,
        'product.price': string,
        'contact.Address[0].City': string,
        'product.name': string,
        'contact.Email[0]': string,
        'contact.Address[1].Street': string,
        'product.image.url': string,
        'contact.Address[1].Zip': string,
        'contact.Name.First': string,
        'contact.Address[0].Street': string,
        'product-ids': string,
        'contact.Address[1].Country': string,
        'contact.Phone[0]': string,
        'contact.Address[0].Zip': string,
        'contact.Id': string,
        'contact.Address[1].City': string,
        metaSiteId: string
    }
}

/*
{
  data: {
    'contact.Name.Last': 'Arnold',
    'contact.Address[0].Country': 'US',
    'product.price': '230.0',
    'contact.Address[0].City': 'North Augusta',
    'product.name': '$FRY Bandwidth Miner',
    'contact.Email[0]': 'prince_edward_21@yahoo.com',
    'contact.Address[1].Street': '608 McKenzie Street',
    'product.image.url': 'https://static.wixstatic.com/media/c1b522_0d4234d92cfb4b5891ce2987e49053c7~mv2.png',
    'contact.Address[1].Zip': '29841',
    'contact.Name.First': 'James',
    'contact.Address[0].Street': '608 McKenzie Street',
    'product-ids': '["b0b98ffd-f0a8-4d71-b1b2-6d65686c3f93","7b3bff0b-327c-411b-81de-b19c075110ab","65fc3d33-b804-3745-6705-d2336d37c71d"]',
    'contact.Address[1].Country': 'US',
    'contact.Phone[0]': '8032791217',
    'contact.Address[0].Zip': '29841',
    'contact.Id': '094b6fc8-3c32-409b-b3ab-871b32a9f527',
    'contact.Address[1].City': 'North Augusta',
    metaSiteId: 'REDACTED_ROTATE_ME'
  }
}
*/
