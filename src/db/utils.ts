import { DeviceModel } from './devices-schema.js';
import UserModel, { User } from './users-schema.js';
import randomstring from 'randomstring';
export async function getMongoUser({ address, email }: { address?: string, email?: string }): Promise<User> {
    if (email && address) {
        if (await UserModel.exists({ email: email, address: address })) {
            return (await UserModel.findOne({ email: email, address: address }))!;
        } else if (await UserModel.exists({ email: email })) {
            const user = await UserModel.findOne({ email: email });
            user.address = address;
            await user.save();
            return user;
        } else if (await UserModel.exists({ address: address })) {
            const user = await UserModel.findOne({ address: address });
            user.email = email;
            await user.save();
            return user;
        } else {
            return await UserModel.create({ email: email, address: address });
        }
    } else if (email) {
        if (await UserModel.exists({ email: email })) {
            return (await UserModel.findOne({ email: email }))!;
        } else {
            return await UserModel.create({ email: email });
        }
    } else if (address) {
        if (await UserModel.exists({ address: address })) {
            return (await UserModel.findOne({ address: address }))!;
        } else {
            return await UserModel.create({ address: address });
        }
    }
    throw new Error("Both email and address are missing");
}

export async function generateMinerKey(index: string) {
    //create a string of 32 random characters
    let key = randomstring.generate({ length: 32, charset: 'alpha-numeric', capitalization: 'uppercase' });
    let minerKey = `${index}-${key}`;
    while (await DeviceModel.exists({ miner_key: minerKey })) {
        key = randomstring.generate({ length: 32, charset: 'alpha-numeric', capitalization: 'uppercase' });
        minerKey = `${index}-${key}`;
    }
    return minerKey;
}
