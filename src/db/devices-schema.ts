import mongoose, { mongo } from 'mongoose';
export const devicesSchema = new mongoose.Schema({
	user_id: mongoose.Schema.Types.ObjectId,
    miner_key: String, 
    name: String,
    order: String,
    email: String,
    created_at: { type: Date, default: Date.now },
    is_registered: { type: Boolean, default: false },
    enabled: {type: Boolean, default: false},
    registered_at: Date,
    registration: {
        amount: { type: Number, default: 0 },
        asset_id: String,
        time: Date,
        txId: String
    },
    node: {
        amount: { type: Number, default: 0 },
        asset_id: String,
        time: Date,
        txId: String
    },
    ai_miner_generated: { type: Boolean, default: false },
    // AI Edge Miner assignment tracking (only for parent devices)
    ai_edge_miner_assigned: { type: Boolean, default: false },
    assigned_ai_edge_miner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'devices' },
    // Parent device reference fields (only for AI Edge Miner documents)
    parent_device_id: { type: mongoose.Schema.Types.ObjectId, ref: 'devices' },
    parent_device_name: String,
    parent_device_miner_key: String,
    // Email tracking fields (only for AI miner documents with name "$FRY AI Edge Miner")
    email_sent: { type: Boolean, default: false },
    email_sent_at: Date,
    // Airdrop metadata for manually issued devices
    airdrop_source_order: String,
    airdrop_source_order_date: Date
});
export interface Device extends mongoose.Document {
	user_id: mongoose.Schema.Types.ObjectId | string,
    miner_key: string,
    name: string,
    order: string,
    email: string,
    enabled: boolean,
    created_at: Date,
    is_registered: boolean,
    registered_at: Date,
    registration: {
        amount: number,
        asset_id: string,
        time: Date,
        txId: string
    },
    node: {
        amount: number,
        asset_id: string,
        time: Date,
        txId: string
    },
    ai_miner_generated: boolean,
    // AI Edge Miner assignment tracking (only for parent devices)
    ai_edge_miner_assigned?: boolean,
    assigned_ai_edge_miner_id?: mongoose.Schema.Types.ObjectId | string,
    // Parent device reference fields (only for AI Edge Miner documents)
    parent_device_id?: mongoose.Schema.Types.ObjectId | string,
    parent_device_name?: string,
    parent_device_miner_key?: string,
    // Email tracking fields (only for AI miner documents with name "$FRY AI Edge Miner")
    email_sent?: boolean,
    email_sent_at?: Date,
    // Airdrop metadata
    airdrop_source_order?: string,
    airdrop_source_order_date?: Date
}

export const DeviceModel = mongoose.model<Device>('devices', devicesSchema);
