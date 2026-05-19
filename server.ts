import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { EventEmitter } from 'events';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import proxy from 'express-http-proxy';
import crypto from 'crypto';

// Set System Timezone to IST (Indian Standard Time)
process.env.TZ = 'Asia/Kolkata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = 'banking-secret-key';

// Kafka Distributed Bus (Event Emitter)
// INTEGRATION POINT: Integration with real Kafka clusters (Spring Kafka) for high-throughput messaging.
// In a production enviroment, the @KafkaListener annotations would consume these messages.
const kafkaBus = new EventEmitter();

// Prometheus Setup
collectDefaultMetrics();
const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
const transactionDuration = new Histogram({
  name: 'transaction_processing_seconds',
  help: 'Time taken to process a transaction',
  buckets: [0.1, 0.5, 1, 2, 5]
});

const kafkaQueueGauge = new Gauge({
  name: 'kafka_queue_size',
  help: 'Current size of the Kafka processing queue'
});

function anyErr(e: any): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// Helper to get formatted IST Time for persistence
function getISTTime() {
  return new Date().toISOString();
}

function formatISTDate(dateInput?: string | Date) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' IST';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const proxyOptions = {
    timeout: 8000, // Increase timeout for distributed cloud environment
    proxyReqPathResolver: (req: any) => {
      let path = req.originalUrl;
      return path.replace(/\/\/+/g, '/');
    },
    proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => {
      if (srcReq.user) {
        proxyReqOpts.headers['X-User-UID'] = srcReq.user.uid;
        proxyReqOpts.headers['X-User-Role'] = srcReq.user.role;
      }
      return proxyReqOpts;
    },
    proxyErrorHandler: (err: any, res: any, next: any) => {
      console.error(`[GATEWAY] Proxy Error: ${err.message}`);
      res.status(503).json({ 
        error: 'Service Unavailable',
        message: 'The banking microservice is temporarily unavailable or returned an invalid response. Please try again in a few seconds.' 
      });
    },
    userResDecorator: (proxyRes: any, proxyResData: any, userReq: any, userRes: any) => {
      const contentType = proxyRes.headers['content-type'];
      if (proxyRes.statusCode >= 400 && (!contentType || !contentType.includes('application/json'))) {
        console.warn(`[GATEWAY] Intercepted non-JSON error (${proxyRes.statusCode}) from microservice`);
        const message = proxyRes.statusCode === 403 
          ? 'Access to the banking operation was denied. This usually happens if your account is frozen or locked for security reasons.'
          : `The banking service encountered an error (${proxyRes.statusCode}). Please contact support if this persists.`;
        
        return JSON.stringify({
          error: proxyRes.statusCode === 403 ? 'Account Restricted' : 'Service Error',
          message: message
        });
      }
      return proxyResData;
    }
  };

  // Middleware for metrics
  app.use((req, res, next) => {
    res.on('finish', () => {
      httpRequestCounter.inc({
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode
      });
    });
    next();
  });

  // Prometheus Metrics Endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Health Check API
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'UP', 
      timestamp: getISTTime(),
      services: {
        database: 'connected',
        kafka: 'active',
        metrics: 'active'
      }
    });
  });

  // --- Persistent Data Management Layer ---
  const DATA_FILE = path.join(__dirname, 'db.json');
  
  // Resiliency: If db.json is incorrectly a directory (common Docker mount issue), use a fallback file
  let effectiveDataFile = DATA_FILE;
  try {
    if (fs.existsSync(DATA_FILE) && fs.lstatSync(DATA_FILE).isDirectory()) {
      console.error('[DB] CRITICAL: db.json is a directory! Falling back to db.persistent.json. Please run: rm -rf db.json && touch db.json');
      effectiveDataFile = path.join(__dirname, 'db.persistent.json');
    }
  } catch (e) {}

  const dbData = {
    users: [
      { uid: '550e8400-e29b-41d4-a716-446655440001', customerNumber: 'admin', password: 'password', email: 'admin@bankingsystem.com', displayName: 'System Admin', role: 'admin', phoneNumber: '', address: '', status: 'active' },
      { uid: '550e8400-e29b-41d4-a716-446655440000', customerNumber: 'CUST1001', password: 'password123', email: 'user@bankingsystem.com', displayName: 'Existing Customer', role: 'customer', phoneNumber: '+1234567890', address: '123 Bank St, Finance City', status: 'active' }
    ],
    accounts: [
      { id: 'acc1', ownerUid: '550e8400-e29b-41d4-a716-446655440000', accountNumber: '1234567890', balance: 5000, currency: 'USD', status: 'active', isPrimary: true },
      { id: 'acc2', ownerUid: '550e8400-e29b-41d4-a716-446655440000', accountNumber: '0987654321', balance: 1000, currency: 'USD', status: 'active', isPrimary: false }
    ],
    pendingAccounts: [] as any[],
    closureRequests: [] as any[],
    transactions: [] as any[],
    auditLogs: [] as any[],
    emails: [] as any[]
  };

  // Load data if exists
  if (fs.existsSync(effectiveDataFile)) {
    try {
      const savedData = JSON.parse(fs.readFileSync(effectiveDataFile, 'utf8'));
      Object.assign(dbData, savedData);
      console.log(`[DB] Data loaded from ${effectiveDataFile}`);
    } catch (e) {
      console.error(`[DB] Error loading ${effectiveDataFile}, using defaults`);
    }
  }

  let saveTimeout: NodeJS.Timeout | null = null;
  const saveDb = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        const dataString = JSON.stringify(dbData, null, 2);
        fs.writeFileSync(effectiveDataFile, dataString);
        process.stdout.write(`[DB] Data saved. TX: ${dbData.transactions.length}, Acc: ${dbData.accounts.length}, Audit: ${dbData.auditLogs.length}\n`);
      } catch (e) {
        console.error('[DB] Error saving data:', e);
      }
    }, 5000); // 5 second debounce to reduce disk I/O load, safe for simulation
  };

  // Helper to sync existing users/accounts to microservices with retry
  const syncUsersToMicroservices = async (retries = 15) => {
    if (!process.env.USE_REAL_SERVICES || process.env.USE_REAL_SERVICES !== 'true') return;
    
    // Check if Account Service is healthy
    const isHealthy = await fetch(`${ACCOUNT_SERVICE}/actuator/health`)
      .then(r => r.ok)
      .catch(() => false);

    if (!isHealthy) {
      if (retries > 0) {
        if (retries % 3 === 0) console.log(`[GATEWAY] Waiting for Account Service at ${ACCOUNT_SERVICE}... (${retries} attempts left)`);
        setTimeout(() => syncUsersToMicroservices(retries - 1), 15000); 
      } else {
        console.error(`[GATEWAY] Sync timed out. Could not reach ${ACCOUNT_SERVICE}`);
      }
      return;
    }

    console.log(`[GATEWAY] Syncing state to ${ACCOUNT_SERVICE}...`);
    
    try {
      const syncBatch = [];
      for (const user of dbData.users) {
        // Sync all accounts regardless of status to ensure the microservice is aware of closed/deleted states
        const userAccounts = dbData.accounts.filter(a => a.ownerUid === user.uid);
        for (const acc of userAccounts) {
          syncBatch.push(fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: acc.id,
              ownerUid: user.uid,
              customerNumber: user.customerNumber,
              password: user.password,
              name: user.displayName || 'Bank Customer',
              email: user.email,
              role: user.role,
              balance: acc.balance,
              accountNumber: acc.accountNumber,
              currency: acc.currency,
              status: acc.status || 'active',
              isPrimary: !!acc.isPrimary
            })
          }).catch(e => console.warn(`[SYNC] Failed for ${acc.accountNumber}: ${e.message}`)));
          
          // Throttle batching to prevent CPU spikes
          if (syncBatch.length > 5) {
            await Promise.all(syncBatch);
            syncBatch.length = 0;
            await new Promise(r => setTimeout(r, 500)); // 500ms Cool down between batches
          }
        }
      }
      if (syncBatch.length > 0) await Promise.all(syncBatch);
      
      // Also sync transactions
      console.log(`[GATEWAY] Syncing transactions to ${TRANSACTION_SERVICE}...`);
      const txBatch = [];
      for (const tx of dbData.transactions) {
        txBatch.push(fetch(`${TRANSACTION_SERVICE}/api/transactions/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tx)
        }).catch(e => console.warn(`[SYNC] Failed for TX ${tx.id}: ${e.message}`)));
        
        if (txBatch.length > 5) {
          await Promise.all(txBatch);
          txBatch.length = 0;
          await new Promise(r => setTimeout(r, 200));
        }
      }
      if (txBatch.length > 0) await Promise.all(txBatch);
      
      console.log('[GATEWAY] Backend synchronization complete.');
    } catch (err: any) {
      console.error(`[GATEWAY] Sync Exception: ${anyErr(err)}`);
    }
  };

  const pushAudit = async (event: string, userId: string, metadata: any = {}) => {
    const timestamp = getISTTime();
    const logId = `LOG-${Math.random().toString(36).substr(2, 9)}`;
    
    // Always log locally first
    const entry = { id: logId, event, userId, timestamp, metadata: typeof metadata === 'object' ? metadata : { msg: metadata } };
    dbData.auditLogs.unshift(entry);
    if (dbData.auditLogs.length > 2000) dbData.auditLogs.pop();
    saveDb();

    // If using real services, attempt to push asynchronously
    if (useProxy && serviceStatus.audit) {
      const payload = { 
        id: logId,
        event, 
        userId, 
        metadata: typeof metadata === 'object' ? JSON.stringify(metadata) : String(metadata)
      };
      
      fetch(`${AUDIT_SERVICE}/api/audit/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => {
        console.warn(`[AUDIT] Microservice push failed: ${err.message}`);
      });
    }
  };

  // JWT Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      
      // User Existence Check
      const existingUser = dbData.users.find(u => u.uid === decoded.uid);
      if (!existingUser) {
        return res.status(404).json({ 
          error: 'User account not found.',
          message: 'It appears you are not currently a part of our banking system. We would love to have you! Please register to start your journey with us.' 
        });
      }

      if (existingUser.status === 'locked' || existingUser.status === 'frozen' || existingUser.status === 'deleted_final') {
        return res.status(403).json({ 
          error: 'Access Restricted', 
          message: `Your account is currently ${existingUser.status.replace(/_/g, ' ')}. Transfers and primary actions are restricted for frozen or locked accounts. Please contact support.` 
        });
      }
      
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Admin Middleware
  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  };

  // --- Spring Boot Proxy Logic ---
  const TRANSACTION_SERVICE = process.env.TRANSACTION_SERVICE_URL || 'http://transaction-service:8081';
  const AUDIT_SERVICE = process.env.AUDIT_SERVICE_URL || 'http://audit-service:8082';
  const ACCOUNT_SERVICE = process.env.ACCOUNT_SERVICE_URL || 'http://account-service:8083';
  const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:8084';

  // Load configurations
  const useProxy = process.env.USE_REAL_SERVICES === 'true';
  console.log(`[GATEWAY] USE_REAL_SERVICES: ${process.env.USE_REAL_SERVICES} (Internal useProxy: ${useProxy})`);

  // Health check state for dynamic proxy fallback
  const serviceStatus: any = {
    account: false,
    transaction: false,
    audit: false,
    instances: 1
  };

  const checkHealth = async () => {
    // If not using real services, show as "Emulated Online"
    try {
      if (!useProxy) {
        serviceStatus.account = true;
        serviceStatus.transaction = true;
        serviceStatus.audit = true;
        serviceStatus.notification = true;
        console.log(`[HEALTH] Emulated mode: All services reporting UP (Traffic: ${clusterTrafficMultiplier}x)`);
      } else {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000);
        
        const results = await Promise.all([
          fetch(`${ACCOUNT_SERVICE}/actuator/health`, { signal: controller.signal }).then(r => r.ok || (r.status >= 400 && r.status < 500)).catch(() => false),
          fetch(`${TRANSACTION_SERVICE}/actuator/health`, { signal: controller.signal }).then(r => r.ok || (r.status >= 400 && r.status < 500)).catch(() => false),
          fetch(`${AUDIT_SERVICE}/actuator/health`, { signal: controller.signal }).then(r => r.ok || (r.status >= 400 && r.status < 500)).catch(() => false),
          fetch(`${NOTIFICATION_SERVICE}/actuator/health`, { signal: controller.signal }).then(r => r.ok || (r.status >= 400 && r.status < 500)).catch(() => false)
        ]);
        
        clearTimeout(id);
        serviceStatus.account = results[0];
        serviceStatus.transaction = results[1];
        serviceStatus.audit = results[2];
        serviceStatus.notification = results[3];
      }
      
      // Infrastructure Scaling Logic - More aggressive for simulation
      if (clusterTrafficMultiplier >= 1) {
        serviceStatus.instances = Math.min(10, Math.max(2, Math.ceil(clusterTrafficMultiplier / 1.5)));
      } else {
        serviceStatus.instances = 1;
      }
      
      if (serviceStatus.account || serviceStatus.transaction || serviceStatus.audit) {
        console.log(`[GATEWAY] Microservice Status: Account=${serviceStatus.account}, Tx=${serviceStatus.transaction}, Audit=${serviceStatus.audit} (Cluster Size: ${serviceStatus.instances})`);
      }
    } catch (e) {
      // Just keep old status
    }
  };

  // Immediate check then periodic
  checkHealth();
  setInterval(checkHealth, 30000);

  if (useProxy) {
    console.log(`[GATEWAY] Proxying enabled. Checking health for targets...`);
  }

  // --- Integration Controllers ---
  // In a distributed production environment, these routes manage traffic flow
  // between the core banking engine and the edge gateway.

  // Auth API: Login
  app.post('/api/auth/login', (req, res) => {
    const { customerNumber, password } = req.body;
    const user = dbData.users.find(u => (u.customerNumber === customerNumber || u.email === customerNumber) && u.password === password);
    if (user) {
      if (user.status !== 'active' && user.status !== 'deleted_pending_summary') {
        let statusMsg = '';
        let actionMsg = '';

        switch (user.status) {
          case 'locked':
            statusMsg = 'Account Locked';
            actionMsg = 'Your account has been restricted for security reasons. Please contact our Security Operations Center.';
            break;
          case 'dormant':
          case 'inactive':
            statusMsg = 'Account Dormant';
            actionMsg = 'Your account has been inactive for too long. Please contact support to reactivate your access.';
            break;
          case 'frozen':
            statusMsg = 'Account Frozen';
            actionMsg = 'This account is currently under an administrative freeze. Please visit your local branch.';
            break;
          case 'deleted_final':
          case 'closed':
          case 'permanently_closed':
            statusMsg = 'Account Closed';
            actionMsg = 'This account has been permanently closed and is no longer accessible. If you believe this is an error, please contact our support team.';
            break;
          default:
            statusMsg = 'Access Restricted';
            actionMsg = `Your account is currently in ${user.status} state. Please contact customer support.`;
        }
        
        return res.status(403).json({ 
          error: statusMsg,
          message: actionMsg 
        });
      }
      
      const token = jwt.sign({ uid: user.uid, customerNumber: user.customerNumber, role: user.role }, JWT_SECRET);
      
      // Audit Log for Login
      pushAudit('USER_LOGIN', user.uid, { customerNumber: user.customerNumber });

      // Sync user with Account Service
      if (useProxy) {
        const userAccounts = dbData.accounts.filter(a => a.ownerUid === user.uid);
        userAccounts.forEach(acc => {
          fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
              id: acc.id,
              ownerUid: user.uid,
              customerNumber: user.customerNumber,
              password: user.password,
              email: user.email,
              name: user.displayName || 'Bank Customer',
              balance: acc.balance,
              accountNumber: acc.accountNumber,
              role: user.role,
              status: acc.status || 'active', // FIXED: Use account status, not user status
              isPrimary: !!acc.isPrimary
            })
          }).catch(err => console.error(`[GATEWAY] Login Sync Error: ${anyErr(err)}`));
        });
      }

      res.json({ user, token });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  // Auth API: Register
  app.post('/api/auth/register', (req, res) => {
    const { displayName, email, password } = req.body;

    // Server-side email validation (Strict regex for .com/TLD)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'A valid email address with a domain (e.g., .com) is required' });
    }

    const customerNumber = `CUST${1000 + dbData.users.length + 1}`;
    const newUser = {
      uid: crypto.randomUUID(),
      customerNumber,
      password,
      email,
      displayName,
      role: 'customer',
      phoneNumber: '',
      address: '',
      status: 'active'
    };
    dbData.users.push(newUser);

    // Automatically create a Primary Account for new users in mock DB
    const primaryAccount = {
      id: `acc-${Math.random().toString(36).substr(2, 9)}`,
      ownerUid: newUser.uid,
      accountNumber: `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      balance: 5000.0, // Welcome balance
      currency: 'USD',
      status: 'active',
      isPrimary: true
    };
    dbData.accounts.push(primaryAccount);

    // Initial welcome transaction to make history visible
    dbData.transactions.unshift({
      id: `TX-WELCOME-${newUser.uid.substring(0, 8)}`,
      from: 'CENTRAL_BANK',
      to: primaryAccount.accountNumber,
      amount: primaryAccount.balance,
      initiatorUid: 'SYSTEM',
      timestamp: getISTTime(),
      status: 'completed'
    });

    saveDb();
    
    // Audit Log for Registration
    pushAudit('USER_REGISTERED', newUser.uid, { customerNumber: newUser.customerNumber, accountId: primaryAccount.id });

    // Send Welcome Email
    sendEmail(
      newUser.uid,
      'Welcome to Banking Microservices System',
      `Welcome ${newUser.displayName}! We are excited to have you with us. Your primary account ${primaryAccount.accountNumber} has been automatically created and credited with a welcome balance of $5,000.00. You can now start managing your finances in our Banking System.`
    );

    // SYNC TO REAL SERVICES: If enabled, push the user and its primary account to the Account Service
    if (useProxy) {
      fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: primaryAccount.id,
          ownerUid: newUser.uid,
          customerNumber: newUser.customerNumber,
          password: newUser.password,
          name: newUser.displayName || 'Bank Customer',
          email: newUser.email,
          role: newUser.role,
          balance: 5000.0,
          accountNumber: primaryAccount.accountNumber,
          currency: 'USD',
          status: 'active',
          isPrimary: true
        })
      }).catch(err => console.error(`[GATEWAY] Failed to sync user to Account Service: ${err.message}`));
    }

    console.log(`[AUTH] New user registered: ${displayName} (${customerNumber})`);
    res.json({ customerNumber, email, message: 'Registration successful.' });
  });

  // Profile API
  app.get('/api/profile', authenticateToken, (req: any, res) => {
    const user = dbData.users.find(u => u.uid === req.user.uid);
    res.json(user);
  });

  // Summary API
  app.get('/api/auth/summary', authenticateToken, (req: any, res) => {
    const user = dbData.users.find(u => u.uid === req.user.uid);
    if (!user || (user.status !== 'deleted_pending_summary' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Summary service not available' });
    }

    const userAccounts = dbData.accounts.filter(a => a.ownerUid === user.uid);
    const userAccNums = dbData.accounts.filter(a => a.ownerUid === user.uid).map(a => String(a.accountNumber).trim());
    
    // Include transactions for all accounts (active or historical) to ensure history is visible during deletion
    const userTransactions = dbData.transactions.filter(t => 
      t.initiatorUid === user.uid || 
      userAccNums.includes(String(t.from).trim()) || 
      userAccNums.includes(String(t.to).trim())
    );
    
    res.json({
      user: {
        displayName: user.displayName,
        customerNumber: user.customerNumber,
        email: user.email,
        status: user.status
      },
      accounts: userAccounts,
      transactions: userTransactions,
      generatedAt: getISTTime()
    });
  });

  // Finalize Deletion API
  app.post('/api/auth/finalize-deletion', authenticateToken, (req: any, res) => {
    const user = dbData.users.find(u => u.uid === req.user.uid);
    if (user && user.status === 'deleted_pending_summary') {
      const userAccounts = dbData.accounts.filter(a => a.ownerUid === user.uid);
      const totalLiquidatedBalance = userAccounts.reduce((sum, acc) => {
        const val = (typeof acc.balance === 'string' ? parseFloat(acc.balance) : Number(acc.balance)) || 0;
        return sum + val;
      }, 0);
      
      user.status = 'deleted_final';
      
      // Record the specific liquidation event for the global monitor
      const purgeRecord = {
        id: `TX-PURGE-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        from: 'USER_VAULT',
        to: 'CLEARING_HOUSE',
        amount: totalLiquidatedBalance,
        timestamp: getISTTime(),
        status: 'completed',
        type: 'ACCOUNT_PURGE',
        initiatorUid: user.uid
      };
      dbData.transactions.unshift(purgeRecord);
      kafkaBus.emit('transaction_completed', { ...purgeRecord, category: 'security' });

      // Mark all user accounts as closed
      userAccounts.forEach(acc => {
        acc.status = 'closed';
        acc.balance = 0;
      });

      saveDb();
      
      // Permanent sync deletion to backend
      if (useProxy) {
        fetch(`${ACCOUNT_SERVICE}/api/accounts/owner/${user.uid}`, {
          method: 'DELETE',
          headers: { 'X-User-Role': 'admin' }
        }).catch(err => console.error(`[GATEWAY] Permanent delete sync failed: ${anyErr(err)}`));
      }

      res.json({ message: 'Account permanently closed. Thank you for banking with us.' });
    } else {
      res.status(400).json({ error: 'Invalid request' });
    }
  });

  app.put('/api/profile', authenticateToken, (req: any, res) => {
    const { phoneNumber, address, displayName } = req.body;
    const userIndex = dbData.users.findIndex(u => u.uid === req.user.uid);
    if (userIndex !== -1) {
      dbData.users[userIndex] = { ...dbData.users[userIndex], phoneNumber, address, displayName };
      saveDb();
      res.json(dbData.users[userIndex]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

  app.get('/api/accounts', authenticateToken, (req: any, res: any, next: any) => {
    // Also check if the user is locked or dormant - if so, all accounts should be shown as frozen
    const user = dbData.users.find(u => u.uid === req.user.uid);
    const userProfileStatus = (user?.status || 'active').toLowerCase();

    if (useProxy && serviceStatus.account) {
      return proxy(ACCOUNT_SERVICE, {
        ...proxyOptions,
        proxyReqPathResolver: (req) => req.originalUrl,
        userResDecorator: (proxyRes, proxyResData, userReq: any, userRes) => {
          try {
            const body = JSON.parse(proxyResData.toString());
            if (Array.isArray(body)) {
              // Robust filtering for the gateway to ensure consistency
              const filtered = body.filter((a: any) => {
                const status = (a.status || '').toLowerCase();
                return status !== 'closed' && 
                       status !== 'permanently_closed' &&
                       status !== 'deleted_final';
              }).map(a => ({
                ...a,
                // Override status if user is locked/dormant
                status: (userProfileStatus === 'locked' || userProfileStatus === 'dormant') ? 'frozen' : a.status
              }));
              return JSON.stringify(filtered);
            }
            return proxyResData;
          } catch (e) {
            return proxyResData;
          }
        }
      })(req, res, next);
    }
    const userAccounts = dbData.accounts.filter(a => {
      const status = (a.status || '').toLowerCase().trim();
      const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
      return a.ownerUid === req.user.uid && !forbidden.includes(status);
    }).map(a => ({
      ...a,
      status: (userProfileStatus === 'locked' || userProfileStatus === 'dormant') ? 'frozen' : a.status
    }));
    res.json(userAccounts);
  });

  // Emails API
  app.get('/api/emails', authenticateToken, (req: any, res) => {
    console.log(`[GATEWAY] Fetching emails for ${req.user.uid}`);
    const userEmails = dbData.emails.filter(e => e.toUid === req.user.uid);
    res.json(userEmails.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  });

  app.post('/api/emails/mark-read', authenticateToken, (req: any, res) => {
    const { emailId } = req.body;
    const email = dbData.emails.find(e => e.id === emailId && e.toUid === req.user.uid);
    if (email) {
      email.read = true;
      saveDb();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Email not found' });
    }
  });

  const sendEmail = (toUid: string, subject: string, body: string) => {
    const istNow = formatISTDate();
    const email = {
      id: `EML-${Math.random().toString(36).substr(2, 9)}`,
      toUid,
      subject,
      body: `${body}\n\nDate: ${istNow}`,
      timestamp: getISTTime(),
      read: false
    };
    dbData.emails.push(email);
    saveDb();
    console.log(`[EMAIL SERVICE] Sent to ${toUid}: ${subject}`);
  };

  // Internal bridge for microservices to push mock emails to the UI
  app.post('/api/internal/push-email', (req, res) => {
    const { toEmail, toUid, accountNumber, subject, body, username, initiatorUid } = req.body;
    
    // Normalize N/A values from Java services
    const cleanToUid = (toUid && toUid !== 'N/A' && toUid !== 'null') ? toUid : null;
    const cleanInitiatorUid = (initiatorUid && initiatorUid !== 'N/A' && initiatorUid !== 'null') ? initiatorUid : null;
    const cleanAcc = (accountNumber && accountNumber !== 'N/A' && accountNumber !== 'null') ? accountNumber : null;
    const cleanToEmail = (toEmail && toEmail !== 'N/A' && toEmail !== 'null') ? toEmail : null;

    let targetUid = cleanToUid || cleanInitiatorUid;
    
    // Log the incoming request details for debugging recipient resolution
    console.log(`[BRIDGE] Email request. To: ${cleanToEmail || 'N/A'}, Acc: ${cleanAcc || 'N/A'}, Sub: ${subject}`);

    // Robust mapping for microservice identifiers
    if (!targetUid || targetUid === 'system' || targetUid === 'N/A' || targetUid === 'null') {
      // Clean and normalize all potential inputs
      const searchToEmail = (toEmail || '').toString().toLowerCase().trim();
      const searchAccNum = (accountNumber || '').toString().replace(/\D/g, '').trim();
      const searchUsername = (username || '').toString().toLowerCase().trim();

      // Priority 1: Match by exact email match
      if (searchToEmail && searchToEmail !== 'n/a' && searchToEmail !== 'null') {
        const userByEmail = dbData.users.find(u => u.email.toLowerCase().trim() === searchToEmail);
        if (userByEmail) targetUid = userByEmail.uid;
      }
      
      // Priority 2: Match by account number
      if ((!targetUid || targetUid === 'system' || targetUid === 'N/A') && searchAccNum && searchAccNum.length >= 5) {
        const acc = dbData.accounts.find(a => String(a.accountNumber).trim() === searchAccNum || a.id === searchAccNum);
        if (acc) {
          targetUid = acc.ownerUid;
        } else {
          // If not found in accounts, check transactions for mappings
          const tx = dbData.transactions.find(t => 
            String(t.from).replace(/\D/g, '') === searchAccNum || 
            String(t.to).replace(/\D/g, '') === searchAccNum
          );
          if (tx && tx.initiatorUid && tx.initiatorUid !== 'SYSTEM' && tx.initiatorUid !== 'system') targetUid = tx.initiatorUid;
        }
      }

      // Priority 3: Match by displayName or customerNumber
      if (!targetUid && searchUsername) {
        const userByMeta = dbData.users.find(u => 
          u.displayName.toLowerCase().trim() === searchUsername || 
          u.customerNumber.toLowerCase().trim() === searchUsername
        );
        if (userByMeta) targetUid = userByMeta.uid;
      }
    }

    if (targetUid && (targetUid === 'system' || targetUid === 'N/A')) {
       // Check if this was a transfer and we can peek into the body for account numbers
       const accMatch = body?.match(/\d{10}/);
       if (accMatch) {
         const acc = dbData.accounts.find(a => String(a.accountNumber).trim() === accMatch[0]);
         if (acc) targetUid = acc.ownerUid;
       }
    }

    if (targetUid && targetUid !== 'system' && targetUid !== 'N/A') {
      const email = {
        id: `EML-BR-${Math.random().toString(36).substr(2, 9)}`,
        toUid: targetUid,
        subject,
        body,
        timestamp: getISTTime(),
        read: false
      };
      dbData.emails.unshift(email);
      if (dbData.emails.length > 5000) dbData.emails.pop();
      saveDb();
      console.log(`[BRIDGE] Resolved and delivered to: ${targetUid}`);
      res.json({ success: true, matchedUid: targetUid });
    } else {
      console.warn(`[BRIDGE] Could not resolve recipient. Subject: ${subject}`);
      res.json({ success: true, note: 'Discarded' });
    }
  });

  // --- Account Routes ---

  // Request Account Creation (Customer)
  app.post('/api/accounts/request', authenticateToken, (req: any, res, next) => {
    // DO NOT PROXY: This request is queued for admin approval in the Node.js layer
    const { type } = req.body;
    const user = dbData.users.find(u => u.uid === req.user.uid);
    
    if (user?.status === 'dormant') {
      return res.status(403).json({ error: 'Your account is dormant. You cannot open new accounts.' });
    }

    const userAccounts = dbData.accounts.filter(a => a.ownerUid === req.user.uid && a.status?.toLowerCase() !== 'closed');
    const userPending = dbData.pendingAccounts.filter(p => p.ownerUid === req.user.uid && p.status === 'pending');
    
    const primaryCount = userAccounts.filter(a => a.isPrimary).length + userPending.filter(p => p.type === 'primary').length;
    const secondaryCount = userAccounts.filter(a => !a.isPrimary).length + userPending.filter(p => p.type === 'secondary').length;

    if (type === 'primary' && primaryCount >= 1) {
      return res.status(400).json({ error: 'Limit reached: Only 1 Primary account allowed.' });
    }
    if (type === 'secondary' && secondaryCount >= 2) {
      return res.status(400).json({ error: 'Limit reached: Maximum 2 Secondary accounts allowed.' });
    }

    const request = {
      id: `req-${Math.random().toString(36).substr(2, 9)}`,
      ownerUid: req.user.uid,
      type,
      status: 'pending',
      timestamp: getISTTime()
    };
    dbData.pendingAccounts.push(request);
    saveDb();

    // Send Email notification to user
    sendEmail(
      req.user.uid,
      'Account Request Received',
      `Your request for a new ${type} account has been received and is currently pending admin approval. You will be notified once it is processed.`
    );

    res.json({ message: 'Account request queued for admin approval', request });
  });

  // Request Account Closure (Customer)
  app.post('/api/accounts/:accountId/request-closure', authenticateToken, (req: any, res, next) => {
    // DO NOT PROXY: This is an administrative coordination request handled locally
    const { accountId } = req.params;
    const account = dbData.accounts.find(a => a.id === accountId && a.ownerUid === req.user.uid);
    
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.status?.toLowerCase() === 'closed') return res.status(400).json({ error: 'Account is already closed' });

    const userAccounts = dbData.accounts.filter(a => a.ownerUid === req.user.uid && a.status?.toLowerCase() !== 'closed');
    
    // Logic: Secondary accounts must close first, then primary
    if (account.isPrimary) {
      const activeSecondaries = userAccounts.filter(a => !a.isPrimary);
      if (activeSecondaries.length > 0) {
        return res.status(400).json({ error: 'All secondary accounts must be closed before the primary account can be closed.' });
      }
    }

    const existingRequest = dbData.closureRequests.find(r => r.accountId === accountId && r.status === 'pending');
    if (existingRequest) return res.status(400).json({ error: 'Closure request already pending' });

    const request = {
      id: `cls-${Math.random().toString(36).substr(2, 9)}`,
      accountId,
      ownerUid: req.user.uid,
      status: 'pending',
      timestamp: getISTTime()
    };
    dbData.closureRequests.push(request);
    if (account) account.status = 'closure_pending';
    saveDb();

    // Audit Log for Closure Request
    pushAudit('ACCOUNT_CLOSURE_REQUESTED', req.user.uid, { accountId, requestId: request.id });

    // Email to User
    sendEmail(
      req.user.uid,
      'Account Closure Request Received',
      `Your request to close account ${account.accountNumber} has been received and is pending administrative approval.`
    );

    res.json({ message: 'Closure request submitted for admin approval', request });
  });

  // --- Admin API ---

  app.get('/api/admin/users', authenticateToken, isAdmin, (req: any, res: any) => {
    // Admin can see all details including passwords as requested
    res.json(dbData.users);
  });

  app.put('/api/admin/users/:uid/status', authenticateToken, isAdmin, (req: any, res: any) => {
    const { uid } = req.params;
    const { status } = req.body;
    const user = dbData.users.find(u => u.uid === uid);
    if (user) {
      const oldStatus = user.status;
      user.status = status;
      
      // Consolidated Sync: Push status update for ALL accounts to Account Service
      if (useProxy) {
        const userAccounts = dbData.accounts.filter(a => a.ownerUid === uid);
        userAccounts.forEach(acc => {
          const accStatus = (acc.status || '').toLowerCase().trim();
          const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
          if (forbidden.includes(accStatus)) return;
          
          const newAccStatus = status === 'active' ? 'active' : 'frozen';
          acc.status = newAccStatus;
          
          fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...user,
              name: user.displayName || 'Bank Customer',
              id: acc.id,
              ownerUid: user.uid,
              balance: acc.balance,
              accountNumber: acc.accountNumber,
              currency: acc.currency,
              isPrimary: !!acc.isPrimary,
              status: newAccStatus
            })
          }).catch(err => console.error(`[GATEWAY] Admin sync failed for ${acc.accountNumber}: ${anyErr(err)}`));
        });
      } else {
        // Local only update
        dbData.accounts.forEach(acc => {
          const accStatus = (acc.status || '').toLowerCase().trim();
          const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
          if (acc.ownerUid === uid && !forbidden.includes(accStatus)) {
            acc.status = status === 'active' ? 'active' : 'frozen';
          }
        });
      }

      // Audit Log for Status Change
      pushAudit('USER_STATUS_UPDATED', req.user.uid, { targetUid: uid, oldStatus, newStatus: status });
      saveDb();

      // System Transaction for Locked/Dormant
      if (status === 'locked' || status === 'dormant') {
        dbData.transactions.push({
          id: `SYS-${Math.random().toString(36).substr(2, 9)}`,
          from: 'SYSTEM',
          to: 'USER_NOTIF',
          amount: 0,
          initiatorUid: 'system',
          timestamp: getISTTime(),
          status: 'completed',
          metadata: { message: `Account status changed to ${status} by system administration.` }
        });

        // Email to user about status change
        sendEmail(
          user.uid,
          'Security Alert: Account Status Changed',
          `Administrative action has been taken on your account. Your current status is now: ${status.toUpperCase()}. If you did not expect this, please contact support.`
        );
      }

      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

  app.delete('/api/admin/users/:uid', authenticateToken, isAdmin, (req: any, res: any) => {
    const { uid } = req.params;
    const userIndex = dbData.users.findIndex(u => u.uid === uid);
    
    if (userIndex !== -1) {
      const user = dbData.users[userIndex];
      
      // If already marked as pending or final, perform actual deletion from array
      if (user.status === 'deleted_pending_summary' || user.status === 'deleted_final') {
        dbData.users.splice(userIndex, 1);
        
        // Also remove associated accounts
        for (let i = dbData.accounts.length - 1; i >= 0; i--) {
          if (dbData.accounts[i].ownerUid === uid) {
            dbData.accounts.splice(i, 1);
          }
        }
        
        saveDb();
        pushAudit('USER_PERMANENTLY_PURGED', req.user.uid, { targetUid: uid, customerNumber: user.customerNumber });
        return res.json({ message: 'User record completely removed from system.' });
      }

      // Otherwise, just mark as pending summary
      user.status = 'deleted_pending_summary';
      saveDb();
      
      // Freeze all accounts in backend if exists
      const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
      const userAccounts = dbData.accounts.filter(a => a.ownerUid === uid && !forbidden.includes((a.status || '').toLowerCase().trim()));
      userAccounts.forEach(acc => {
        acc.status = 'frozen';
        if (useProxy) {
          fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...user,
              id: acc.id,
              ownerUid: user.uid,
              name: user.displayName || 'Bank Customer',
              balance: acc.balance,
              accountNumber: acc.accountNumber,
              status: 'frozen',
              isPrimary: !!acc.isPrimary
            })
          }).catch(err => console.error(`[GATEWAY] Delete sync failed for ${acc.accountNumber}: ${anyErr(err)}`));
        }
      });

      // Audit Log for User Deletion
      pushAudit('USER_DELETION_INITIATED', req.user.uid, { targetUid: uid, customerNumber: user.customerNumber });

      // Email to User
      sendEmail(
        user.uid,
        'Account Deletion Notice',
        'Administrative action has been taken to delete your profile. Your account is currently in "pending deletion" state. You may log in one last time to view your final financial summary.'
      );

      saveDb();
      res.json({ message: 'User marked for deletion. One-time summary service enabled.' });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

    app.get('/api/admin/accounts', authenticateToken, isAdmin, (req: any, res: any, next: any) => {
      if (useProxy && serviceStatus.account) {
        return proxy(ACCOUNT_SERVICE, {
          ...proxyOptions,
          proxyReqPathResolver: () => '/api/accounts/all',
          userResDecorator: (proxyRes, proxyResData) => {
            try {
              const accounts = JSON.parse(proxyResData.toString());
              if (Array.isArray(accounts)) {
                const filtered = accounts.filter(a => {
                  const status = (a.status || '').toLowerCase().trim();
                  return status !== 'closed' && 
                         status !== 'permanently_closed' && 
                         status !== 'deleted_final';
                });
                return JSON.stringify(filtered);
              }
            } catch (e) {}
            return proxyResData;
          }
        })(req, res, next);
      }
    // Admin should only see non-closed accounts by default in the main overview
    const activeAccounts = dbData.accounts.filter(a => {
      const status = (a.status || '').toLowerCase().trim();
      const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
      return !forbidden.includes(status);
    });
    res.json(activeAccounts);
    });

    app.get('/api/admin/requests/pending', authenticateToken, isAdmin, (req: any, res: any) => {
    const pending = dbData.pendingAccounts.filter(p => p.status === 'pending').map(p => {
      const user = dbData.users.find(u => u.uid === p.ownerUid);
      return { ...p, userDisplayName: user?.displayName, userEmail: user?.email, customerNumber: user?.customerNumber };
    });
    res.json(pending);
  });

  app.get('/api/admin/requests/closures', authenticateToken, isAdmin, (req: any, res: any) => {
    const pending = dbData.closureRequests.filter(p => p.status === 'pending').map(p => {
      const user = dbData.users.find(u => u.uid === p.ownerUid);
      const account = dbData.accounts.find(a => a.id === p.accountId);
      return { ...p, userDisplayName: user?.displayName, accountNumber: account?.accountNumber, accountType: account?.isPrimary ? 'Primary' : 'Secondary' };
    });
    res.json(pending);
  });

  app.post('/api/admin/closures/:requestId/:action', authenticateToken, isAdmin, (req: any, res: any) => {
    const { requestId, action } = req.params; // action: 'approve' or 'reject'
    const requestIndex = dbData.closureRequests.findIndex(p => p.id === requestId);
    if (requestIndex === -1) return res.status(404).json({ error: 'Request not found' });

    const request = dbData.closureRequests[requestIndex];
    request.status = action === 'approve' ? 'approved' : 'rejected';

    const user = dbData.users.find(u => u.uid === request.ownerUid);
    const account = dbData.accounts.find(a => a.id === request.accountId);

    if (action === 'approve' && account) {
      const closingBalance = Number(account.balance);
      account.status = 'deleted_final';
      account.balance = 0; // Update balance immediately
      
      // Update local transaction log for Admin monitor
      const closureTx = {
        id: `TX-CLOSURE-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        from: account.accountNumber,
        to: 'BANK_RESERVE',
        amount: closingBalance,
        timestamp: getISTTime(),
        status: 'completed',
        type: 'ACCOUNT_CLOSURE',
        initiatorUid: request.ownerUid
      };

      dbData.transactions.unshift(closureTx);
      if (dbData.transactions.length > 500) dbData.transactions.pop();

      // Emit to Kafka for visualizer
      kafkaBus.emit('transaction_completed', { ...closureTx, category: 'maintenance' });

      // SYNC TO REAL SERVICES: Update account status to 'closed' in Account Service
      if (useProxy) {
        if (user) {
          fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...user,
              name: user.displayName || 'Bank Customer', 
              id: account.id,
              ownerUid: user.uid,
              balance: 0,
              accountNumber: account.accountNumber,
              currency: account.currency,
              isPrimary: !!account.isPrimary,
              status: 'deleted_final'
            })
          }).catch(err => console.error(`[GATEWAY] Closure sync failed: ${err.message}`));
        }
      }
    } else if (action === 'reject' && account) {
      account.status = 'active';
    }
    
    saveDb();

    // Audit Log
    pushAudit(`ACCOUNT_CLOSURE_${action.toUpperCase()}`, req.user.uid, { 
      requestId, 
      accountId: request.accountId,
      targetUid: request.ownerUid 
    });

    // Email to User
    if (user && account) {
      const subject = action === 'approve' ? 'Account Closure Approved' : 'Account Closure Rejected';
      const body = action === 'approve' 
        ? `Your request to close account ${account.accountNumber} has been approved. The account is now closed.`
        : `Your request to close account ${account.accountNumber} has been rejected by the administration. Please contact support for more details.`;
      
      sendEmail(user.uid, subject, body);
    }

    saveDb();
    res.json({ message: `Closure request ${action}d` });
  });

  app.post('/api/admin/requests/:requestId/:action', authenticateToken, isAdmin, async (req: any, res: any) => {
    const { requestId, action } = req.params;
    const requestIndex = dbData.pendingAccounts.findIndex(p => p.id === requestId);
    if (requestIndex === -1) return res.status(404).json({ error: 'Request not found' });

    const request = dbData.pendingAccounts[requestIndex];
    
    if (action === 'reject') {
      request.status = 'rejected';
      
      // Email to User for Rejection
      const owner = dbData.users.find(u => u.uid === request.ownerUid);
      if (owner) {
        sendEmail(
          owner.uid,
          'Account Request Rejected',
          `Your request for a new ${request.type} account has been reviewed and rejected by the administration. Please contact support for further information.`
        );
      }

      pushAudit('ACCOUNT_REQUEST_REJECTED', req.user.uid, { requestId, ownerUid: request.ownerUid });
      return res.json({ message: 'Account request rejected' });
    }

    request.status = 'approved';

    const newAccount = {
      id: `acc-${Math.random().toString(36).substr(2, 9)}`,
      ownerUid: request.ownerUid,
      accountNumber: `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      balance: request.type === 'primary' ? 5000 : 1000,
      currency: 'USD',
      status: 'active',
      isPrimary: request.type === 'primary'
    };
    dbData.accounts.push(newAccount);
    
    // Add transaction record for new account welcome balance
    const welcomeTx = {
      id: `TX-WELCOME-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      from: 'BANK_CREDIT_LINE',
      to: newAccount.accountNumber,
      amount: newAccount.balance,
      timestamp: getISTTime(),
      status: 'completed',
      type: 'ACCOUNT_CREATION',
      initiatorUid: request.ownerUid
    };
    dbData.transactions.unshift(welcomeTx);
    kafkaBus.emit('transaction_completed', { ...welcomeTx, category: 'administration' });

    saveDb();

    // Send Email Notification
    sendEmail(
      request.ownerUid,
      'Account Approved',
      `Your ${request.type} account request has been approved. Your new account number is ${newAccount.accountNumber}. A welcome balance of ${new Intl.NumberFormat('en-US', { style: 'currency', currency: newAccount.currency }).format(newAccount.balance)} has been credited.`
    );

    pushAudit('ACCOUNT_APPROVED', req.user.uid, { requestId, accountId: newAccount.id, ownerUid: request.ownerUid });
    
    // SYNC TO REAL SERVICES: Push new account to Account Service
    if (useProxy) {
      const owner = dbData.users.find(u => u.uid === request.ownerUid);
      if (owner) {
        // We await the sync to ensure the backend is updated before the UI refreshes
        console.log(`[GATEWAY] Syncing approved account ${newAccount.accountNumber} for user ${owner.uid}`);
        try {
          const syncRes = await fetch(`${ACCOUNT_SERVICE}/api/accounts/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newAccount.id,
              ownerUid: owner.uid,
              customerNumber: owner.customerNumber,
              password: owner.password,
              name: owner.displayName || 'Bank Customer',
              email: owner.email,
              role: owner.role,
              balance: newAccount.balance,
              accountNumber: newAccount.accountNumber,
              currency: newAccount.currency,
              status: newAccount.status,
              isPrimary: !!newAccount.isPrimary
            })
          });
          
          if (!syncRes.ok) {
            const txt = await syncRes.text();
            console.error(`[GATEWAY] Approval sync failed with status ${syncRes.status}: ${txt}`);
          } else {
            console.log(`[GATEWAY] Approval sync successful for ${newAccount.accountNumber}`);
          }
        } catch (err) {
          console.error(`[GATEWAY] Approval sync error: ${anyErr(err)}`);
        }
      }
    }
    
    saveDb();
    res.json({ message: 'Account approved and created', account: newAccount });
  });

  // Transfer API
  app.get('/api/transactions', authenticateToken, (req: any, res: any, next: any) => {
    if (useProxy && serviceStatus.transaction) {
      return proxy(TRANSACTION_SERVICE, {
        ...proxyOptions,
        proxyReqPathResolver: (req) => req.originalUrl
      })(req, res, next);
    }

    // Admin sees everything (Filter out $0 system notifications from financial list)
    if (req.user.role === 'admin') {
      const filteredAdminTx = dbData.transactions.filter(t => t.amount > 0 && t.from !== 'SYSTEM');
      return res.json(filteredAdminTx.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    }

    // Get all account numbers belonging to this user
    const userAccountNumbers = dbData.accounts
      .filter(a => a.ownerUid === req.user.uid)
      .map(a => String(a.accountNumber).trim());

    console.log(`[API] Fetching transactions for user ${req.user.uid}. User accounts: ${userAccountNumbers.join(', ')}`);

    const userTransactions = dbData.transactions.filter(t => 
      String(t.initiatorUid) === String(req.user.uid) || 
      userAccountNumbers.includes(String(t.from).trim()) || 
      userAccountNumbers.includes(String(t.to).trim())
    ).filter(t => t.amount > 0 && t.from !== 'SYSTEM'); // Filter out $0 system notifications/actions

    console.log(`[API] Found ${userTransactions.length} transactions for user ${req.user.uid}`);

    res.json(userTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  });

  // Audit Logs API (Standard Mock Path)
  app.get('/api/audit/logs', authenticateToken, isAdmin, async (req: any, res, next) => {
    let microserviceLogs: any[] = [];
    
    if (useProxy && serviceStatus.audit) {
      try {
        const response = await fetch(`${AUDIT_SERVICE}/api/audit/logs`, {
          headers: { 'Authorization': req.headers['authorization'] || '' }
        });
        if (response.ok) {
          microserviceLogs = await response.json();
        }
      } catch (err) {
        console.warn(`[AUDIT] Could not fetch live logs: ${anyErr(err)}`);
      }
    }
    
    // Combined microservice logs with local ones (using ID-based deduplication)
    const combined = [...microserviceLogs];
    const existingIds = new Set(combined.map((l: any) => l.id));
    
    for (const log of dbData.auditLogs) {
      if (!existingIds.has(log.id)) {
        combined.push(log);
      }
    }

    res.json(combined
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 200)
    );
  });

  app.post('/api/audit/logs', authenticateToken, isAdmin, (req: any, res) => {
    const { event, userId, timestamp, metadata } = req.body;
    const log = {
      id: `LOG-${Math.random().toString(36).substr(2, 9)}`,
      event, userId, timestamp: timestamp || getISTTime(),
      metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    };
    dbData.auditLogs.push(log);
    saveDb();
    res.json(log);
  });

  // Transaction API (Transfer)
  app.post('/api/transactions/transfer', authenticateToken, async (req: any, res, next) => {
    console.log(`[POST /api/transactions/transfer] Request from ${req.user.uid}`);
    
    // PERFORM GATEWAY-LEVEL VALIDATIONS BEFORE PROXYING
    // This ensures that even if we proxy, we check known account states in the central DB
    const user = dbData.users.find(u => u.uid === req.user.uid);
    if (user?.status !== 'active') {
      console.warn(`[TRANSFER] Denied: User status is ${user?.status}. UID: ${req.user.uid}`);
      return res.status(403).json({ 
        error: 'Profile Restricted', 
        message: `Your user profile is currently ${user?.status?.replace(/_/g, ' ')}. Please contact support to reactivate your capabilities.` 
      });
    }

    const { from, to, amount } = req.body;
    
    // Security Check: Ensure 'from' account belongs to the user and is ACTIVE
    const sourceAcc = dbData.accounts.find(a => (a.id === from || a.accountNumber === from) && a.ownerUid === req.user.uid);
    if (!sourceAcc) {
      console.warn(`[TRANSFER] Source account not found: ${from} for UID: ${req.user.uid}`);
      return res.status(404).json({ error: 'Source account not found.' });
    }
    
    if (sourceAcc.status !== 'active') {
      console.warn(`[TRANSFER] Source account restricted: ${from} is ${sourceAcc.status}`);
      return res.status(403).json({ 
        error: 'Account Restricted',
        message: 'Access to the banking operation was denied. This usually happens if your account is frozen or locked for security reasons.' 
      });
    }

    // Recipient check
    const destAcc = dbData.accounts.find(a => a.accountNumber === String(to).trim());
    if (destAcc && ['locked', 'frozen', 'dormant', 'closed', 'permanently_closed', 'deleted_final'].includes((destAcc.status || '').toLowerCase())) {
      console.warn(`[TRANSFER] Recipient account restricted: ${to} is ${destAcc.status}`);
      return res.status(403).json({ 
        error: 'Transfer Forbidden',
        message: 'Access to the banking operation was denied. This usually happens if your account is frozen or locked for security reasons.' 
      });
    }

    // Now decide whether to proxy or handle locally
    if (useProxy && serviceStatus.transaction) {
      return proxy(TRANSACTION_SERVICE, {
        ...proxyOptions,
        proxyReqPathResolver: (req) => req.originalUrl,
        userResDecorator: (proxyRes, proxyResData, userReq: any, userRes) => {
          const bodyString = proxyResData.toString();
          // Ensure the response is treated as JSON
          userRes.set('Content-Type', 'application/json');

          if (proxyRes.statusCode === 200 || proxyRes.statusCode === 201) {
            try {
              const body = JSON.parse(bodyString);
              kafkaBus.emit('transaction_completed', {
                id: body.transactionId || body.id || `TX-PRX-${Math.random().toString(36).substr(2, 6)}`,
                from: req.body.from,
                to: req.body.to,
                amount: req.body.amount,
                initiatorUid: req.user.uid,
                timestamp: getISTTime(),
                status: 'completed',
                metadata: { source: 'PROXIED_MICROSERVICE' }
              });
              return JSON.stringify(body);
            } catch (e) {
              console.warn('[GATEWAY] Non-JSON success from transaction service');
              return JSON.stringify({ success: true, message: 'Transfer successful' });
            }
          }
          // Handle error cases: ensure they are also JSON
          if (proxyRes.statusCode >= 400) {
            try {
              JSON.parse(bodyString);
              return proxyResData; 
            } catch (e) {
              return JSON.stringify({ 
                error: 'Service Message', 
                message: 'The banking service returned an alternative response format. Your request might have been processed, please check your transactions.' 
              });
            }
          }
          return proxyResData;
        }
      })(req, res, next);
    } else if (useProxy) {
      console.warn(`[GATEWAY] Transaction Service unreachable. Falling back to local emulated processing.`);
    }

    const timer = transactionDuration.startTimer();
    console.log(`[API Gateway] Validating transfer: ${amount} from ${from} to ${to}`);
    
    try {
      const result = await transactionService({ from, to, amount, initiatorUid: req.user.uid });
      timer();
      res.json(result);
    } catch (err: any) {
      timer();
      const errorMessage = err.message || 'An unexpected error occurred during transfer.';
      console.error(`[TRANSFER ERROR] ${errorMessage}`);
      res.status(400).json({ 
        error: 'Transfer Failed',
        message: errorMessage 
      });
    }
  });

  // Audit Logs API
  app.get('/api/admin/audit-logs', authenticateToken, isAdmin, async (req: any, res, next) => {
    let microserviceLogs: any[] = [];
    
    if (useProxy && serviceStatus.audit) {
      try {
        const response = await fetch(`${AUDIT_SERVICE}/api/audit/logs`, {
          headers: { 'Authorization': req.headers['authorization'] || '' }
        });
        if (response.ok) {
          microserviceLogs = await response.json();
        }
      } catch (err) {
        console.warn(`[ADMIN] Could not fetch live audit logs: ${anyErr(err)}`);
      }
    }
    
    const combined = [...microserviceLogs];
    const existingIds = new Set(combined.map((l: any) => l.id));
    
    for (const log of dbData.auditLogs) {
      if (!existingIds.has(log.id)) {
        combined.push(log);
      }
    }
    
    res.json(combined
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100)
    );
  });

    // Account Transactions API (by Account Number)
    app.get('/api/transactions/:accountNumber', authenticateToken, (req: any, res, next) => {
      if (useProxy && serviceStatus.transaction) {
        return proxy(TRANSACTION_SERVICE, {
          ...proxyOptions,
          proxyReqPathResolver: (req) => `/api/transactions/${req.params.accountNumber}`
        })(req, res, next);
      }
      const { accountNumber } = req.params;
      const account = dbData.accounts.find(a => a.accountNumber === accountNumber || a.id === accountNumber);
      
      if (!account) return res.status(404).json({ error: 'Account not found' });
      if (account.ownerUid !== req.user.uid && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized access to account transactions' });
      }

      // Use account number for filtering both 'from' and 'to'
      const targetNum = String(account.accountNumber).trim();
      const accountTransactions = dbData.transactions.filter(t => 
        String(t.from).trim() === targetNum || 
        String(t.to).trim() === targetNum
      ).filter(t => t.amount > 0 && t.from !== 'SYSTEM'); // Filter out system transactions/notifications
      res.json(accountTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    });

  // --- Infrastructure Traffic Controller ---

  let clusterTrafficMultiplier = 0;

  // Real-time Traffic Management
  app.post('/api/admin/simulate-load', authenticateToken, isAdmin, (req: any, res: any) => {
    const { intensity = 0 } = req.body; 
    const prevIntensity = clusterTrafficMultiplier;
    clusterTrafficMultiplier = Math.max(0, Math.min(25, Number(intensity)));
    
    // Reset queue if stopping
    if (clusterTrafficMultiplier === 0) {
      console.log('[SIMULATOR] ALL STRESS TESTS HALTED BY ADMIN');
      kafkaQueue.length = 0;
      kafkaQueueGauge.set(0);
      isProcessingKafka = false; 
      if (kafkaTimeout) {
        clearTimeout(kafkaTimeout);
        kafkaTimeout = null;
      }
      pushAudit('SIMULATION_HALTED', (req.user as any)?.uid || 'admin', { reason: 'manual_emergency_stop' });
    }

    // UPDATE CLUSTER SCALING STATE REGARDLESS OF DIRECTION
    if (clusterTrafficMultiplier >= 20) { 
      serviceStatus.instances = 10;
    } else if (clusterTrafficMultiplier >= 10) { 
      serviceStatus.instances = 5;
    } else if (clusterTrafficMultiplier >= 5) { 
      serviceStatus.instances = 2;
    } else if (clusterTrafficMultiplier > 0) {
      serviceStatus.instances = 2; // Baseline for any active traffic
    } else {
      serviceStatus.instances = 1; // Default idle state
    }

    // AUDIT LOGGING FOR SCALING DIRECTION
    if (clusterTrafficMultiplier > prevIntensity) {
      console.log(`[SIMULATOR] Scaling UP: traffic multiplier set to ${clusterTrafficMultiplier}`);
      pushAudit('DOCKER_AUTO_SCALE_UP', (req.user as any)?.uid || 'admin', { 
        intensity: clusterTrafficMultiplier, 
        action: 'DEPLOY_NEW_CONTAINERS',
        nodeCount: serviceStatus.instances
      });
    } else if (clusterTrafficMultiplier < prevIntensity && clusterTrafficMultiplier > 0) {
      console.log(`[SIMULATOR] Scaling DOWN: traffic multiplier set to ${clusterTrafficMultiplier}`);
      pushAudit('DOCKER_AUTO_SCALE_DOWN', (req.user as any)?.uid || 'admin', { 
        intensity: clusterTrafficMultiplier, 
        action: 'TERMINATE_IDLE_CONTAINERS',
        nodeCount: serviceStatus.instances
      });
    }

    res.json({ 
      message: clusterTrafficMultiplier === 0 ? 'Simulation stopped' : 'Cluster traffic updated', 
      intensity: clusterTrafficMultiplier, 
      instances: serviceStatus.instances 
    });
  });

  // Background Traffic Generator (More frequent bursts for Stress Test visibility)
  setInterval(() => {
    if (clusterTrafficMultiplier > 0) {
      // Scale frequency with intensity - MORE AGGRESSIVE FOR STRESS TESTS
      // More items per burst to ensure queue depth is visible
      const burstSize = Math.max(5, Math.floor(clusterTrafficMultiplier * 1.5));
      const chance = Math.min(0.99, (clusterTrafficMultiplier / 5)); 
      
      if (Math.random() < chance) {
        for (let i = 0; i < burstSize; i++) {
          const types = ['TRANSFER', 'PAYMENT', 'WITHDRAWAL', 'DEPOSIT'];
          const type = types[Math.floor(Math.random() * types.length)];
          const dummyTx = {
            id: `TX-GEN-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
            from: `ACC-${Math.floor(Math.random() * 900000 + 100000)}`,
            to: `ACC-${Math.floor(Math.random() * 900000 + 100000)}`,
            amount: Math.floor(Math.random() * 5000) + 1,
            timestamp: getISTTime(),
            status: 'completed',
            type,
            metadata: { realTime: true, loadIndex: clusterTrafficMultiplier }
          };
          
          dbData.transactions.unshift(dummyTx);
          if (dbData.transactions.length > 2000) dbData.transactions.pop();
          
          kafkaBus.emit('transaction_completed', dummyTx);
        }
        
        // Only save every few ticks to prevent IDE "Failed to download" errors during stress tests
        const now = Date.now();
        if (!global.lastGeneratorSave || (now - global.lastGeneratorSave > 5000)) {
          saveDb();
          global.lastGeneratorSave = now;
        }
      }
    }
  }, 1000); 

  // 2. Transaction Service (Sync Logic)
  // INTEGRATION POINT: This would be a separate Spring Boot Microservice.
  // Communication between Gateway and this service would typically use REST (RestTemplate/WebClient) or gRPC.
  async function transactionService(payload: any) {
    const { from, to, amount: rawAmount, initiatorUid } = payload;
    const amount = Number(rawAmount);
    console.log(`[Transaction Service] Processing: ${amount} from ${from} to ${to} (UID: ${initiatorUid})`);
    
    // Security Check: Initiator account balance & status
    // Use dbData.accounts to ensure freshest data
    const sender = dbData.accounts.find(a => String(a.id).trim() === String(from).trim() || String(a.accountNumber).trim() === String(from).trim());
    if (!sender) throw new Error('Source account not found.');
    
    if (sender.status === 'locked' || sender.status === 'frozen' || sender.status === 'dormant' || sender.status !== 'active') {
      console.warn(`[TRANSFER] Denied: Source account ${from} is ${sender.status}`);
      throw new Error('Access to the banking operation was denied. This usually happens if your account is frozen or locked for security reasons.');
    }

    // Find recipient account (by account number or ID)
    const targetAccountNum = String(to).trim();
    const recipientAccount = dbData.accounts.find(a => 
      String(a.accountNumber).trim() === targetAccountNum || 
      String(a.id).trim() === targetAccountNum
    );
    
    if (!recipientAccount) {
      console.warn(`[TRANSACTION ERROR] Recipient Not Found. Input: '${to}'. All Account Numbers: ${dbData.accounts.map(a => a.accountNumber).join(', ')}`);
      
      // Helpful "Did you mean?" logic
      const suggestions = dbData.accounts
        .filter(a => a.accountNumber.startsWith(targetAccountNum) || targetAccountNum.startsWith(a.accountNumber))
        .map(a => a.accountNumber);
      
      let errorMsg = `Recipient account ${targetAccountNum} not found in our banking ledger.`;
      if (suggestions.length > 0) {
        errorMsg += ` Did you mean ${suggestions.join(' or ')}?`;
      } else if (targetAccountNum.length < 10) {
        errorMsg += ` Standard account numbers are 10 digits long.`;
      }
      
      throw new Error(errorMsg);
    }

    // Security Check: Recipient account status
    if (['locked', 'frozen', 'dormant', 'closed', 'permanently_closed', 'deleted_final'].includes((recipientAccount.status || '').toLowerCase())) {
      console.warn(`[TRANSFER] Denied: Recipient account is ${recipientAccount.status}. To: ${to}`);
      throw new Error('Access to the banking operation was denied. This usually happens if your account is frozen or locked for security reasons.');
    }
    
    if (recipientAccount.status !== 'active') {
      console.warn(`[TRANSFER] Recipient account restricted: ${to} is ${recipientAccount.status}`);
      throw new Error(`Transfer failed: Recipient account is currently ${recipientAccount.status}.`);
    }

    if (recipientAccount.id === sender.id) {
      throw new Error('Self-transfers to the same account are not permitted.');
    }

    // Simulate OpenFeign call to Account Service (Check Balance & Deduct)
    const accountResponse = await accountService(from, amount);
    
    if (accountResponse.status === 'success') {
      const recipient = dbData.accounts.find(a => String(a.accountNumber).trim() === targetAccountNum || a.id === targetAccountNum);
      
      // Simulate calling Account Service for recipient credit
      await accountService(to, amount, true);
      
      const tx = {
        id: `TX-${Math.random().toString(36).substr(2, 9)}`,
        from: sender.accountNumber,
        to: recipient ? recipient.accountNumber : to,
        amount, 
        initiatorUid,
        timestamp: getISTTime(),
        status: 'completed',
        type: (recipient && sender.ownerUid === recipient.ownerUid) ? 'internal' : (recipient ? 'transfer' : 'external')
      };
      
      console.log(`[Transaction Service] Transaction created: ${tx.id} (${tx.type}) from ${tx.from} to ${tx.to}`);
      dbData.transactions.unshift(tx);
      if (dbData.transactions.length > 5000) dbData.transactions.pop();
      saveDb();

      // Dispatch event to Kafka Cluster pipeline
      console.log(`[KAFKA] Producing message to topic 'transaction-events': ${tx.id}`);
      kafkaBus.emit('transaction_completed', tx);
      
    // Real-time audit push
    // pushAudit('TRANSFER_COMPLETED', initiatorUid, { ...tx, type: 'transfer' }); // Removed redundancy as Kafka consumer does this
      
      return {
        status: 'completed',
        transactionId: tx.id,
        message: 'Transaction successfully processed'
      };
    } else {
      throw new Error(accountResponse.message);
    }
  }

  // 3. Account Service (Sync Logic)
  // INTEGRATION POINT: This would be another Spring Boot Microservice managing the database (e.g., PostgreSQL/MySQL via JPA).
  async function accountService(identifier: string, amount: number, isRecipient: boolean = false) {
    console.log(`[Account Service] Checking balance and status for ${identifier} (isRecipient: ${isRecipient})`);
    const account = dbData.accounts.find(a => String(a.id).trim() === String(identifier).trim() || String(a.accountNumber).trim() === String(identifier).trim());
    
    if (!account) return { status: 'error', message: `Account ${identifier} not found in database` };
    
    if (account.status === 'locked' || account.status === 'dormant' || account.status === 'closed') {
      return { status: 'error', message: `The account is currently ${account.status}. This status prevents any banking operations until resolved.` };
    }
    
    // Allow credit to frozen accounts, but block debit from them
    if (account.status === 'frozen' && !isRecipient) {
      return { status: 'error', message: 'The account is frozen. Debit operations and transfers from frozen accounts are restricted for security.' };
    }
    
    if (account.status !== 'active') {
      return { status: 'error', message: `${isRecipient ? 'Recipient' : 'Source'} account is currently ${account.status}.` };
    }

    if (isRecipient) {
      account.balance = Number((Number(account.balance) + Number(amount)).toFixed(2));
      saveDb();
      console.log(`[Account Service] Credited ${amount} to ${account.accountNumber}. New balance: ${account.balance}`);
      return { status: 'success', balance: account.balance };
    }

    const currentBalance = Number(account.balance);
    if (currentBalance >= amount) {
      account.balance = Number((currentBalance - Number(amount)).toFixed(2));
      saveDb();
      console.log(`[Account Service] Debited ${amount} from ${account.accountNumber}. New balance: ${account.balance}`);
      return { status: 'success', message: 'Funds available and reserved' };
    }
    
    return { status: 'error', message: 'Insufficient funds' };
  }

// Kafka Distributed Queue Logic
  const kafkaQueue: any[] = [];
  const kafkaEvents: any[] = [];
  let isProcessingKafka = false;
  let kafkaTimeout: NodeJS.Timeout | null = null;

  async function processKafkaQueue() {
    // If stopping, ensure we don't plan next run
    if (clusterTrafficMultiplier === 0) {
      isProcessingKafka = false;
      if (kafkaTimeout) {
        clearTimeout(kafkaTimeout);
        kafkaTimeout = null;
      }
      return;
    }
    
    // CRITICAL PERFORMANCE OPTIMIZATION: If we are proxying, 
    // we still keep the queue for UI visualization, but we don't process it
    // for LIVE production messages because the microservices do that.
    
    if (isProcessingKafka || kafkaQueue.length === 0) return;
    
    // BATCH PROCESSING: Handle messages per cycle to stay responsive but save CPU
    // We adjust batch size and delay based on clusterTrafficMultiplier to simulate load
    // Slow down processing significantly under heavy load to let the queue build up visually
    const loadAdjustment = Math.max(1, Math.floor(clusterTrafficMultiplier / 4));
    // If intensity is very high, process even fewer items per batch to show queue buildup
    const maxBatchSize = clusterTrafficMultiplier > 18 ? 1 : (clusterTrafficMultiplier > 10 ? 2 : Math.max(1, 4 - Math.floor(loadAdjustment / 2)));
    const delay = clusterTrafficMultiplier > 10 
      ? 15000 + (clusterTrafficMultiplier * 1000) // Drastic slow down for visibility: 15s - 40s delay
      : 2000 + (clusterTrafficMultiplier * 500); 
    
    let processedCount = 0;
    isProcessingKafka = true;

    try {
      while (kafkaQueue.length > 0 && processedCount < maxBatchSize) {
        processedCount++;
        const data = kafkaQueue.shift();
        if (!data) continue;
        
        // Update Gauge immediately
        kafkaQueueGauge.set(kafkaQueue.length);

        const isSynthetic = data.id.startsWith('TX-GEN') || data.metadata?.realTime || data.metadata?.source === 'PROXIED_MICROSERVICE';
        
        // If proxying is on, only process locally if it's a synthetic or proxied event.
        if (useProxy && !isSynthetic) {
          continue;
        }

        const isAutoMsg = data.id.startsWith('TX-GEN') || data.metadata?.realTime;
        const isProxied = data.metadata?.source === 'PROXIED_MICROSERVICE';
        
        if (processedCount === 1) {
          console.log(`[Kafka] Processing batch (Queue: ${kafkaQueue.length}, Delay: ${delay}ms)...`);
        }
        
        // Process notification cycle
        const senderNum = String(data.from || '').trim();
        const senderAcc = dbData.accounts.find(a => String(a.accountNumber).trim() === senderNum || a.id === senderNum);
        const finalInitiatorUid = data.initiatorUid || (senderAcc ? senderAcc.ownerUid : null);

        if (finalInitiatorUid && finalInitiatorUid !== 'system' && finalInitiatorUid !== 'N/A') {
          sendEmail(
            finalInitiatorUid,
            'Transfer Successful',
            `Your transfer of $${data.amount} to account ${data.to} was successful.`
          );
        }

        const destNum = String(data.to || '').trim();
        const destAcc = dbData.accounts.find(a => String(a.accountNumber).trim() === destNum || a.id === destNum);
        if (destAcc) {
          sendEmail(
            destAcc.ownerUid,
            'Funds Received',
            `You have received $${data.amount} from ${data.from}.`
          );
        }

        // Audit Service persistence
        const eventType = isAutoMsg ? 'SIMULATED_TRAFFIC' : 'TRANSFER_COMPLETED';
        const auditMetadata = { ...data, auditStatus: 'PROCESSED_VIA_KAFKA' };
        
        // Call global pushAudit to ensure it goes to both local and microservice
        pushAudit(eventType, finalInitiatorUid || 'system', auditMetadata);
        
        // Only save DB every few processed items to reduce disk I/O load
        if (processedCount % 10 === 0) saveDb();
      }
      
      saveDb(); // Final save
    } catch (err) {
      console.error('[KAFKA ERROR] batch failed:', err);
    } finally {
      // Continue processing if there are more items, with current load-based delay
      kafkaQueueGauge.set(kafkaQueue.length);
      
      if (kafkaTimeout) {
        clearTimeout(kafkaTimeout);
        kafkaTimeout = null;
      }

      if (kafkaQueue.length > 0 && clusterTrafficMultiplier > 0) {
        kafkaTimeout = setTimeout(() => {
          isProcessingKafka = false;
          processKafkaQueue();
        }, delay);
      } else {
        isProcessingKafka = false;
      }
    }
  }

  kafkaBus.on('transaction_completed', (data) => {
    // Collect for UI visualization (Kafka Visualizer component)
    kafkaEvents.unshift({ ...data, ts: Date.now() });
    if (kafkaEvents.length > 50) kafkaEvents.pop();

    // Add to processing queue
    kafkaQueue.push(data);
    kafkaQueueGauge.set(kafkaQueue.length);
    
    // Safety limit to prevent memory exhaustion in case of infinite loops
    if (kafkaQueue.length > 10000) kafkaQueue.shift();

    // Trigger local processing if traffic index or if it's a proxied event that needs visibility
    const isSynthetic = data && (data.id.startsWith('TX-GEN') || data.metadata?.realTime);
    const isProxied = data && data.metadata?.source === 'PROXIED_MICROSERVICE';
    
    // DECOUPLED DELAY TRIGGERING:
    // This allows the queue size to build up realistically and be processed in matching batches/delays
    // instead of being instant and showing 0 at all times.
    if (!useProxy || isSynthetic || isProxied) {
      if (clusterTrafficMultiplier > 0) {
        if (!isProcessingKafka && !(global as any).kafkaTriggerTimeout) {
          // Add a build delay depending on stress level to allow visible accumulation
          const buildDelay = clusterTrafficMultiplier >= 20 ? 8000 : (clusterTrafficMultiplier >= 10 ? 4000 : 2000);
          (global as any).kafkaTriggerTimeout = setTimeout(() => {
            processKafkaQueue();
            (global as any).kafkaTriggerTimeout = null;
          }, buildDelay);
        }
      } else {
        // Individual manual transactions: process quickly with setImmediate to keep UI snappy
        if (!isProcessingKafka) {
          setImmediate(() => {
            processKafkaQueue();
          });
        }
      }
    }
  });

  // --- System Observability Metrics ---
  let lastThroughputCount = 0;
  let currentThroughput = 0;
  setInterval(() => {
    const total = dbData.transactions.length;
    currentThroughput = (total - lastThroughputCount);
    if (currentThroughput < 0) currentThroughput = 0;
    lastThroughputCount = total;
  }, 2000);

  app.get('/api/admin/metrics', authenticateToken, isAdmin, async (req, res) => {
    const mem = process.memoryUsage();
    
    // Calculate CPU usage for enterprise cluster reporting (4-core baseline)
    const loadFactor = clusterTrafficMultiplier;
    const baseCpu = 5 + (Math.random() * 5);
    const clusterCpu = (loadFactor || 0) * 5.5; 
    const totalCpu = Math.min(100, baseCpu + clusterCpu);

    res.json({
      cpu: Number(totalCpu.toFixed(1)),
      memory: {
        used: Math.round(mem.heapUsed / 1024 / 1024) + ((loadFactor || 0) * 50),
        total: 16384, 
        environment: '4 Core / 16 GB Enterprise Cloud Baseline', 
        percentage: Math.min(100, Math.round(((mem.heapUsed / 1024 / 1024 + (loadFactor || 0) * 50) / 16384) * 100))
      },
      requests: Math.floor(currentThroughput * 2.5) + Math.floor(Math.random() * 5),
      kafka: {
        queueSize: kafkaQueue.length,
        status: isProcessingKafka ? 'active' : (kafkaQueue.length > 50 ? 'congested' : 'stable'),
        intensity: loadFactor
      },
      serviceHealth: {
        ...serviceStatus,
        cores: 4, 
        targetMemory: '16GB',
        activeContainers: [...Array(Math.max(1, (loadFactor > 0 ? serviceStatus.instances : 1)))].map((_, i) => {
          return `docker_node_0${i+1}_${Math.random().toString(36).substring(2, 5)}`;
        })
      },
      timestamp: getISTTime()
    });
  });

  app.get('/api/admin/transactions', authenticateToken, isAdmin, async (req: any, res: any) => {
    let microserviceTransactions: any[] = [];
    
    if (useProxy && serviceStatus.transaction) {
      try {
        const response = await fetch(`${TRANSACTION_SERVICE}/api/transactions`, {
          headers: {
            'X-User-Role': 'admin',
            'X-User-UID': req.user.uid
          }
        });
        if (response.ok) {
          microserviceTransactions = await response.json();
        }
      } catch (err) {
        console.warn(`[ADMIN] Could not fetch live transactions: ${anyErr(err)}`);
      }
    }
    
    // Combine microservice data with local synthetic/cached transactions
    const combined = [...microserviceTransactions];
    
    // Add local transactions that aren't already in the list, excluding status/notif entries (0-amount or system sources)
    const existingIds = new Set(combined.map((t: any) => t.id));
    for (const tx of dbData.transactions) {
      if (!existingIds.has(tx.id) && tx.amount > 0 && tx.from !== 'SYSTEM') {
        combined.push(tx);
      }
    }
    
    // Return latest 100 transactions sorted by timestamp
    const result = combined
      .filter((t: any) => t.amount > 0 && t.from !== 'SYSTEM')
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100);
    
    console.log(`[ADMIN] Returning ${result.length} transactions (${microserviceTransactions.length} from service, ${dbData.transactions.length} from local)`);
    res.json(result);
  });

  // Catch-all for any other API routes to prevent HTML fallback for API calls
  app.all('/api/*', (req, res) => {
    console.warn(`[API 404] Unmatched route: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      error: 'API Endpoint Not Found',
      message: `The API route ${req.originalUrl} does not exist.`
    });
  });

  // Final SPA Error Fallback & Vite
  app.use((err: any, req: any, res: any, next: any) => {
    console.error(`[SYSTEM ERROR] ${err.stack}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: err.message
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Banking Microservices System running on http://localhost:${PORT}`);
    
    // Heartbeat and Cleanup (Reduced interval and tighter limits to prevent db.json bloat)
    setInterval(() => {
      let changed = false;
      if (dbData.auditLogs.length > 200) {
        dbData.auditLogs = dbData.auditLogs.slice(0, 50);
        changed = true;
      }
      
      if (dbData.transactions.length > 300) {
        dbData.transactions = dbData.transactions.slice(0, 50);
        changed = true;
      }

      if (changed) saveDb();
      
      // Only push heartbeat if we're not under heavy load to save CPU/Disk
      if (clusterTrafficMultiplier < 5) {
        const heartbeat = {
          id: `LOG-HB-${Math.random().toString(36).substr(2, 6)}`,
          event: 'CLUSTER_PULSE',
          timestamp: getISTTime(),
          userId: 'system',
          metadata: { status: 'idle', drift: '0ms' }
        };
        dbData.auditLogs.unshift(heartbeat);
      }
    }, 20000); // 20 seconds cleanup interval

    // Defer syncing users until microservices have had a chance to start (approx 45s for slow disks)
    if (useProxy) {
      console.log('[GATEWAY] Deferring user sync for 60s to allow microservices to warm up...');
      setTimeout(syncUsersToMicroservices, 60000);
    }
  });

  // Graceful Shutdown
  process.on('SIGTERM', () => {
    console.log('[GATEWAY] SIGTERM received. Closing server...');
    saveDb();
    server.close(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    console.log('[GATEWAY] SIGINT received. Closing server...');
    saveDb();
    server.close(() => process.exit(0));
  });
}

startServer();
