import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { initDB, ensureTables, getDb } from './database.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
console.log(`JWT_SECRET: ${JWT_SECRET.substring(0, 8)}...`);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let db;

initDB().then(async (client) => {
  db = client;
  await ensureTables(db);
  console.log('✅ Database initialized');
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Database init error:', err);
  process.exit(1);
});

// Helper functions for Turso
const getRow = async (sql, params) => {
  const result = await db.execute(sql, params);
  return result.rows[0];
};

const allRows = async (sql, params) => {
  const result = await db.execute(sql, params);
  return result.rows;
};

const run = async (sql, params) => {
  return await db.execute(sql, params);
};

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// --- AUTH ROUTES ---
app.post('/api/auth/signup', async (req, res) => {
  const { firstName, lastName, email, password, phone, country, accreditedInvestor, investmentSize } = req.body;
  try {
    const existingUser = await getRow("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });
    
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status, phone, country, accredited_investor, investment_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, email, hash, 'user', 0.00, 'Pending', 'Active', phone || null, country || null, accreditedInvestor || null, investmentSize || null]
    );
    const userId = result.lastInsertRowid;
    // Create default assets
    const assets = ['BTC', 'ETH', 'SOL', 'USDT'];
    for (const symbol of assets) {
      await run("INSERT INTO assets (user_id, symbol, holdings) VALUES (?, ?, ?)", [userId, symbol, 0.00]);
    }
    const user = await getRow("SELECT id, email, role, first_name, last_name, avatar FROM users WHERE id = ?", [userId]);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await getRow("SELECT id, email, password_hash, role, first_name, last_name, avatar FROM users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, firstName: user.first_name, lastName: user.last_name, avatar: user.avatar } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getRow("SELECT id, email, role, first_name, last_name, avatar FROM users WHERE id = ?", [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- USER PROFILE UPDATE ---
app.put('/api/user/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { firstName, lastName, avatar } = req.body;
    const existing = await getRow("SELECT * FROM users WHERE id = ?", [decoded.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const newFirstName = firstName ?? existing.first_name;
    const newLastName = lastName ?? existing.last_name;
    const newAvatar = avatar ?? existing.avatar;
    await run("UPDATE users SET first_name = ?, last_name = ?, avatar = ? WHERE id = ?", [newFirstName, newLastName, newAvatar, decoded.id]);
    const user = await getRow("SELECT id, email, role, first_name, last_name, avatar FROM users WHERE id = ?", [decoded.id]);
    res.json({ success: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- ASSETS, TRANSACTIONS, INVESTMENTS (user) ---
app.get('/api/assets', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const assets = await allRows("SELECT symbol, holdings FROM assets WHERE user_id = ?", [decoded.id]);
    const user = await getRow("SELECT balance_usd FROM users WHERE id = ?", [decoded.id]);
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
    const transactions = await allRows("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC LIMIT 10", [decoded.id]);
    res.json({ transactions });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/investments', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const investments = await allRows("SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC", [decoded.id]);
    res.json({ investments });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/investments/start', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { asset, amount } = req.body;
  if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid investment parameters' });
  if (amount < 500) return res.status(400).json({ error: 'Minimum investment is $500' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getRow("SELECT balance_usd FROM users WHERE id = ?", [decoded.id]);
    if (!user || user.balance_usd < amount) return res.status(400).json({ error: 'Insufficient balance' });
    await run("UPDATE users SET balance_usd = balance_usd - ? WHERE id = ?", [amount, decoded.id]);
    const profitAmount = amount * 0.30;
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    const result = await run(
      `INSERT INTO investments (user_id, asset, amount_invested, profit_amount, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, asset, amount, profitAmount, startDate, endDate, 'active']
    );
    await run(
      `INSERT INTO transactions (user_id, type, asset, amount, usd_value, date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, 'Investment', asset, `-$${amount.toFixed(2)}`, `$${amount.toFixed(2)}`, new Date().toLocaleDateString(), 'Completed']
    );
    res.json({ success: true, investmentId: result.lastInsertRowid, message: `Investment in ${asset} started. +30% profit in 7 days!` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to start investment' });
  }
});

app.post('/api/investments/withdraw', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { investmentId } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const investment = await getRow("SELECT * FROM investments WHERE id = ? AND user_id = ?", [investmentId, decoded.id]);
    if (!investment) return res.status(404).json({ error: 'Investment not found' });
    if (investment.status !== 'active') return res.status(400).json({ error: 'Investment already completed or withdrawn' });
    const now = new Date();
    const endDate = new Date(investment.end_date);
    if (now < endDate) {
      const daysLeft = Math.ceil((endDate - now) / (1000*60*60*24));
      return res.status(400).json({ error: `Investment is locked for ${daysLeft} more day(s)` });
    }
    const totalPayout = investment.amount_invested + investment.profit_amount;
    await run("UPDATE users SET balance_usd = balance_usd + ? WHERE id = ?", [totalPayout, decoded.id]);
    await run("UPDATE investments SET status = 'completed' WHERE id = ?", [investmentId]);
    await run(
      `INSERT INTO transactions (user_id, type, asset, amount, usd_value, date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, 'Investment Return', investment.asset, `+$${totalPayout.toFixed(2)}`, `$${totalPayout.toFixed(2)}`, new Date().toLocaleDateString(), 'Completed']
    );
    res.json({ success: true, message: `Withdrawn $${totalPayout.toFixed(2)}!` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to withdraw investment' });
  }
});

// --- OTC TRADE ---
app.post('/api/trade', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { payAsset, getAsset, payAmount, receiveQty } = req.body;
    if (!payAsset || !getAsset || !payAmount || !receiveQty) return res.status(400).json({ error: 'Invalid trade parameters' });
    await run("UPDATE assets SET holdings = holdings - ? WHERE user_id = ? AND symbol = ?", [payAmount, decoded.id, payAsset]);
    await run("UPDATE assets SET holdings = holdings + ? WHERE user_id = ? AND symbol = ?", [receiveQty, decoded.id, getAsset]);
    await run(
      `INSERT INTO transactions (user_id, type, asset, amount, usd_value, date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [decoded.id, 'OTC Swap', `${payAsset}->${getAsset}`, `-${payAmount} ${payAsset} / +${receiveQty} ${getAsset}`, '0', new Date().toLocaleDateString(), 'Completed']
    );
    res.json({ success: true, message: 'Trade executed and saved.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to execute trade' });
  }
});

// --- ADMIN ROUTES (using verifyAdminToken) ---
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  try {
    const users = await allRows("SELECT id, first_name, last_name, email, balance_usd, kyc_status, status, phone, country, accredited_investor, investment_size, avatar FROM users");
    const usersWithAssets = await Promise.all(users.map(async (u) => {
      const assets = await allRows("SELECT symbol, holdings FROM assets WHERE user_id = ?", [u.id]);
      return { ...u, assets };
    }));
    res.json({ users: usersWithAssets });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.put('/api/admin/users/:userId/balance', verifyAdminToken, async (req, res) => {
  const { userId } = req.params;
  const { balance } = req.body;
  try {
    await run("UPDATE users SET balance_usd = ? WHERE id = ?", [balance, userId]);
    res.json({ success: true, message: 'Wallet balance updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update wallet balance' });
  }
});

app.put('/api/admin/users/:userId/assets', verifyAdminToken, async (req, res) => {
  const { userId } = req.params;
  const { assets } = req.body;
  try {
    for (const asset of assets) {
      await run("UPDATE assets SET holdings = ? WHERE user_id = ? AND symbol = ?", [asset.holdings, userId, asset.symbol]);
    }
    res.json({ success: true, message: 'Portfolio assets updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update portfolio assets' });
  }
});

app.put('/api/admin/users/:userId/status', verifyAdminToken, async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  try {
    await run("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
    res.json({ success: true, message: `User status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

app.delete('/api/admin/users/:userId', verifyAdminToken, async (req, res) => {
  const { userId } = req.params;
  try {
    await run("DELETE FROM assets WHERE user_id = ?", [userId]);
    await run("DELETE FROM transactions WHERE user_id = ?", [userId]);
    await run("DELETE FROM investments WHERE user_id = ?", [userId]);
    await run("DELETE FROM withdrawals WHERE user_id = ?", [userId]);
    await run("DELETE FROM deposits WHERE user_id = ?", [userId]);
    await run("DELETE FROM users WHERE id = ?", [userId]);
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/admin/withdrawals', verifyAdminToken, async (req, res) => {
  try {
    const withdrawals = await allRows("SELECT * FROM withdrawals ORDER BY date DESC");
    res.json({ withdrawals });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

app.put('/api/admin/withdrawals/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    if (status === 'Rejected') {
      const withdrawal = await getRow("SELECT user_id, amount FROM withdrawals WHERE id = ?", [id]);
      if (withdrawal) {
        const amount = parseFloat(withdrawal.amount.replace(/[^0-9.-]/g, '')) || 0;
        await run("UPDATE users SET balance_usd = balance_usd + ? WHERE id = ?", [amount, withdrawal.user_id]);
      }
    }
    await run("UPDATE withdrawals SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: `Withdrawal ${id} ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

app.get('/api/admin/deposits', verifyAdminToken, async (req, res) => {
  try {
    const deposits = await allRows("SELECT * FROM deposits ORDER BY date DESC");
    res.json({ deposits });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deposits' });
  }
});

app.put('/api/admin/deposits/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const deposit = await getRow("SELECT user_id, amount, asset FROM deposits WHERE id = ?", [id]);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    if (status === 'Approved') {
      const price = (deposit.asset === 'BTC' ? 63120.50 : deposit.asset === 'ETH' ? 1895.20 : deposit.asset === 'SOL' ? 142.80 : 1);
      const cryptoAmount = parseFloat(deposit.amount) / price;
      await run("UPDATE assets SET holdings = holdings + ? WHERE user_id = ? AND symbol = ?", [cryptoAmount, deposit.user_id, deposit.asset]);
    }
    await run("UPDATE deposits SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: `Deposit ${id} ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update deposit' });
  }
});

app.get('/api/admin/transactions', verifyAdminToken, async (req, res) => {
  try {
    const transactions = await allRows("SELECT * FROM transactions ORDER BY date DESC");
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.get('/api/admin/investments', verifyAdminToken, async (req, res) => {
  try {
    const investments = await allRows("SELECT * FROM investments ORDER BY id DESC");
    res.json({ investments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

// --- USER DEPOSITS / WITHDRAWALS ---
app.post('/api/deposits', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getRow("SELECT first_name, last_name FROM users WHERE id = ?", [decoded.id]);
    const { amount, asset } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const id = 'DEP-' + Date.now();
    const userName = `${user.first_name} ${user.last_name}`.trim() || 'User';
    await run("INSERT INTO deposits (id, user_id, user_name, amount, asset, date, time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, decoded.id, userName, amount, asset, new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'Pending']);
    res.json({ success: true, depositId: id, message: 'Deposit request submitted.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit deposit request' });
  }
});

app.post('/api/withdrawals', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getRow("SELECT first_name, last_name, balance_usd FROM users WHERE id = ?", [decoded.id]);
    const { amount, asset, address } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (amount > user.balance_usd) return res.status(400).json({ error: 'Insufficient balance' });
    await run("UPDATE users SET balance_usd = balance_usd - ? WHERE id = ?", [amount, decoded.id]);
    const id = 'WTH-' + Date.now();
    const userName = `${user.first_name} ${user.last_name}`.trim() || 'User';
    await run("INSERT INTO withdrawals (id, user_id, user_name, amount, asset, date, time, status, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, decoded.id, userName, amount, asset, new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'Pending', address || null]);
    res.json({ success: true, withdrawalId: id, message: 'Withdrawal request submitted.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit withdrawal request' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'Backend running with Turso 🚀' }));

// Catch-all
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

export default app;
