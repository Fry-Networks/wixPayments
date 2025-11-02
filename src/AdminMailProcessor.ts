'use server';
import { sendMailApi } from './MailProcessor.js';
import { redactEmail } from './redact-utils.js';

/**
 * Dedicated Admin Email Processor
 * 
 * Handles admin notifications with professional formatting,
 * separate from customer miner key emails.
 */

// Enhanced admin email logging utility
const adminEmailLog = {
    info: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] 📧🔧 ADMIN EMAIL: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    },
    success: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ✅📧🔧 ADMIN EMAIL: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    },
    warning: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ⚠️📧🔧 ADMIN EMAIL: ${message}`, data ? JSON.stringify(data, null, 2) : '');
    },
    error: (message: string, error?: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ❌📧🔧 ADMIN EMAIL: ${message}`);
        if (error) {
            if (error.message) console.log(`   📧🔧 Error: ${error.message}`);
            if (error.code) console.log(`   📧🔧 Code: ${error.code}`);
            if (error.response?.data) console.log(`   📧🔧 Response: ${JSON.stringify(error.response.data)}`);
        }
    }
};

export interface AdminEmailData {
    subject: string;
    title: string;
    summary: string;
    details: any;
    timestamp: Date;
    requestId?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    category?: 'monitoring' | 'key_generation' | 'system_error' | 'notification';
}

/**
 * Send professional admin notification email
 */
export async function sendAdminNotification(
    adminEmail: string, 
    emailData: AdminEmailData
): Promise<any> {
    adminEmailLog.info(`ADMIN NOTIFICATION START - Preparing notification for ${redactEmail(adminEmail)}`, {
        subject: emailData.subject,
        category: emailData.category,
        priority: emailData.priority,
        hasRequestId: !!emailData.requestId
    });

    try {
        const htmlContent = generateAdminEmailHTML(emailData);
        
        const options = {
            from: 'no-reply@frynetworks.com',
            to: adminEmail,
            subject: emailData.subject,
            text: generateAdminEmailText(emailData),
            html: htmlContent,
        };
        
        adminEmailLog.info(`ADMIN EMAIL SENDING START - Calling Gmail API for admin notification`);
        const result = await sendMailApi(options);
        
        adminEmailLog.success(`ADMIN EMAIL SENT SUCCESSFULLY - Notification delivered to ${redactEmail(adminEmail)}`, {
            subject: emailData.subject,
            messageId: result?.data?.id,
            category: emailData.category,
            priority: emailData.priority
        });
        
        return result;
        
    } catch (error: any) {
        adminEmailLog.error(`ADMIN EMAIL SENDING FAILED - Could not send notification to ${redactEmail(adminEmail)}`, error);
        throw error;
    }
}

/**
 * Generate professional HTML template for admin notifications
 */
