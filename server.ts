import express from 'express'; // 导入 express 模块，这是 Node.js 中最基础、最流行的 Web 服务器开发框架，用于处理 HTTP 网页请求
import { createServer as createViteServer } from 'vite'; // 导入 Vite 提供的开发服务器创建工具，使得我们在开发时能享受到极速的代码热更新（实时预览）
import path from 'path'; // 导入 Node.js 原生的 path 模块，用于处理 and 转换文件路径，解决 Windows 或 Linux 系统下路径不一致的问题
import axios from 'axios'; // 导入 axios 库，这是一款优秀的基于 Promise 的 HTTP 客户端，我们用它在服务器端向高德地图 API 发起数据请求
import cors from 'cors'; // 导入 cors 中间件，它的作用是打破浏览器的“同源策略”限制，允许前端网页跨域调用后端的 API 接口
import * as dotenv from 'dotenv'; // 导入 dotenv 工具，它可以将 .env 文件中的配置项自动加载到系统的环境变量中，方便安全地读取 API Key
import fs from 'fs';
import crypto from 'crypto';

dotenv.config(); // 立即执行配置加载，确保代码在后续运行时能通过 process.env 获取到 API Key 等敏感信息

// ---【全局状态与本地数据库配置】---
const demoUsageMap = new Map<string, number>();
const MAX_DEMO_USAGE = 5;

// D1 仿真数据库本地磁盘备份路径
const D1_STORAGE_FILE = path.join(process.cwd(), '.data', 'd1_storage.json');
const JWT_SECRET = process.env.JWT_SECRET || 'fire_engineer_secret_key_987654321';

// 仿真加载与保存表 (完全服务于 D1Database binding 的 SQL Parser)
async function loadTable(tableName: string): Promise<any[]> {
  try {
    if (fs.existsSync(D1_STORAGE_FILE)) {
      const data = fs.readFileSync(D1_STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return parsed[tableName] || [];
    }
  } catch (e) {
    console.error(`[D1 Simulator] 读取表 ${tableName} 失败, 初始化为空:`, e);
  }
  return [];
}

async function saveTable(tableName: string, rows: any[]) {
  try {
    let currentData: any = {};
    if (fs.existsSync(D1_STORAGE_FILE)) {
      try {
        currentData = JSON.parse(fs.readFileSync(D1_STORAGE_FILE, 'utf8'));
      } catch (e) {}
    }
    currentData[tableName] = rows;
    
    const dir = path.dirname(D1_STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(D1_STORAGE_FILE, JSON.stringify(currentData, null, 2), 'utf8');
  } catch (e) {
    console.error(`[D1 Simulator] 写入表 ${tableName} 失败:`, e);
  }
}

// 密码哈希生成 (SHA-256 pbkdf2)
function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, JWT_SECRET, 1000, 64, 'sha512').toString('hex');
}

// 声明符合 Cloudflare D1 运行标准的 SQL 预编译与执行控制器
class D1PreparedStatement {
  private sql: string;
  private params: any[] = [];

  constructor(sql: string) {
    this.sql = sql.trim();
  }

  bind(...args: any[]) {
    this.params = args;
    return this;
  }

  async first<T = any>(): Promise<T | null> {
    const results = await this.execute();
    return results.length > 0 ? results[0] as T : null;
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean }> {
    const results = await this.execute();
    return {
      results: results as T[],
      success: true
    };
  }

  async run(): Promise<{ success: boolean; meta: any }> {
    await this.execute();
    return {
      success: true,
      meta: { changes: 1 }
    };
  }

