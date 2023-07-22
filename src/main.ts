import express from 'express';
import bodyparser from 'body-parser';
import 'dotenv/config'
import { connect } from './db/connect';
import { generateMinerKey, getMongoUser } from './db/utils';
import { DeviceModel } from './db/devices-schema';
import { sendMail } from 'MailProcessor';
const app = express()
app.use(bodyparser.json());

app.get('/', function (req, res) {
    res.send('Hello World')
})

app.post('/neworder', async function (req, res) {
    //verify that the request is coming from wix
    

    const order: wixProductWebhook = req.body;

    const products_ids: string[] = JSON.parse(order.data['product-ids']);

    const products_ordered = products_ids.map(id => products[id]);

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
6|wix_list |   data: {
6|wix_list |     'contact.Name.Last': 'Arnold',
6|wix_list |     'contact.Address[0].Country': 'US',
6|wix_list |     'product.price': '230.0',
6|wix_list |     'contact.Address[0].City': 'North Augusta',
6|wix_list |     'product.name': '$FRY Bandwidth Miner',
6|wix_list |     'contact.Email[0]': 'prince_edward_21@yahoo.com',
6|wix_list |     'contact.Address[1].Street': '608 McKenzie Street',
6|wix_list |     'product.image.url': 'https://static.wixstatic.com/media/c1b522_0d4234d92cfb4b5891ce2987e49053c7~mv2.png',
6|wix_list |     'contact.Address[1].Zip': '29841',
6|wix_list |     'contact.Name.First': 'James',
6|wix_list |     'contact.Address[0].Street': '608 McKenzie Street',
6|wix_list |     'product-ids': '["b0b98ffd-f0a8-4d71-b1b2-6d65686c3f93","7b3bff0b-327c-411b-81de-b19c075110ab","65fc3d33-b804-3745-6705-d2336d37c71d"]',
6|wix_list |     'contact.Address[1].Country': 'US',
6|wix_list |     'contact.Phone[0]': '8032791217',
6|wix_list |     'contact.Address[0].Zip': '29841',
6|wix_list |     'contact.Id': '094b6fc8-3c32-409b-b3ab-871b32a9f527',
6|wix_list |     'contact.Address[1].City': 'North Augusta',
6|wix_list |     metaSiteId: 'REDACTED_ROTATE_ME'
6|wix_list |   }
6|wix_list | }
*/
type Product = {
    name: string;
    price: number;
    key: string;
  };
  
  type Products = {
    [key: string]: Product;
  };

const products: Products = {
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