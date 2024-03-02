import mongoose, { mongo } from 'mongoose';
export const devicesSchema = new mongoose.Schema({
	user_id: mongoose.Schema.Types.ObjectId,
    miner_key: String, 
    name: String,
    order_no: Number,
    created_at: { type: Date, default: Date.now },
    is_registered: { type: Boolean, default: false },
    registered_at: Date
 
});
export interface Device extends mongoose.Document {
	user_id: mongoose.Schema.Types.ObjectId | string,
    miner_key: string,
    name: string,
    order_no: number,
    created_at: Date,
    is_registered: boolean,
    registered_at: Date,
}

export const DeviceModel = mongoose.model<Device>('devices', devicesSchema);
