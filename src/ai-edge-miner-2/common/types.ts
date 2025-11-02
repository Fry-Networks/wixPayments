import type mongoose from 'mongoose';

// Raw device document used for lean() operations
export type RawDeviceDocument = {
  _id: any;
  user_id?: any;
  miner_key?: string;
  name?: string;
  order?: string;
  email?: string;
  created_at?: Date;
  is_registered?: boolean;
  enabled?: boolean;
  registered_at?: Date;
  registration?: {
    amount?: number;
    asset_id?: string;
    time?: Date;
    txId?: string;
  };
  node?: {
    amount?: number;
    asset_id?: string;
    time?: Date;
    txId?: string;
  };
  ai_miner_generated?: boolean;
  // Parent fields (on AEM child)
  parent_device_id?: mongoose.Schema.Types.ObjectId | string;
  parent_device_name?: string;
  parent_device_miner_key?: string;
  // Email fields (on AEM child)
  email_sent?: boolean;
  email_sent_at?: Date;
};

export type Progress = { processed: number; total: number; current: string };