  private async execute(): Promise<any[]> {
    const sqlUpper = this.sql.toUpperCase();
    const tableWord = this.sql.match(/(FROM|INTO)\s+([a-zA-Z0-9_]+)/i)?.[2]?.toLowerCase();

    if (tableWord === 'users') {
      const users = await loadTable('users');

      // 1. 根据 email 查找
      if (sqlUpper.includes('SELECT') && sqlUpper.includes('WHERE EMAIL =')) {
        const bindEmail = this.params[0]?.toLowerCase().trim();
        const found = users.filter((u: any) => u.email.toLowerCase() === bindEmail);
        return found.map((u: any) => ({
          vip_level: u.vip_level || 'free',
          vip_expires_at: u.vip_expires_at || null,
          ...u
        }));
      }

      // 2. 根据 id 查找
      if (sqlUpper.includes('SELECT') && sqlUpper.includes('WHERE ID =')) {
        const bindId = this.params[0];
        const found = users.filter((u: any) => u.id === bindId);
        return found.map((u: any) => ({
          vip_level: u.vip_level || 'free',
          vip_expires_at: u.vip_expires_at || null,
          ...u
        }));
      }

      // 3. 注册新用户 insert into
      if (sqlUpper.includes('INSERT INTO')) {
        const [id, email, password_hash, displayName, created_at] = this.params;
        const newUser = { 
          id, 
          email, 
          password_hash, 
          displayName, 
          created_at, 
          vip_level: 'free', 
          vip_expires_at: null 
        };
        users.push(newUser);
        await saveTable('users', users);
        return [newUser];
      }

      // 4. 为本地模拟特定的 UPDATE ... SET ...
      if (sqlUpper.includes('UPDATE')) {
        const parts = this.sql.replace(/\s+/g, ' ');
        const emailMatch = parts.match(/WHERE email\s*=\s*(['"]?)(.*?)\1/i);
        const bindEmail = emailMatch ? emailMatch[2].toLowerCase().trim() : (this.params[this.params.length - 1]?.toLowerCase().trim() || '');
        
        let changed = false;
        const updatedUsers = users.map((u: any) => {
          if (u.email.toLowerCase() === bindEmail || u.id === this.params[this.params.length - 1]) {
            changed = true;
            // 简单把 params 里面的 level 填进去，或者从 SQL 字符串中智能识别
            let nextLevel = this.params.find(p => p === 'admin' || p === 'pro' || p === 'free');
            if (!nextLevel) {
              if (sqlUpper.includes("VIP_LEVEL = 'ADMIN'")) {
                nextLevel = 'admin';
              } else if (sqlUpper.includes("VIP_LEVEL = 'PRO'")) {
                nextLevel = 'pro';
              } else if (sqlUpper.includes("VIP_LEVEL = 'FREE'")) {
                nextLevel = 'free';
              } else {
                nextLevel = 'pro';
              }
            }
            // 获取可能包含 DATETIME 值的参数
            const nextExpires = this.params.find(p => p && typeof p === 'string' && p.includes('-')) || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            return {
              ...u,
              vip_level: nextLevel,
              vip_expires_at: nextExpires
            };
          }
          return u;
        });

        if (changed) {
          await saveTable('users', updatedUsers);
        }
        return [];
      }

      return users.map((u: any) => ({
        vip_level: u.vip_level || 'free',
        vip_expires_at: u.vip_expires_at || null,
        ...u
      }));
    }

    if (tableWord === 'feedbacks') {
      const feedbacks = await loadTable('feedbacks');
      if (sqlUpper.includes('INSERT INTO')) {
        const [id, user_id, email, content, screenshot, created_at] = this.params;
        const newFeedback = { id, user_id, email, content, screenshot, created_at };
        feedbacks.push(newFeedback);
        await saveTable('feedbacks', feedbacks);
        return [newFeedback];
      }
      return feedbacks;
    }

    if (tableWord === 'system_configs') {
      const configs = await loadTable('system_configs');
      if (sqlUpper.includes('SELECT') && sqlUpper.includes('KEY =')) {
        const bindKey = this.params[0] || '';
        return configs.filter((c: any) => c.key === bindKey);
      }
      if (sqlUpper.includes('INSERT') || sqlUpper.includes('UPDATE') || sqlUpper.includes('REPLACE')) {
        const [key, value] = this.params;
        const index = configs.findIndex((c: any) => c.key === key);
        if (index > -1) {
          configs[index].value = value;
        } else {
          configs.push({ key, value });
        }
        await saveTable('system_configs', configs);
        return [{ key, value }];
      }
      return configs;
    }

    if (tableWord === 'orders') {
      const orders = await loadTable('orders');
      if (sqlUpper.includes('INSERT INTO')) {
        const [id, user_id, email, payment_method, amount, voucher_name, voucher_screenshot, status, created_at] = this.params;
        const newOrder = { id, user_id, email, payment_method, amount, voucher_name, voucher_screenshot, status, created_at, updated_at: created_at };
        orders.push(newOrder);
        await saveTable('orders', orders);
        return [newOrder];
      }
      if (sqlUpper.includes('UPDATE')) {
        const [status, updated_at, id] = this.params;
        let changed = false;
        const updatedOrders = orders.map((o: any) => {
          if (o.id === id) {
            changed = true;
            return { ...o, status, updated_at };
          }
          return o;
        });
        if (changed) {
          await saveTable('orders', updatedOrders);
        }
        return [];
      }
      if (sqlUpper.includes('WHERE ID =')) {
        const id = this.params[0];
        return orders.filter((o: any) => o.id === id);
      }
      if (sqlUpper.includes('WHERE USER_ID =')) {
        const userId = this.params[0];
        return orders.filter((o: any) => o.user_id === userId);
      }
      return orders;
    }

    return [];
  }
}

// 模拟 c.env.DB 或 env.DB
const env = {
  DB: {
    prepare(sql: string) {
      return new D1PreparedStatement(sql);
    }
  }
};

// 签发用户 Session 令牌 
function generateToken(userId: string): string {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 天过期
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${userId}:${expiresAt}`)
    .digest('hex');
  return Buffer.from(`${userId}:${expiresAt}:${signature}`).toString('base64');
}

// 校验 Session 令牌
function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [userId, expiresAtStr, signature] = decoded.split(':');
    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) return null;
    
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET)
      .update(`${userId}:${expiresAt}`)
      .digest('hex');
    
    if (signature !== expectedSignature) return null;
    return { userId };
  } catch {
    return null;
  }
}

const app = express();
const PORT = 3000;
const apiRouter = express.Router();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ---【系统认证与限额逻辑】---

// 校验限额的中间件 (支持 Trial 与 Registered 用户)
const checkUsageLimit = async (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'] as string; 
  const authHeader = req.headers['authorization'];
  
  // 1. 如果是演示账号 (UID 以 demo- 开头)
  if (userId && userId.startsWith('demo-')) {
    const currentCount = demoUsageMap.get(userId) || 0;
    if (currentCount >= MAX_DEMO_USAGE) {
      return res.status(403).json({ 
        success: false, 
        message: `您的快速试用额度已用尽（共 ${MAX_DEMO_USAGE} 次）。` 
      });
    }
    const newCount = currentCount + 1;
    demoUsageMap.set(userId, newCount);
    res.locals.remaining = MAX_DEMO_USAGE - newCount;
    return next();
  }

  // 2. 如果是注册用户 (必须携带有效的 Authorization Bearer Token)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const tokenData = verifyToken(token);
      if (!tokenData) throw new Error('无效的会话，请重新登录');

      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
      if (!user) throw new Error('用户档案不存在，请重新注册或登录');
      
      // 验证令牌中的用户 ID 与请求头中声明的是否一致（防止 ID 篡改）
      if (userId && user.id !== userId) {
        return res.status(403).json({ success: false, message: '身份验证冲突，操作被拒绝' });
      }

      // 将用户信息存入本地，后续逻辑可用
      res.locals.user = user;
      res.locals.remaining = Infinity; // 注册用户不限制次数
      return next();
    } catch (e: any) {
      return res.status(401).json({ success: false, message: e.message });
    }
  }

  return res.status(401).json({ success: false, message: '请登录后继续操作' });
};

// ---【Cloudflare D1-Style 账号登录与注册控制器接口】---

// 1. 用户注册
apiRouter.post('/auth/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
    }

    const lowerEmail = email.toLowerCase().trim();
    const existingUser = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(lowerEmail).first();

    if (existingUser) {
      // 邮箱已被注册，返回特定错误信息方便前端捕获
      return res.status(400).json({ success: false, message: 'already registered' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password should be at least 6 characters' });
    }

    const userId = `u_${crypto.randomBytes(8).toString('hex')}`;
    const pHash = hashPassword(password);
    const dName = displayName || email.split('@')[0];
    const createdAt = new Date().toISOString();

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(lowerEmail);
    const initialVipLevel = isAdminEmail ? 'admin' : 'free';

    await env.DB.prepare("INSERT INTO users (id, email, password_hash, displayName, created_at, vip_level) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, lowerEmail, pHash, dName, createdAt, initialVipLevel)
      .run();

    const token = generateToken(userId);
    console.log(`[D1 Auth] 新用户注册并持久化成功: ${lowerEmail} (Role: ${initialVipLevel})`);

    res.json({
      success: true,
      user: {
        uid: userId,
        email: lowerEmail,
        displayName: dName,
        isTrial: false,
        vip_level: initialVipLevel,
        vip_expires_at: null
      },
      session: {
        access_token: token
      }
    });
  } catch (error: any) {
    console.error('[D1 Auth] 注册核心异常:', error);
    res.status(500).json({ success: false, message: '服务器忙，注册失败' });
  }
});

// 2. 用户登录
apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
    }

    const lowerEmail = email.toLowerCase().trim();
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(lowerEmail).first();

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const hashedPassword = hashPassword(password);
    if (user.password_hash !== hashedPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    console.log(`[D1 Auth] 用户登录成功: ${lowerEmail}`);

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(lowerEmail);
    let currentVipLevel = user.vip_level || 'free';
    if (isAdminEmail && currentVipLevel !== 'admin') {
      currentVipLevel = 'admin';
      await env.DB.prepare("UPDATE users SET vip_level = 'admin' WHERE id = ?").bind(user.id).run();
    }

    res.json({
      success: true,
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        isTrial: false,
        vip_level: currentVipLevel,
        vip_expires_at: user.vip_expires_at || null
      },
      session: {
        access_token: token
      }
    });
  } catch (error: any) {
    console.error('[D1 Auth] 登录核心异常:', error);
    res.status(500).json({ success: false, message: '服务器忙，登录失败' });
  }
});

// 3. 用户主页自核验 (获取当前用户信息)
apiRouter.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
    }

    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    let currentVipLevel = user.vip_level || 'free';
    if (isAdminEmail && currentVipLevel !== 'admin') {
      currentVipLevel = 'admin';
      await env.DB.prepare("UPDATE users SET vip_level = 'admin' WHERE id = ?").bind(user.id).run();
    }

    res.json({
      success: true,
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        isTrial: false,
        vip_level: currentVipLevel,
        vip_expires_at: user.vip_expires_at || null
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: '自核验异常' });
  }
});

// 4. 用户 VIP 激活与升级
apiRouter.post('/auth/upgrade', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
    }

    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const expiration = new Date();
    expiration.setFullYear(expiration.getFullYear() + 1); // 1年有效期
    const expiresStr = expiration.toISOString();

    await env.DB.prepare("UPDATE users SET vip_level = 'pro', vip_expires_at = ? WHERE id = ?")
      .bind(expiresStr, tokenData.userId)
      .run();

    console.log(`[D1 Auth] 用户 VIP 已成功激活: ${user.email}`);

    res.json({
      success: true,
      message: '升级成功',
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        isTrial: false,
        vip_level: 'pro',
        vip_expires_at: expiresStr
      }
    });
  } catch (error: any) {
    console.error('[D1 Auth] 升级异常:', error);
    res.status(500).json({ success: false, message: '激活失败' });
  }
});

// ==========================================
// 💳 【D1-STYLE TRANSACTION & CONTROL PIPELINE】
// ==========================================

// 1. 获取全局唯一的系统收款码 (任何用户均可访问，支持热加载)
apiRouter.get('/system/qr', async (req, res) => {
  try {
    const qrConfig = await env.DB.prepare("SELECT * FROM system_configs WHERE key = ?").bind('payment_qr_code_url').first();
    res.json({
      success: true,
      qrUrl: qrConfig?.value || process.env.VITE_PAYMENT_QR_CODE_URL || ''
    });
  } catch (e: any) {
    res.json({ success: false, qrUrl: '' });
  }
});

// 2. 超级管理员安全配置收款码 (只限 vip_level === 'admin' 或 master admin 邮箱)
apiRouter.post('/system/qr', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期' });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无管理员操作权限' });
    }

    const { qrUrl } = req.body;
    await env.DB.prepare("INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)")
      .bind('payment_qr_code_url', qrUrl || '')
      .run();

    console.log(`[Admin Control] 收款信息已被管理员 ${user.email} 升级为自定义源`);
    res.json({ success: true, message: '收款码更新成功', qrUrl });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '系统错误' });
  }
});

// 2.3 获取系统会员定价
apiRouter.get('/system/price', async (req, res) => {
  try {
    const priceConfig = await env.DB.prepare("SELECT * FROM system_configs WHERE key = ?").bind('pro_membership_price').first();
    const price = priceConfig?.value ? parseFloat(priceConfig.value) : 399.00;
    res.json({
      success: true,
      price: isNaN(price) ? 399.00 : price
    });
  } catch (e: any) {
    res.json({ success: true, price: 399.00 });
  }
});

// 2.4 超级管理员配置价格
apiRouter.post('/system/price', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期' });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无管理员操作权限' });
    }

    const { price } = req.body;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ success: false, message: '非法价格数值' });
    }

    await env.DB.prepare("INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)")
      .bind('pro_membership_price', priceNum.toString())
      .run();

    console.log(`[Admin Control] PRO 会员价格已被管理员 ${user.email} 升级为 ${priceNum}`);
    res.json({ success: true, message: '会员价格更新成功', price: priceNum });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '系统错误' });
  }
});

// 3. 用户提交转账核验申请订单
apiRouter.post('/orders', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '请先登录账号后提交转账记录' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const { paymentMethod, amount, voucherName, voucherScreenshot } = req.body;
    if (!voucherName) {
      return res.status(400).json({ success: false, message: '请填写转账昵称或支付凭证号以供比对' });
    }

    const orderId = `ord_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();
    
    await env.DB.prepare("INSERT INTO orders (id, user_id, email, payment_method, amount, voucher_name, voucher_screenshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(orderId, user.id, user.email, paymentMethod || '微信/支付宝', amount || 399, voucherName, voucherScreenshot || '', 'pending', createdAt)
      .run();

    console.log(`[Order Processing] 用户 ${user.email} 新提交一笔订单: ID=${orderId}, 凭证=${voucherName}`);
    res.json({ success: true, message: '账单凭证提交成功！系统管理员核款确收后会自动极速升级您的账号。', orderId });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '账单提交异常' });
  }
});

