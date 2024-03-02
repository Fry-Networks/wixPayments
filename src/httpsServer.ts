// server.js
import https from 'https';
import fs from 'fs';
import app from './main.js'; // Import the express app
import { connect } from './db/connect.js';

const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
};

const port = process.env.PORT || 3000;
connect();
https.createServer(options, app)
  .listen(port, function () {
    console.log(`HTTPS server listening on port ${port}`);
  });
