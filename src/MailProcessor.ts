'use server';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer';
import credentials from './config/credentials.json';
import tokens from './config/token.json';
import { Options } from 'nodemailer/lib/mailer';
import fs from 'fs';
import path from 'path';

const { client_secret, client_id, redirect_uris } = credentials.installed;
let oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(tokens);

const getGmailService = () => {

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    return gmail;
};

const encodeMessage = (message: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>) => {
    return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const createMail = async (options: Options) => {
    const mailComposer = new MailComposer(options);
    const message = await mailComposer.compile().build();
    return encodeMessage(message);
};

export const sendMailApi = async (options: any) => {
    const gmail = getGmailService();
    const rawMessage = await createMail(options);
    try {
        const result = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: rawMessage,
            },
        });
        console.log(`Message sent to ${options.to}: ${result.data}`);
        return result;
    } catch (error: any) {
        console.log(error)
        if (error.code === '401') {
            // Access token expired. Refresh it.
            console.log('Refreshing access token...');
            const refreshed = await oAuth2Client.refreshAccessToken();
            console.log(refreshed)
            const newTokens = refreshed.credentials;
            oAuth2Client.setCredentials(newTokens);
            // Try sending the email again.
            await sendMailApi(options);
        } else {
            console.error('Error sending email', error);
        }
    }
};

export async function sendMail(email: string, keys: {
    key: string,
    name: string
}[]
) {

    //read the html file here ../../../config/HTMLtemplate.html

    const htmlFile = fs.readFileSync(path.resolve(__dirname, './config/HTMLtemplate.html'), 'utf8');
    const rawKeys = keys.map(key => `${key.name}: ${key.key}`).join('\n');
    const htmlKeys = keys.map(key => `<p>${key.name}: ${key.key}</p>`).join('\n');

    const edited = htmlFile.replace('KEY_REPLACE_TEXT', htmlKeys);


    const options = {
        from: 'contact@fryfoundation.com',
        to: email,
        subject: 'Miner Key(s)',
        text: 'Your Miner key(s) is/are: ' + rawKeys + 'Please save this email for future reference.',
        html: edited,
    };
    await sendMailApi(options);

}