// 4. 获取订单记录 (用户查看自己的申请历史，管理员一览全局)
apiRouter.get('/orders', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期' });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    let orders: any = [];
    if (isAdmin) {
      orders = await env.DB.prepare("SELECT * FROM orders").all();
    } else {
      orders = await env.DB.prepare("SELECT * FROM orders WHERE user_id = ?").bind(user.id).all();
    }

    // 处理 SQL prepare 返回的数据格式并升序/降序展示
    const rawOrders = Array.isArray(orders) ? orders : ((orders as any).results || []);
    const sortedOrders = [...rawOrders].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, orders: sortedOrders });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '系统错误' });
  }
});

// 5. 超级管理员：一键手动审批或作废订单、联动解锁 Pro
apiRouter.post('/orders/approve', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return res.status(401).json({ success: false, message: '会话已过期' });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无管理员操作权限' });
    }

    const { orderId, status } = req.body; // status: 'success' | 'rejected'
    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: '订单ID和状态(status)为必填项' });
    }

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) {
      return res.status(404).json({ success: false, message: '目标账单未找到' });
    }

    const updatedAt = new Date().toISOString();
    await env.DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, updatedAt, orderId)
      .run();

    if (status === 'success') {
      const expiration = new Date();
      expiration.setFullYear(expiration.getFullYear() + 1); // 账期 1 年
      const expiresStr = expiration.toISOString();

      await env.DB.prepare("UPDATE users SET vip_level = 'pro', vip_expires_at = ? WHERE id = ?")
        .bind(expiresStr, order.user_id)
        .run();
      
      console.log(`[Admin Action] 订单审核通过，成功赋权: 用户=${order.email}, 到期时间=${expiresStr}`);
    } else {
      console.log(`[Admin Action] 订单审核拒绝/作废: ID=${orderId}, 申请者=${order.email}`);
    }

    res.json({ success: true, message: `账单已审核更新为: ${status === 'success' ? '已支付过账' : '异常拒绝'}` });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '审核处理异常' });
  }
});

