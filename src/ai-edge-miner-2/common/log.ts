// Simple structured logger for AI Edge Miner v2
import { secrets } from '../../config/secrets.js';

export const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] 🤖 INFO: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  success: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] ✅🤖 SUCCESS: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warning: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] ⚠️🤖 WARNING: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] ❌🤖 ERROR: ${message}`);
    if (error) {
      if (error.message) console.log(`   Error: ${error.message}`);
      if ((error as any).stack && secrets.nodeEnv === 'development') console.log(`   Stack: ${(error as any).stack}`);
    }
  }
};
