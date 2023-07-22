import mongoose from 'mongoose';
import 'dotenv/config';
import { EventEmitter } from 'node:events';
export async function connect() {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MONGO_URI not set!');
    }
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);

    mongoose.connection.useDb('weather');

    mongoose.connection.on('connected', () => {
        console.log('Connected to MongoDB!');
    });

    mongoose.connection.on('error', (err) => {
        console.error(`Mongoose connection error:\n${err.stack}`);
    });

    mongoose.connection.on('disconnected', () => {
        console.log('Disconnected from MongoDB!');
    });
}

export const newApiKeyEvent = new EventEmitter();