// ---【系统状态】健康检查接口 ---
apiRouter.all('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    localsystem: true,
    time: new Date().toISOString()
  });
});

/**
 * ---【用户反馈】反馈提交接口 ---
 */
apiRouter.post('/feedback', async (req, res) => {
  const { userId, email, content, screenshot } = req.body;
  
  if (!content) {
    return res.status(400).json({ success: false, message: '反馈内容不能为空' });
  }

  console.log(`[Feedback] Received from ${email || userId}: ${content.substring(0, 50)}...`);

  try {
    const feedbackId = `f_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();
    await env.DB.prepare("INSERT INTO feedbacks (id, user_id, email, content, screenshot, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(feedbackId, userId || '', email || '', content, screenshot || '', createdAt)
      .run();
    res.json({ success: true, message: '反馈已收到，感谢您的支持。' });
  } catch (e: any) {
    console.error('[Feedback] Critical error during submission:', e);
    res.status(500).json({ success: false, message: '服务器忙，请稍后再试。' });
  }
});

/**
 * --- 坐标转换计算核心 (Mathematics of Coordinate Transformation) ---
 * 背景：由于中国地图存在坐标偏移加密（GCJ-02 火星坐标系），我们需要通过数学公式在 WGS84、GCJ-02、BD-09 之间相互转换。
 */
const PI = 3.1415926535897932384626; // 定义高精度的圆周率常量，它是所有球面地理计算的基石
const A = 6378137.0; // 地球的赤道半径（单位：米），来自标准的 WGS84 椭球体模型参数
const EE = 0.00669342162296594323; // 第一偏心率平方值，用于修正地球并非正球体带来的经纬度投影误差

/**
 * 计算两个坐标点之间的物理球面距离（单位：米）
 * 该函数采用了球面三角学中的 Haversine（半正矢）公式。
 */
function getDistance(lng1: number, lat1: number, lng2: number, lat2: number) {
  const radLat1 = lat1 * PI / 180.0; // 将第一个点的纬度由角度转为弧度
  const radLat2 = lat2 * PI / 180.0; // 将第二个点的纬度由角度转为弧度
  const a = radLat1 - radLat2; // 两点间的纬度差
  const b = (lng1 * PI / 180.0) - (lng2 * PI / 180.0); // 两点间的经度差
  // 核心距离计算公式：模拟球面最短路径
  let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));
  s = s * 6378137.0; // 乘以地球半径，将弧度结果转换为实际物理距离（米）
  return s; // 返回最终的直线物理距离
}

// 内部运算辅助函数：利用非线性多项式计算纬度方向的修正分量
function transformLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)); // 基础几何线性组合
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 混合正弦波干扰项
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0; // 叠加中频正弦波修正
  ret += (160.0 * Math.sin(y * PI / 12.0) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0; // 最终通过大幅度分量进行宏观地理矫正
  return ret;
}

// 内部运算辅助函数：利用非线性多项式计算经度方向的修正分量
function transformLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)); // 基础经向几何映射
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 加入经度特定的高频加密脉冲
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0; // 中频波动修正项
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0; // 最终的大尺度地理边缘修正
  return ret;
}

/**
 * 【坐标对齐】火星坐标 (GCJ-02) 转 地球标准坐标 (WGS-84)
 * 目的：高德 API 返回的数据是加密的火星坐标，导出为 GIS 文件或在天地图显示时，必须归一化为 WGS-84 标准。
 */
export function gcj02_to_wgs84(lng: number, lat: number) {
  let dlat = transformLat(lng - 105.0, lat - 35.0);
  let dlng = transformLng(lng - 105.0, lat - 35.0);
  let radlat = lat / 180.0 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  let sqrtmagic = Math.sqrt(magic);
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
  return [lng - dlng, lat - dlat];
}

/**
 * 【坐标对齐】地球标准坐标 (WGS-84) 转 火星坐标 (GCJ-02)
 * 目的：将标准的 GPS 经纬度数据转换为高德地图 API 能够识别的加密坐标，以便进行路径规划。
 */
export function wgs84_to_gcj02(lng: number, lat: number) {
  let dlat = transformLat(lng - 105.0, lat - 35.0);
  let dlng = transformLng(lng - 105.0, lat - 35.0);
  let radlat = lat / 180.0 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  let sqrtmagic = Math.sqrt(magic);
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
  return [lng + dlng, lat + dlat];
}

/**
 * 【坐标对齐】百度坐标 (BD-09) 转 火星坐标 (GCJ-02)
 * 目的：处理用户从百度地图导出的消防站点，将其对齐到高德地图 API 能够精准识别的工作空间。
 */
export function bd09_to_gcj02(bd_lon: number, bd_lat: number) {
  const x_pi = PI * 3000.0 / 180.0; // 百度特有的坐标空间换算系数
  const x = bd_lon - 0.0065; // 初步撤回百度在经向上的位置偏移
  const y = bd_lat - 0.006; // 初步撤回百度在纬向上的位置偏移
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi); // 计算极坐标下的旋转半径并在角度空间施加非线性修正
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi); // 计算极坐标下的相位角并引入周期性修正分量
  const gcj_lng = z * Math.cos(theta); // 重新计算投影回直角坐标系的经度
  const gcj_lat = z * Math.sin(theta); // 重新计算投影回直角坐标系的纬度
  return [gcj_lng, gcj_lat]; // 得到转换后的高德原生支持火星坐标 [经, 纬]
}

/**
 * ---【业务核心逻辑】消防站点多维等时圈分析接口 ---
 * 定义了一个 POST 类型的 API 路由 '/analyze'，用来执行复杂的后端计算任务。
 */
apiRouter.post('/analyze', checkUsageLimit, async (req, res) => {
  // 从前端发送的 HTTP 请求请求体中，通过解构赋值一次性提取出所有控制参数
  const { 
    apiKeys,     // 用户输入的高德地图开发者申请的秘钥列表（用于并发配额分摊）
    origin,      // 消防站的中心位置坐标（分析的原点 [lng, lat]）
    targetMin,   // 用户要求的目标到达时间（单位：分钟，默认为 5）
    factor,      // 消防车行驶特权修正系数（策略优化用，模拟超越社会车辆的效率）
    coordSystem, // 用户输入的坐标系类型名（例如：GCJ-02 或 BD-09）
    entrySpeed,  // 模拟仿真参数：进入地块或单位内部后的平均行驶速度 (单位：米/秒)
    entryPenalty // 模拟仿真参数：地块响应补偿，指车辆停稳、展开装备等固定耗时（单位：秒）
  } = req.body; 
  
  // 安全校验：如果请求中没有携带有效的 API Key，无法调用三方数据，直接报错返回 400
  if (!apiKeys || apiKeys.length === 0) {
    return res.status(400).json({ error: 'Missing API Keys' });
  }

  // 1. 坐标统一对齐：将输入坐标统一转换为高德 API 正确识别的火星坐标 (GCJ-02)
  let [inputLng, inputLat] = origin; // 获取解包后的经纬度数据
  let gcjLng: number, gcjLat: number; // 声明分析全程所使用的底稿坐标变量
  if (coordSystem === 'BD-09') {
    // 若确认是百度来源，先调转换器剥离百度外壳，对齐到火星轨道
    [gcjLng, gcjLat] = bd09_to_gcj02(inputLng, inputLat);
  } else if (coordSystem === 'WGS-84') {
    // 若确认是标准 GPS 坐标，对齐到火星轨道
    [gcjLng, gcjLat] = wgs84_to_gcj02(inputLng, inputLat);
  } else {
    // 否则直接采用（高德坐标输入时），不做二次损耗转换，保持物理原始精度
    gcjLng = inputLng;
    gcjLat = inputLat;
  }

  // 综合计算物理搜索半径公式：目标分钟 × 每秒假设位移 × 冗余系数，并预设 7.5 公里硬性封顶以防 API 额度超支
  const radius = Math.min(Math.floor(targetMin * 800 * 1.5), 7500); 
  
  try {
    // ---【任务 A】深度 POI 兴趣点云探测 (POI Scanning) ---
    const aroundUrl = 'https://restapi.amap.com/v3/place/around'; // 指定向高德“周边搜索”数据接口发请求的地址
    const anchors: string[] = []; // 初始化一个空的“锚点库”，我们将收集成百上千个潜在的灭火目的地坐标
    
    // A.1 中心点深度扫描：抓取前 15 页数据（约 750 个真实点位），构建全量覆盖样本库
    for (let page = 1; page <= 15; page++) {
      const currentKey = apiKeys[(page - 1) % apiKeys.length];
      try {
        const aroundRes = await axios.get(aroundUrl, {
          params: {
            key: currentKey,
            location: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`,
            radius: radius,
            offset: 50,
            page: page
          }
        });
        if (aroundRes.data.status === '1' && aroundRes.data.pois) {
          aroundRes.data.pois.forEach((poi: any) => anchors.push(poi.location));
          if (aroundRes.data.pois.length < 50) break;
        } else {
          break;
        }
      } catch (e) { break; }
    }

    // A.2 几何补盲（极速模式）：通过数学计算注入 24 个方向锚点，作为无建筑区域的保底逻辑
    for (let angle = 0; angle < 360; angle += 45) { 
      for (const distStep of [0.5, 1.0, 1.3]) { 
        const rad = (angle * Math.PI) / 180;
        const g_lng = gcjLng + (radius * distStep * Math.cos(rad)) / (111320 * Math.cos((gcjLat * Math.PI) / 180));
        const g_lat = gcjLat + (radius * distStep * Math.sin(rad)) / 111320;
        
        anchors.push(`${g_lng.toFixed(6)},${g_lat.toFixed(6)}`); 
      }
    }

    // 锚点收割与去重：对全量获取到的点位发起路径规划，不再限制为 200 个
    const uniqueAnchors = Array.from(new Set(anchors)); 
    const trailPoints: [number, number, number][] = []; // 核心成果桶：存放每一个轨迹细节 [WGS84经, WGS84纬, 累计耗时]
    const routeUrl = 'https://restapi.amap.com/v3/direction/driving'; // 指向高德最核心的驾车模拟（路径规划）引擎地址

    // ---【任务 B】高德实时路网模拟与特勤特权仿真 (掉头 & 反常态通行) ---
    const routePromises = uniqueAnchors.map(async (destStr, idx) => {
      const [destLng, destLat] = destStr.split(',').map(Number); // 解析当前目标终点的物理中心位置
      const strategy = idx % 2 === 0 ? 13 : 17; // 多样化模拟：在“推荐路线”和“最快时间”策略间轮训，提升模型广泛度
      const currentKey = apiKeys[idx % apiKeys.length]; // 密钥轮换
      try {
        const rRes = await axios.get(routeUrl, {
          params: {
            key: currentKey, origin: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`, destination: destStr, strategy: strategy
          }
        });

        // 解析高德实时路况模型输出的海量动态轨迹数据包
        if (rRes.data.status === '1' && rRes.data.route) {
          const path = rRes.data.route.paths[0]; // 提取得分最高的第一条路径细节
          let accTime = 0; // 该单一路径分支的累计已行驶时长（秒）
          let lastLng = gcjLng, lastLat = gcjLat; // 追踪变量：实时记录轨迹包里最近一个点的物理位姿
          let hasFoundEarlyUturn = false; // 业务标志位：用来记录是否在起步阶段就已经处理过“逆行/掉头”特权

          path.steps.forEach((step: any, sIdx: number) => { // 遍历高德路书里的每一个导航小节（例如：在该路口左转直行 200 米）
            let dur = parseInt(step.duration); // 获知该小节在高德实时交通状态下预测的驾驶耗时
            const dist = parseInt(step.distance); // 获知该小节的物理长度

            // --- 仿真核心：消防特勤“逆行与极速掉头”模拟 (Counter-flow Simulation) ---
            
            // 情况 1：显式掉头动作优化。逻辑：由于消防车可以利用跨越绿化带、临时逆行至对面等特权完成快速转向，
            // 传统的“寻找红绿灯合法掉头”时间被我们强行压缩到 10% 模拟极速通过。
            if (step.instruction.includes('掉头') || step.action === '掉头') {
              dur = Math.floor(dur * 0.1); 
              hasFoundEarlyUturn = true; // 记录已启用特权转向
            } 
            // 情况 2：隐式逆行寻优优化。逻辑：在出警的前 60 秒内，如果路线明显在顺着车流寻找“合法口”，
            // 我们通过将耗时打 3 折来模拟消防车直接逆行驶入由于“顺流路口”太远而被浪费掉的短路。
            else if (!hasFoundEarlyUturn && accTime < 60 && sIdx < 3 && dist > 50) {
              dur = Math.floor(dur * 0.3); 
            }
            
            const polyline = step.polyline.split(';'); // 将路段中包含的数个轨迹转折拐点全部切开
            const tStep = dur / Math.max(1, polyline.length - 1); // 计算轨迹上每个细小小段均摊到的行驶时长分量
            
            polyline.forEach((p: string, j: number) => { // 遍历轨迹的每一毫米细节
              const [plng, plat] = p.split(',').map(Number); // 解析当前转角点的火星坐标
              // 这里是数据产出的最后防线：将每一个分析得出的火星坐标瞬时转换为地球标准 WGS-84 坐标。
              // 这样当导出的数据在专业 GIS 软件或者天地图上显示时，能实现 0 毫米的精准对齐。
              const [wlng, wlat] = gcj02_to_wgs84(plng, plat); 
              trailPoints.push([wlng, wlat, accTime + j * tStep]); // 将处理后的带时间足迹点存入成果仓
              lastLng = plng; lastLat = plat; // 实时同步马路边上最后一个已知点的坐标
            });
            accTime += dur; // 累加更新总时长
          });

          // --- 地块内最后 100 米的路程修正仿真 (Plot Offset Correction) ---
          // 逻辑痛点：普通导航 API 仅负责把你导到路边。需要计算该处与目的地真正的“地块重心”之间的间隙。
          const parcelGapDistance = getDistance(lastLng, lastLat, destLng, destLat); // 计算物理偏差值（米）
          
          if (parcelGapDistance > 5) { // 如果偏差超过 5 米，说明存在小区内道路、单位大门等隐性行程
            // 仿真逻辑：地块内速度 = 用户设定的 entrySpeed，响应补偿 = 用户设定的 entryPenalty（默认为 0 理想即时响应）。
            // 使用 Math.max(0.1, ...) 是防止除以零的数学错误。
            const entryPenaltyTime = (parcelGapDistance / Math.max(0.1, Number(entrySpeed || 3.0))) + Number(entryPenalty || 0); 
            const finalTotalTime = accTime + entryPenaltyTime; // 合并马路形成和地块内行走的最终总体耗时
            
            // 最终补完：将地块真实的重心物理坐标（WGS84 转换后）作为该测算支线的最后一个逻辑落位点存入
            const [wDestLng, wDestLat] = gcj02_to_wgs84(destLng, destLat);
            trailPoints.push([wDestLng, wDestLat, finalTotalTime]);
          }
        }
      } catch (e) {
        console.error('Single route logic trace abandoned.', e); // 允许少部分路网坏点测算失败，确保大局稳定
      }
    });

    await Promise.all(routePromises); // 集火式并发等待，直到全量 200 条支路的上万个轨迹点全部计算完毕并完成坐标对齐

    // 成果盖章：最后也将分析原点（消防站坐标）也转为标准 WGS-84 格式一同返回，用于前端精准校对 marker 位置
    const [wgsLng, wgsLat] = gcj02_to_wgs84(gcjLng, gcjLat);

    // 将完全归一化到 WGS-84 全面标准下的分析成果包响应给前端渲染引擎
    res.json({
      trailPoints: trailPoints, // 海量的带时间标签的轨迹点点云数据集
      anchorCount: uniqueAnchors.length, // 反馈合计分析了多少个目的地地标点
      apiCalls: uniqueAnchors.length + 10, // 反馈后端累计消耗的高德地图信用点（API 调用数）
      wgsOrigin: [wgsLng, wgsLat], // 准确的地球姿态系统下的消防站原点坐标对 [经度, 纬度]
      remaining: res.locals.remaining
    });

  } catch (error: any) {
    // 捕获各种不可抗力大灾难（秘钥余额不足、高德网络全线崩溃、运营商封锁等情况）
    console.error('SERVER LEVEL CRITICAL FAILURE:', error.message);
    res.status(500).json({ error: '后端计算引擎链路中断，建义核查网络环境后重新提交。' }); 
  }
});

/**
 * ---【模型校验拟合器】核心算法 ---
 */
apiRouter.post('/calibrate', checkUsageLimit, async (req, res) => {
  const { apiKeys, samples, coordSystem } = req.body;
  
  if (!apiKeys || !samples || samples.length === 0) {
    return res.status(400).json({ error: '缺少秘钥或样本数据' });
  }

  const routeUrl = 'https://restapi.amap.com/v3/direction/driving';
  const results: any[] = [];

  try {
    // 1. 数据预处理与原始行程获取
    for (const sample of samples) {
      let [sLng, sLat] = [sample.stationLng, sample.stationLat];
      let [iLng, iLat] = [sample.incidentLng, sample.incidentLat];
      
      if (coordSystem === 'BD-09') {
        [sLng, sLat] = bd09_to_gcj02(sLng, sLat);
        [iLng, iLat] = bd09_to_gcj02(iLng, iLat);
      } else if (coordSystem === 'WGS-84') {
        [sLng, sLat] = wgs84_to_gcj02(sLng, sLat);
        [iLng, iLat] = wgs84_to_gcj02(iLng, iLat);
      }

      const key = apiKeys[Math.floor(Math.random() * apiKeys.length)];
      const rRes = await axios.get(routeUrl, {
        params: { key, origin: `${sLng.toFixed(6)},${sLat.toFixed(6)}`, destination: `${iLng.toFixed(6)},${iLat.toFixed(6)}`, strategy: 13 }
      });

      if (rRes.data.status === '1' && rRes.data.route) {
        const path = rRes.data.route.paths[0];
        let rawRoadTime = 0;
        let lastLng = sLng, lastLat = sLat;

        path.steps.forEach((step: any) => {
          rawRoadTime += parseInt(step.duration);
          const polyline = step.polyline.split(';');
          const lastPoint = polyline[polyline.length - 1].split(',');
          lastLng = Number(lastPoint[0]);
          lastLat = Number(lastPoint[1]);
        });

        const gapDist = getDistance(lastLng, lastLat, iLng, iLat);
        results.push({
          rawRoadTime,
          gapDist,
          actualTotalTime: sample.actualTotalTime
        });
      }
    }

    // 2. 网格搜索寻找最优解 (Grid Search + Physical Constraints + Penalty)
    if (results.length === 0) {
      return res.json({
        recommendedFactor: 0.8,
        recommendedEntrySpeed: 3.0,
        averageErrorSeconds: 0,
        sampleCount: 0,
        message: '没有样本成功获取到路网路径，请检查 API Key 或坐标位置'
      });
    }

    let bestFactor = 0.8;
    let bestEntrySpeed = 3.0;
    let minScore = Infinity;

    // 遍历 factor (0.4 - 1.2) 和 entrySpeed (1.0 - 15.0)
    for (let f = 0.4; f <= 1.2; f += 0.02) {
      for (let s = 1.0; s <= 15.0; s += 0.5) {
        // 计算每个样本在该参数下的误差
        const errors = results.map(item => {
          const simTime = (item.rawRoadTime * f) + (item.gapDist / s);
          return Math.abs(simTime - item.actualTotalTime);
        });

        // --- 核心优化：鲁棒性拟合 (Robust Fitting) ---
        errors.sort((a, b) => a - b);
        const keepCount = Math.max(1, Math.floor(errors.length * 0.8));
        const trimmedErrors = errors.slice(0, keepCount);
        const avgError = trimmedErrors.reduce((sum, e) => sum + e, 0) / keepCount;

        // --- 核心优化：引入“物理惩罚项” (Physical Regularization) ---
        // 增加一个分数惩罚，让模型避免选择不合理的极端值
        let penalty = 0;
        if (f > 0.95) penalty += (f - 0.95) * 500; // factor 接近或超过 1.0 时显著惩罚
        if (s < 2.0) penalty += (2.0 - s) * 200;   // 速度低于 2m/s (7km/h) 时显著惩罚
        
        const currentScore = avgError + penalty;

        if (currentScore < minScore) {
          minScore = currentScore;
          bestFactor = f;
          bestEntrySpeed = s;
        }
      }
    }

    // 计算最终选定参数下的真实物理误差（不含惩罚项）
    const finalErrors = results.map(item => {
      const simTime = (item.rawRoadTime * bestFactor) + (item.gapDist / bestEntrySpeed);
      return Math.abs(simTime - item.actualTotalTime);
    });
    finalErrors.sort((a, b) => a - b);
    const finalAvgError = finalErrors.slice(0, Math.floor(finalErrors.length * 0.8)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(finalErrors.length * 0.8));

    res.json({
      recommendedFactor: Number(bestFactor.toFixed(2)),
      recommendedEntrySpeed: Number(bestEntrySpeed.toFixed(2)),
      averageErrorSeconds: Number(finalAvgError.toFixed(2)),
      sampleCount: results.length,
      trimmedCount: Math.floor(results.length * 0.2),
      remaining: res.locals.remaining
    });

  } catch (error: any) {
    res.status(500).json({ error: '拟合计算失败: ' + error.message });
  }
});

// 挂载 API 路由到 /api 路径上完成
// app.use('/api', apiRouter); // 已移入 startServer 内部以确保优先级

/**
 * ---【系统运营控制】服务器启动逻辑 ---
 */
async function startServer() {
  // ---【关键修复】API 路由必须在静态资源和 Vite 中间件之前挂载 ---
  app.use('/api', apiRouter);
  
  // 如果识别为开发调试环境，则挂载 Vite 的极速热更新中间件
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true }, // 将 Vite 作为一个插件嵌入到我们自主开发的 Express 逻辑中
      appType: 'spa', // 定义前端框架类型为现代的 Single Page Application（单页应用）
    });
    app.use(vite.middlewares); // 把 Vite 的动态即时编译流注入到服务器主脉络上
  } else {
    // 如果识别为生产发布环境，则直接以最高性能模式分发之前编译好的 dist 物理静态文件
    const distPath = path.join(process.cwd(), 'dist'); // 设置物理存储位置
    app.use(express.static(distPath)); // 开启 Express 的物理文件直传传输机
    
    // 全路径兜底逻辑：防止用户刷新非根路径页面时出现 404，统一重定向给前端 index.html 接管渲染
    app.get('*', (req, res) => {
      // 排除 /api 路径，避免其返回 HTML
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: `API route not found: ${req.path}` });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 开始激发服务器在指定端口开启监听，正式开始营业接收请求
  app.listen(PORT, '0.0.0.0', () => {
    // 向系统运维黑窗口打印带前缀的成功确认信息
    console.log(`[FIRE_ENGINEER] 后端分析逻辑已上线! 访问端口: http://localhost:${PORT}`);
    console.log(`[FIRE_ENGINEER] 时空仿真模块加载中... 当前工作模式: ${process.env.NODE_ENV}`);
  });
}

// 激发最终的启动器控制流程
startServer(); 