function generateAdminEmailHTML(emailData: AdminEmailData): string {
    const timestamp = emailData.timestamp.toISOString();
    const priorityColor = getPriorityColor(emailData.priority);
    const categoryIcon = getCategoryIcon(emailData.category);
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${emailData.subject}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }
        .header .category {
            font-size: 18px;
            opacity: 0.9;
            margin-top: 5px;
        }
        .priority-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            margin-top: 10px;
            background-color: ${priorityColor.bg};
            color: ${priorityColor.text};
            border: 2px solid ${priorityColor.border};
        }
        .content {
            padding: 30px;
        }
        .summary {
            background-color: #e8f4fd;
            border-left: 4px solid #0066cc;
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .summary h3 {
            margin: 0 0 10px 0;
            color: #0066cc;
            font-size: 18px;
        }
        .summary p {
            margin: 0;
            font-size: 16px;
        }
        .details {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .details h3 {
            margin: 0 0 15px 0;
            color: #495057;
            font-size: 16px;
            border-bottom: 2px solid #dee2e6;
            padding-bottom: 8px;
        }
        .details pre {
            background-color: #ffffff;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
            overflow-x: auto;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .metadata {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 25px 0;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 8px;
            border: 1px solid #dee2e6;
        }
        .metadata-item {
            display: flex;
            flex-direction: column;
        }
        .metadata-label {
            font-weight: 600;
            color: #6c757d;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }
        .metadata-value {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 14px;
            color: #495057;
            background-color: white;
            padding: 8px 12px;
            border-radius: 4px;
            border: 1px solid #dee2e6;
        }
        .footer {
            background-color: #495057;
            color: white;
            padding: 20px 30px;
            text-align: center;
            font-size: 14px;
        }
        .footer a {
            color: #adb5bd;
            text-decoration: none;
        }
        .timestamp {
            color: #6c757d;
            font-size: 12px;
            margin-top: 20px;
            text-align: center;
            font-family: monospace;
        }
        @media (max-width: 600px) {
            .metadata {
                grid-template-columns: 1fr;
            }
            .container {
                margin: 10px;
            }
            body {
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="category">${categoryIcon} ${emailData.category?.toUpperCase() || 'SYSTEM'} NOTIFICATION</div>
            <h1>${emailData.title}</h1>
            <div class="priority-badge">${emailData.priority?.toUpperCase() || 'NORMAL'} PRIORITY</div>
        </div>
        
        <div class="content">
            <div class="summary">
                <h3>📋 Summary</h3>
                <p>${emailData.summary}</p>
            </div>
            
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Timestamp</div>
                    <div class="metadata-value">${timestamp}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Request ID</div>
                    <div class="metadata-value">${emailData.requestId || 'N/A'}</div>
                </div>
            </div>
            
            <div class="details">
                <h3>📊 Technical Details</h3>
                <pre>${JSON.stringify(emailData.details, null, 2)}</pre>
            </div>
        </div>
        
        <div class="footer">
            <p>🤖 Automated notification from FRY Networks WixPayments System</p>
            <p>This is an automated message. Please do not reply to this email.</p>
            <div class="timestamp">Generated at ${timestamp}</div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate plain text version for admin notifications
 */
function generateAdminEmailText(emailData: AdminEmailData): string {
    const timestamp = emailData.timestamp.toISOString();
    
    return `
${emailData.category?.toUpperCase() || 'SYSTEM'} NOTIFICATION
${emailData.title}
Priority: ${emailData.priority?.toUpperCase() || 'NORMAL'}

SUMMARY:
${emailData.summary}

TECHNICAL DETAILS:
${JSON.stringify(emailData.details, null, 2)}

METADATA:
- Timestamp: ${timestamp}
- Request ID: ${emailData.requestId || 'N/A'}
- Category: ${emailData.category || 'system'}
- Priority: ${emailData.priority || 'normal'}

---
🤖 Automated notification from FRY Networks WixPayments System
This is an automated message. Please do not reply to this email.
Generated at ${timestamp}
`;
}

/**
 * Get priority color scheme
 */
function getPriorityColor(priority?: string): { bg: string; text: string; border: string } {
    switch (priority?.toLowerCase()) {
        case 'critical':
            return { bg: '#dc3545', text: '#ffffff', border: '#b02a37' };
        case 'high':
            return { bg: '#fd7e14', text: '#ffffff', border: '#e36209' };
        case 'normal':
            return { bg: '#0d6efd', text: '#ffffff', border: '#0b5ed7' };
        case 'low':
            return { bg: '#6c757d', text: '#ffffff', border: '#5c636a' };
        default:
            return { bg: '#0d6efd', text: '#ffffff', border: '#0b5ed7' };
    }
}

/**
 * Get category icon
 */
function getCategoryIcon(category?: string): string {
    switch (category?.toLowerCase()) {
        case 'monitoring':
            return '🔍';
        case 'key_generation':
            return '🔑';
        case 'system_error':
            return '🚨';
        case 'notification':
            return '📧';
        default:
            return '⚙️';
    }
}
