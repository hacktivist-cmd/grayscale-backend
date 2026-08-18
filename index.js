import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDB, ensureTables } from './database.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_grayscale_key_2026';

app.use(cors());
app.use(express.json());

let db;

// Mock prices for conversion (same as dashboard)
const DEFAULT_PRICES = { BTC: 63120.50, ETH: 1895.20, SOL: 142.80, USDT: 1.00 };

initDB().then(async (database) => {
  db = database;
  await ensureTables(db);
  
  console.log('Checking for admin user...');
  const admin = await db.get("SELECT id, email, password_hash FROM users WHERE email = ?", ['gs@ingray.com']);
  if (!admin) {
    console.log('Admin not found. Creating...');
    const hash = await bcrypt.hash('gtrade', 10);
    await db.run("INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 500000.00, 'Verified', 'Active']);
    console.log('✅ Admin user created: gs@ingray.com / gtrade');
  } else {
    console.log('✅ Admin user already exists.');
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} with SQLite`);
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});

// --- AUTH ROUTES ---
app.post('/api/auth/signup', async (req, res) => {
  const { firstName, lastName, email, password, phone, country, accreditedInvestor, investmentSize } = req.body;
  console.log('Signup attempt:', { firstName, lastName, email, phone, country, accreditedInvestor, investmentSize });
  try {
    const existingUser = await db.get("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser) {
      console.log('Email already registered:', email);
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status, phone, country, accredited_investor, investment_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, email, hash, 'user', 0.00, 'Pending', 'Active', phone || null, country || null, accreditedInvestor || null, investmentSize || null]
    );
    
    const userId = result.lastID;
    // Create default assets entries for the user
    const assets = ['BTC', 'ETH', 'SOL', 'USDT'];
    for (const symbol of assets) {
      await db.run("INSERT INTO assets (user_id, symbol, holdings) VALUES (?, ?, ?)", [userId, symbol, 0.00]);
    }

    const user = await db.get("SELECT id, email, role, first_name, last_name FROM users WHERE id = ?", [userId]);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed: ' + error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Login attempt for: ${email}`);
  try {
    const user = await db.get("SELECT id, email, password_hash, role, first_name, last_name FROM users WHERE email = ?", [email]);
    if (!user) {
      console.log(`User not found: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      console.log(`Invalid password for ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, firstName: user.first_name, lastName: user.last_name } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT id, email, role, first_name, last_name FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- PASSWORD & DELETE ACCOUNT (Self) ---
app.post('/api/auth/change-password', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { currentPassword, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT id, password_hash FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, decoded.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

app.delete('/api/auth/delete-account', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { password } = req.body;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT id, password_hash FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Password is incorrect' });

    await db.run("DELETE FROM assets WHERE user_id = ?", [decoded.id]);
    await db.run("DELETE FROM transactions WHERE user_id = ?", [decoded.id]);
    await db.run("DELETE FROM investments WHERE user_id = ?", [decoded.id]);
    await db.run("DELETE FROM withdrawals WHERE user_id = ?", [decoded.id]);
    await db.run("DELETE FROM deposits WHERE user_id = ?", [decoded.id]);
    await db.run("DELETE FROM users WHERE id = ?", [decoded.id]);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// --- USER DASHBOARD ROUTES ---
app.get('/api/assets', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const assets = await db.all("SELECT symbol, holdings FROM assets WHERE user_id = ?", [decoded.id]);
    const user = await db.get("SELECT balance_usd FROM users WHERE id = ?", [decoded.id]);
    res.json({ assets, cashBalance: user?.balance_usd || 0 });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/transactions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const transactions = await db.all("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC LIMIT 10", [decoded.id]);
    res.json({ transactions });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- INVESTMENT ROUTES ---
app.get('/api/investments', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const investments = await db.all("SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC", [decoded.id]);
    res.json({ investments });
  } catch (error) {
    console.error('GET /api/investments error:', error);
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

app.post('/api/investments/start', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { asset, amount } = req.body;

  if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid investment parameters' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT balance_usd FROM users WHERE id = ?", [decoded.id]);
    if (!user || user.balance_usd < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run("UPDATE users SET balance_usd = balance_usd - ? WHERE id = ?", [amount, decoded.id]);

    const profitAmount = amount * 0.30;
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.run(
      `INSERT INTO investments (user_id, asset, amount_invested, profit_amount, start_date, end_date, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, asset, amount, profitAmount, startDate, endDate, 'active']
    );

    await db.run(
      `INSERT INTO transactions (user_id, type, asset, amount, usd_value, date, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, 'Investment', asset, `-$${amount.toFixed(2)}`, `$${amount.toFixed(2)}`, new Date().toLocaleDateString(), 'Completed']
    );

    res.json({ success: true, investmentId: result.lastID, message: `Investment in ${asset} started. +30% profit in 7 days!` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to start investment: ' + error.message });
  }
});

app.post('/api/investments/withdraw', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { investmentId } = req.body;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const investment = await db.get("SELECT * FROM investments WHERE id = ? AND user_id = ?", [investmentId, decoded.id]);
    if (!investment) return res.status(404).json({ error: 'Investment not found' });
    if (investment.status !== 'active') return res.status(400).json({ error: 'Investment already completed or withdrawn' });

    const now = new Date();
    const endDate = new Date(investment.end_date);
    if (now < endDate) {
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      return res.status(400).json({ error: `Investment is locked for ${daysLeft} more day(s)` });
    }

    const totalPayout = investment.amount_invested + investment.profit_amount;
    await db.run("UPDATE users SET balance_usd = balance_usd + ? WHERE id = ?", [totalPayout, decoded.id]);
    await db.run("UPDATE investments SET status = 'completed' WHERE id = ?", [investmentId]);

    await db.run(
      `INSERT INTO transactions (user_id, type, asset, amount, usd_value, date, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, 'Investment Return', investment.asset, `+$${totalPayout.toFixed(2)}`, `$${totalPayout.toFixed(2)}`, new Date().toLocaleDateString(), 'Completed']
    );

    res.json({ success: true, message: `Withdrawn $${totalPayout.toFixed(2)}! (Initial: $${investment.amount_invested} + Profit: $${investment.profit_amount})` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to withdraw investment' });
  }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const users = await db.all("SELECT id, first_name, last_name, email, balance_usd, kyc_status, status, phone, country, accredited_investor, investment_size FROM users");
    res.json({ users });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.put('/api/admin/users/:userId/balance', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { userId } = req.params;
  const { balance } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    await db.run("UPDATE users SET balance_usd = ? WHERE id = ?", [balance, userId]);
    res.json({ success: true, message: 'Balance updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

app.put('/api/admin/users/:userId/status', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { userId } = req.params;
  const { status } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    await db.run("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
    res.json({ success: true, message: `User status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

app.delete('/api/admin/users/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { userId } = req.params;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    await db.run("DELETE FROM assets WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM transactions WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM investments WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM withdrawals WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM deposits WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM users WHERE id = ?", [userId]);
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const withdrawals = await db.all("SELECT * FROM withdrawals ORDER BY date DESC");
    console.log(`Admin fetched ${withdrawals.length} withdrawals`);
    res.json({ withdrawals });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.put('/api/admin/withdrawals/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { id } = req.params;
  const { status } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    // If approved, do nothing (amount already deducted on request)
    // If rejected, refund the amount back to user
    if (status === 'Rejected') {
      const withdrawal = await db.get("SELECT user_id, amount FROM withdrawals WHERE id = ?", [id]);
      if (withdrawal) {
        const amount = parseFloat(withdrawal.amount.replace(/[^0-9.-]/g, '')) || 0;
        await db.run("UPDATE users SET balance_usd = balance_usd + ? WHERE id = ?", [amount, withdrawal.user_id]);
      }
    }
    await db.run("UPDATE withdrawals SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: `Withdrawal ${id} ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

app.get('/api/admin/deposits', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const deposits = await db.all("SELECT * FROM deposits ORDER BY date DESC");
    console.log(`Admin fetched ${deposits.length} deposits`);
    res.json({ deposits });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.put('/api/admin/deposits/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { id } = req.params;
  const { status } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    
    // Fetch deposit details
    const deposit = await db.get("SELECT user_id, amount, asset FROM deposits WHERE id = ?", [id]);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });

    if (status === 'Approved') {
      // Convert USD amount to crypto based on current price
      const price = DEFAULT_PRICES[deposit.asset] || 1; // fallback to 1 for USDT
      const cryptoAmount = parseFloat(deposit.amount) / price;
      
      // Update user's asset holdings (add to the specific coin)
      await db.run(
        "UPDATE assets SET holdings = holdings + ? WHERE user_id = ? AND symbol = ?",
        [cryptoAmount, deposit.user_id, deposit.asset]
      );
      console.log(`✅ Deposit approved: ${deposit.amount} USD -> ${cryptoAmount} ${deposit.asset} for user ${deposit.user_id}`);
    }
    // If rejected, no action needed

    await db.run("UPDATE deposits SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: `Deposit ${id} ${status}` });
  } catch (error) {
    console.error('Deposit approval error:', error);
    res.status(500).json({ error: 'Failed to update deposit' });
  }
});

app.get('/api/admin/transactions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const transactions = await db.all("SELECT * FROM transactions ORDER BY date DESC");
    res.json({ transactions });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- NEW: Admin investments route ---
app.get('/api/admin/investments', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const investments = await db.all("SELECT * FROM investments ORDER BY id DESC");
    res.json({ investments });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- NEW: User deposit request endpoint ---
app.post('/api/deposits', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT first_name, last_name FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, asset } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const id = 'DEP-' + Date.now();
    const now = new Date();
    const date = now.toLocaleDateString();
    const time = now.toLocaleTimeString();
    const userName = `${user.first_name} ${user.last_name}`.trim() || 'User';
    await db.run(
      "INSERT INTO deposits (id, user_id, user_name, amount, asset, date, time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, decoded.id, userName, amount, asset, date, time, 'Pending']
    );
    console.log(`✅ Deposit inserted: ${id} for ${userName}, ${amount} USD ${asset}`);
    res.json({ success: true, depositId: id, message: 'Deposit request submitted for admin approval.' });
  } catch (error) {
    console.error('Deposit creation error:', error);
    res.status(500).json({ error: 'Failed to submit deposit request' });
  }
});

// --- NEW: User withdrawal request endpoint (immediately deducts from cash balance) ---
app.post('/api/withdrawals', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT first_name, last_name, balance_usd FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, asset, address } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (amount > user.balance_usd) return res.status(400).json({ error: 'Insufficient balance' });
    
    // Deduct immediately from cash balance
    await db.run("UPDATE users SET balance_usd = balance_usd - ? WHERE id = ?", [amount, decoded.id]);
    
    // Create withdrawal request
    const id = 'WTH-' + Date.now();
    const now = new Date();
    const date = now.toLocaleDateString();
    const time = now.toLocaleTimeString();
    const userName = `${user.first_name} ${user.last_name}`.trim() || 'User';
    await db.run(
      "INSERT INTO withdrawals (id, user_id, user_name, amount, asset, date, time, status, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, decoded.id, userName, amount, asset, date, time, 'Pending', address || null]
    );
    console.log(`✅ Withdrawal inserted and cash deducted: ${id} for ${userName}, ${amount} USD ${asset}`);
    res.json({ success: true, withdrawalId: id, message: 'Withdrawal request submitted and funds locked for admin approval.' });
  } catch (error) {
    console.error('Withdrawal creation error:', error);
    res.status(500).json({ error: 'Failed to submit withdrawal request' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'Backend running with SQLite 🚀' }));
