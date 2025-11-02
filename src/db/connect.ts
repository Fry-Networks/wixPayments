import mongoose from 'mongoose';
import { secrets } from '../config/secrets.js';
import { EventEmitter } from 'node:events';
export async function connect() {
    //check if already connected
    if (mongoose.connection.readyState == 1) {
        return;
    }

    const uri = secrets.mongoUri;
    if (!uri) {
        console.error('Error: MONGO_URI not set in environment variables.');
        throw new Error('MONGO_URI not set!');
    }

    mongoose.connection.on('connected', () => {
        console.log('MongoDB: Successfully connected!');
    });

    mongoose.connection.on('error', (err) => {
        console.error(`MongoDB: Connection error: ${err.message}`);
        // Optionally, you might want to exit the process or try to reconnect
        // process.exit(1); 
    });

    mongoose.connection.on('disconnected', () => {
        console.log('MongoDB: Disconnected!');
    });

    try {
        console.log('MongoDB: Attempting to connect...');
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000, // 5 seconds timeout for server selection
            socketTimeoutMS: 45000, // 45 seconds timeout for socket operations
        });
        mongoose.connection.useDb('main');
        console.log('MongoDB: Connection established and database selected.');
    } catch (error: any) {
        console.error(`MongoDB: Initial connection failed: ${error.message}`);
        throw error; // Re-throw to prevent the app from starting without a DB connection
    }

}

export const newApiKeyEvent = new EventEmitter();
