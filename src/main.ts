import express from 'express';
import bodyparser from 'body-parser';
import axios from 'axios';
const app = express()
app.use(bodyparser.json());

app.get('/', function (req, res) {
    res.send('Hello World')
})

app.post('/neworder', async function (req, res) {
    const order = req.body;
    console.log(order);
});


export async function startApi() {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Listening on port ${port}`);
    });

}