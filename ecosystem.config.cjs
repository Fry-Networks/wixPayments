// PM2 ecosystem configuration for WixPayments service
// Runs the app through 1Password CLI to inject secrets from .1p.env.prod

const fs = require('fs');
const path = require('path');

// Resolve an absolute path to the 1Password CLI binary to avoid PATH issues under systemd
const opCandidates = [
  process.env.OP_BIN,
  '/usr/local/bin/op',
  '/usr/bin/op'
].filter(Boolean);

const opBinary = opCandidates.find(p => {
  try { return p && fs.existsSync(p); } catch { return false; }
}) || 'op'; // Fallback to PATH if nothing matched

module.exports = {
  apps: [
    {
      name: 'wix_listen',
      // Run via 1Password CLI. PM2 must not use Node interpreter here.
      script: opBinary,
      args: [
        'run',
        '--env-file', '.1p.env.prod',  // or path.resolve(__dirname, '.1p.env.prod')
        '--',
        'node', 'build/main.js'
      ],
      interpreter: 'none',
      cwd: __dirname,

      // Ensure single instance to avoid duplicate cron executions
      instances: 1,
      exec_mode: 'fork',

      // Process behavior
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 5000,
      time: true,

      // Do NOT put OP_SERVICE_ACCOUNT_TOKEN here. Inject it via systemd/shell.
      env: {
        // NODE_ENV is provided by .1p.env.prod via op run
      }
    }
  ]
};
