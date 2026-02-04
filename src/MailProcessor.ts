'use server';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';
import { redactEmail, redactKey, redactToken } from './redact-utils.js';
import { secrets } from './config/secrets.js';
import { log } from './logger.js';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Retrieve Google OAuth credentials and tokens from 1Password (stored as Documents)
function getSecretDocument(title: string, vault: string): any {
    try {
        const cmd = `op document get "${title}" --vault "${vault}"`;
        const result = execSync(cmd, { encoding: 'utf8' });
        return JSON.parse(result);
    } catch (error: any) {
        const message = error?.message || String(error);
        log.error(`Failed to retrieve secret document from 1Password: ${title} (vault: ${vault})`, error);
        log.error('Ensure 1Password CLI is installed and you are signed in (op signin).');
        log.error('Also ensure the document exists in the specified vault.');
        throw error;
    }
}

// Expect these documents to be stored in the shared vault as per the migration guide
const credentials = getSecretDocument('credentials.json', 'wix-payments-shared');
const tokens = getSecretDocument('token.json', 'wix-payments-shared');
import { Options } from 'nodemailer/lib/mailer/index.js';

const { client_secret, client_id, redirect_uris } = credentials.web;
let oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(tokens);

const getGmailService = () => {

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    return gmail;
};

const encodeMessage = (message: Buffer) => {
    return message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const createMail = async (options: Options) => {
    const mailComposer = new MailComposer(options);
    const message = await mailComposer.compile().build();
    return encodeMessage(message);
};

function createUnsubscribeToken(email: string): string {
    const payload = { email };
    // Token valid for ~180 days to reduce stale links
    const token = jwt.sign(payload, secrets.unsubscribeSecret, { expiresIn: '180d' });
    return token;
}
function buildUnsubscribeUrl(email: string): string {
    const token = createUnsubscribeToken(email);
    const base = secrets.publicBaseUrl.replace(/\/$/, '');
    return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export const sendMailApi = async (options: any): Promise<any> => {
    log.detail(`GMAIL API CALL - Attempting to send email`, { 
        to: redactEmail(options.to), 
        subject: options.subject,
        hasHtml: !!options.html,
        hasText: !!options.text
    });
    
    const gmail = getGmailService();
    const rawMessage = await createMail(options);
    
    try {
        const result = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: rawMessage,
            },
        });
        
        log.detail(`GMAIL API SUCCESS - Email sent successfully`, { 
            to: redactEmail(options.to),
            messageId: result.data.id,
            threadId: result.data.threadId
        });
        
        return result;
    } catch (error: any) {
        log.error(`GMAIL API ERROR - Failed to send email to ${redactEmail(options.to)}`, error);
        
        if (error.code === 401 || error.message?.includes('invalid_grant')) {
            log.detail(`OAUTH TOKEN EXPIRED - Attempting to refresh access token`);
            try {
                const refreshed = await oAuth2Client.refreshAccessToken();
                log.detail(`OAUTH REFRESH ATTEMPT`, { 
                    hasNewToken: !!refreshed.credentials.access_token,
                    tokenType: refreshed.credentials.token_type
                });
                
                const newTokens = refreshed.credentials;
                oAuth2Client.setCredentials(redactToken(newTokens));
                
                log.detail(`OAUTH REFRESH SUCCESS - Retrying email send`);
                // Try sending the email again with refreshed token
                return await sendMailApi(options);
            } catch (refreshError: any) {
                log.error(`OAUTH REFRESH FAILED - Cannot refresh access token`, refreshError);
                throw new Error(`Email failed: OAuth token refresh failed - ${refreshError.message}`);
            }
        } else {
            log.error(`GMAIL API FATAL ERROR - Non-recoverable error`, error);
            throw new Error(`Email failed: ${error.message || 'Unknown Gmail API error'}`);
        }
    }
};

type MailKeyDescriptor = {
    key: string,
    name: string,
    parentDeviceName?: string,
    parentDeviceKey?: string,
    sourceOrderNumber?: string,
    sourceOrderDate?: string
};

export type MailCustomizationOptions = {
    subject?: string;
    heading?: string;
    introHtml?: string;
    introText?: string;
};

function buildOrderMeta(key: MailKeyDescriptor): string {
    const parts: string[] = [];
    if (key.sourceOrderNumber) {
        parts.push(`Order #: ${key.sourceOrderNumber}`);
    }
    if (key.sourceOrderDate) {
        const date = new Date(key.sourceOrderDate);
        if (!isNaN(date.getTime())) {
            parts.push(
                `Placed: ${date.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                })}`
            );
        }
    }
    return parts.join("\n");
}

