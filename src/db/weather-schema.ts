import mongoose, { mongo } from 'mongoose';

interface SensorFields {
    [key: string]: {
        type: typeof Number,
        required: boolean
    }
}

const sensorFields: SensorFields = {};
for (let i = 1; i <= 10; i++) {
    sensorFields[`humidity${i}`] = { type: Number, required: false };
    sensorFields[`temp${i}f`] = { type: Number, required: false };
    sensorFields[`soiltemp${i}f`] = { type: Number, required: false };
    sensorFields[`soilhum${i}`] = { type: Number, required: false };
    sensorFields[`batt${i}`] = { type: Number, required: false };
}

const weatherSchema = new mongoose.Schema(
    {
        timestamp: Date,
        temperature: { type: Number, required: false },
        winddir: { type: Number, required: false },
        windspeedmph: { type: Number, required: false },
        windgustmph: { type: Number, required: false },
        maxdailygust: { type: Number, required: false },
        windgustdir: { type: Number, required: false },
        windspdmph_avg2m: { type: Number, required: false },
        winddir_avg2m: { type: Number, required: false },
        windspdmph_avg10m: { type: Number, required: false },
        winddir_avg10m: { type: Number, required: false },
        humidity: { type: Number, required: false },
        humidityin: { type: Number, required: false },
        tempf: { type: Number, required: false },
        baromrelin: { type: Number, required: false },
        baromabsin: { type: Number, required: false },
        uv: { type: Number, required: false },
        solarradiation: { type: Number, required: false },
        co2: { type: Number, required: false },
        hourlyrainin: { type: Number, required: false },
        dailyrainin: { type: Number, required: false },
        weeklyrainin: { type: Number, required: false },
        monthlyrainin: { type: Number, required: false },
        yearlyrainin: { type: Number, required: false },
        eventrainin: { type: Number, required: false },
        totalrainin: { type: Number, required: false },
        ...sensorFields,
        metadata: {
            deviceMAC: String,
            location: {
                lat: Number,
                lon: Number,
            }
        },
    },
    {
        timeseries: {
            timeField: 'timestamp',
            metaField: 'metadata',
            granularity: 'hours',
        }
    }
);

export interface WeatherData extends mongoose.Document {
    timestamp: Date;
    temperature: number;
    winddir?: number;
    windspeedmph?: number;
    windgustmph?: number;
    maxdailygust?: number;
    windgustdir?: number;
    windspdmph_avg2m?: number;
    winddir_avg2m?: number;
    windspdmph_avg10m?: number;
    winddir_avg10m?: number;
    humidity?: number;
    humidityin?: number;
    tempf?: number;
    baromrelin?: number;
    baromabsin?: number;
    uv?: number;
    solarradiation?: number;
    co2?: number;
    hourlyrainin?: number;
    dailyrainin?: number;
    weeklyrainin?: number;
    monthlyrainin?: number;
    yearlyrainin?: number;
    eventrainin?: number;
    totalrainin?: number;
    metadata: {
        deviceMAC: string;
        location: {
            lat: number;
            lon: number;
        };
    };
    humidity1?: number;
    humidity2?: number;
    humidity3?: number;
    humidity4?: number;
    humidity5?: number;
    humidity6?: number;
    humidity7?: number;
    humidity8?: number;
    humidity9?: number;
    humidity10?: number;
    temp1f?: number;
    temp2f?: number;
    temp3f?: number;
    temp4f?: number;
    temp5f?: number;
    temp6f?: number;
    temp7f?: number;
    temp8f?: number;
    temp9f?: number;
    temp10f?: number;
    soiltemp1f?: number;
    soiltemp2f?: number;
    soiltemp3f?: number;
    soiltemp4f?: number;
    soiltemp5f?: number;
    soiltemp6f?: number;
    soiltemp7f?: number;
    soiltemp8f?: number;
    soiltemp9f?: number;
    soiltemp10f?: number;
    soilhum1?: number;
    soilhum2?: number;
    soilhum3?: number;
    soilhum4?: number;
    soilhum5?: number;
    soilhum6?: number;
    soilhum7?: number;
    soilhum8?: number;
    soilhum9?: number;
    soilhum10?: number;
    batt1?: number;
    batt2?: number;
    batt3?: number;
    batt4?: number;
    batt5?: number;
    batt6?: number;
    batt7?: number;
    batt8?: number;
    batt9?: number;
    batt10?: number;
}

export const WeatherModel = mongoose.model<WeatherData>('weather', weatherSchema);
