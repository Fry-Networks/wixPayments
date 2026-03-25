#!/bin/bash
# Check if 1Password rate limit has cleared and restart wix_payments

set -e

TOKEN_FILE="/etc/opt/wix/op_service_account_token"
TEST_SECRET="op://wixPayments/wix-payments-api-key/password"

echo "Testing 1Password access..."
export OP_SERVICE_ACCOUNT_TOKEN=$(cat "$TOKEN_FILE")

if op read "$TEST_SECRET" >/dev/null 2>&1; then
    echo "✓ 1Password rate limit has cleared!"
    echo "Starting wix_payments..."
    cd /home/helpdesk/subdomains/wixPayments
    export MONGO_CA_CERT_PATH=/tmp/mongo-ca.crt
    docker update --restart=unless-stopped wix_payments
    docker compose up -d wix_payments
    sleep 30
    docker ps --filter name=wix_payments --format "table {{.Names}}\t{{.Status}}"
    # Remove this cron job after successful start
    echo "Removing auto-retry cron job..."
    crontab -l 2>/dev/null | grep -v "check-and-restart" | crontab -
    echo "✓ Auto-retry cron job removed"
else
    echo "✗ Still rate limited. Try again in a few minutes."
    exit 1
fi