export async function sendMail(
    email: string,
    keys: MailKeyDescriptor[],
    customization?: MailCustomizationOptions
): Promise<any> {
    log.detail(`EMAIL COMPOSITION START - Preparing email for ${redactEmail(email)}`, { 
        keyCount: keys.length,
        keyTypes: keys.map(k => k.name),
        hasParentInfo: keys.some(k => k.parentDeviceName)
    });

    try {
        // Read and prepare HTML template
        log.detail(`TEMPLATE LOADING - Reading HTML template`);
        const htmlFile = fs.readFileSync(path.resolve(__dirname, './config/HTMLtemplate.html'), 'utf8');
        
        const rawKeys = keys.map(key => {
            const sections: string[] = [];
            if (key.parentDeviceName && key.parentDeviceKey) {
                sections.push(`Generated from: ${key.parentDeviceName} (${key.parentDeviceKey})`);
            }
            sections.push(`${key.name}: ${key.key}`);
            const meta = buildOrderMeta(key);
            if (meta) {
                sections.push(meta);
            }
            return sections.join('\n');
        }).join('\n\n');
        
        // Generate HTML content using the enhanced template structure
        let htmlKeys;
        if (keys.length === 1) {
            // Single key - use enhanced template structure
            const keyData = keys[0];
            let htmlContent = '';
            
            if (keyData.parentDeviceName && keyData.parentDeviceKey) {
                htmlContent += `<div class="parent-device-info">
                                  <p class="parent-device-label">Generated from:</p>
                                  <p class="parent-device-name">${keyData.parentDeviceName}</p>
                                  <p class="parent-device-key">${keyData.parentDeviceKey}</p>
                                </div>
                                <div class="relationship-arrow">↓</div>`;
            }
            
            // Add AI Edge Miner key container
            htmlContent += `<div class="ai-miner-key-container">
                              <p class="ai-miner-key-label">${keyData.name}:</p>
                              <p class="ai-miner-key">${keyData.key}</p>
                              <p class="key-copy-note">⚠️ Copy the entire key including the prefix</p>
                            </div>`;
            const orderMeta = buildOrderMeta(keyData).replace(/\n/g, '<br/>');
            if (orderMeta) {
                htmlContent += `<div class="parent-device-info">
                                  <p class="parent-device-label">Order Details:</p>
                                  <p>${orderMeta}</p>
                                </div>`;
            }
            
            htmlKeys = htmlContent;
        } else {
            // Multiple keys - create separate containers for each
            htmlKeys = keys.map((keyData, index) => {
                let containerContent = '';
                
                if (keyData.parentDeviceName && keyData.parentDeviceKey) {
                    containerContent += `<div class="parent-device-info">
                                          <p class="parent-device-label">Generated from:</p>
                                          <p class="parent-device-name">${keyData.parentDeviceName}</p>
                                          <p class="parent-device-key">${keyData.parentDeviceKey}</p>
                                        </div>
                                        <div class="relationship-arrow">↓</div>`;
                }
                
                // Add AI Edge Miner key container
                containerContent += `<div class="ai-miner-key-container">
                                      <p class="ai-miner-key-label">${keyData.name}:</p>
                                      <p class="ai-miner-key">${keyData.key}</p>
                                      <p class="key-copy-note">⚠️ Copy the entire key including the prefix</p>
                                    </div>`;
                const orderMeta = buildOrderMeta(keyData).replace(/\n/g, '<br/>');
                if (orderMeta) {
                    containerContent += `<p style="margin-top:8px;font-size:14px;color:#555;">${orderMeta}</p>`;
                }
                
                return `<div style="margin: 25px 0; padding: 15px; border: 1px solid #dee2e6; border-radius: 8px; background-color: #fafbfc;">
                           ${containerContent}
                        </div>`;
            }).join('');
        }
        
        const headingText = customization?.heading || 'Your FRY Networks Miner Keys';
        const introHtml = customization?.introHtml
            ? `${customization.introHtml}\n`
            : '';
        const edited = htmlFile
            .replace('Your FRY Networks Miner Keys', headingText)
            .replace('KEY_REPLACE_TEXT', `${introHtml}${htmlKeys}`);

        log.detail(`TEMPLATE PREPARED - Email content ready`, { 
            rawKeysLength: rawKeys.length,
            htmlKeysLength: htmlKeys.length,
            templateProcessed: true,
            hasParentInfo: keys.some(k => k.parentDeviceName)
        });

        const introText = customization?.introText
            ? `${customization.introText}\n\n`
            : '';
        const textBody = `${introText}Your Miner key(s):\n\n${rawKeys}\n\nPlease save this email for future reference.\n\nBest regards,\nFRY Networks Team`;

        const options = {
            from: 'no-reply@frynetworks.com',
            to: email,
            subject: customization?.subject || 'Your Miner Key(s) - FRY Networks',
            text: textBody,
            html: edited,
            headers: {
                'List-Unsubscribe': `<${buildUnsubscribeUrl(email)}>, <mailto:no-reply@frynetworks.com>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
        };
        
        log.detail(`EMAIL SENDING START - Calling Gmail API`);
        const result = await sendMailApi(options);
        
        log.detail(`EMAIL SENT SUCCESSFULLY - Miner keys delivered to ${redactEmail(email)}`, { 
            keyCount: keys.length,
            messageId: result?.data?.id,
            recipient: redactEmail(email)
        });
        
        return result;
        
    } catch (error: any) {
        log.error(`EMAIL SENDING FAILED - Could not send miner keys to ${redactEmail(email)}`, error);
        throw error; // Re-throw so calling code can handle it
    }
}
