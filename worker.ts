import { Hono } from 'hono';
import crypto from 'node:crypto';
import shpwrite from 'shp-write';

type Bindings = {
  DB: any;
};

type Variables = {
  remaining: number;
  user?: any;
};

const apiApp = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath('/api');

// ---【全局状态：演示账户限额】---
// 注意：Workers 内存不持久，仅供同一实例内简单演示计次
let demoUsageCount = 0;
const MAX_DEMO_USAGE = 5;

const JWT_SECRET = 'fire_engineer_secret_key_987654321';

// 密码哈希生成 (SHA-256 pbkdf2)
function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, JWT_SECRET, 1000, 64, 'sha512').toString('hex');
}

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

// ---【核心优先级分配与限额中间件】---
const checkUsageLimit = async (c: any, next: any) => {
  const userId = c.req.header('x-user-id');
  const authHeader = c.req.header('authorization');
  
  // 1. 如果是演示账号 (UID 为 demo-999 或以 demo- 开头)
  if (userId && (userId === 'demo-999' || userId.startsWith('demo-'))) {
    if (demoUsageCount >= MAX_DEMO_USAGE) {
      return c.json({ 
        success: false, 
        message: `快速试用额度已用尽（共 ${MAX_DEMO_USAGE} 次），请注册账号继续使用完整功能` 
      }, 403);
    }
    demoUsageCount++;
    c.set('remaining', MAX_DEMO_USAGE - demoUsageCount);
    return await next();
  }

  // 2. 如果是注册用户 (Bearer Token)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const tokenData = verifyToken(token);
      if (!tokenData) throw new Error('无效的会话，请重新登录');

      const DB = c.env.DB;
      if (!DB) throw new Error('D1 数据库未绑定');

      const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
      if (!user) throw new Error('用户档案不存在，请重新注册或登录');
      
      // 验证令牌中的用户 ID 与请求头中声明的是否一致
      if (userId && user.id !== userId) {
        return c.json({ success: false, message: '身份验证冲突，操作被拒绝' }, 403);
      }
      
      c.set('user', user);
      c.set('remaining', Infinity);
      return await next();
    } catch (e: any) {
      return c.json({ success: false, message: e.message }, 401);
    }
  }

  return c.json({ success: false, message: '请登录后操作' }, 401);
};

// ---【认证接口】---

// 健康检查
apiApp.all('/health', (c) => {
  const hasDB = !!c.env.DB;
  return c.json({
    status: 'ok',
    environment: 'cloudflare-workers',
    database_bound: hasDB,
    time: new Date().toISOString()
  });
});

// 1. 用户注册
apiApp.post('/auth/register', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, displayName } = body;
    if (!email || !password) {
      return c.json({ success: false, message: '邮箱和密码不能为空' }, 400);
    }

    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const lowerEmail = email.toLowerCase().trim();
    const existingUser = await DB.prepare("SELECT * FROM users WHERE email = ?").bind(lowerEmail).first();

    if (existingUser) {
      return c.json({ success: false, message: 'already registered' }, 400);
    }

    if (password.length < 6) {
      return c.json({ success: false, message: 'Password should be at least 6 characters' }, 400);
    }

    const userId = `u_${crypto.randomBytes(8).toString('hex')}`;
    const pHash = hashPassword(password);
    const dName = displayName || email.split('@')[0];
    const createdAt = new Date().toISOString();

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(lowerEmail);
    const initialVipLevel = isAdminEmail ? 'admin' : 'free';

    await DB.prepare("INSERT INTO users (id, email, password_hash, displayName, created_at, vip_level) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, lowerEmail, pHash, dName, createdAt, initialVipLevel)
      .run();

    const token = generateToken(userId);
    console.log(`[D1 Auth Worker] 新用户注册成功: ${lowerEmail} (Role: ${initialVipLevel})`);

    return c.json({
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
    console.error('[D1 Auth Worker] 注册核心异常:', error);
    return c.json({ success: false, message: error.message || '服务器忙，注册失败' }, 500);
  }
});

// 2. 用户登录
apiApp.post('/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;
    if (!email || !password) {
      return c.json({ success: false, message: '邮箱和密码不能为空' }, 400);
    }

    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const lowerEmail = email.toLowerCase().trim();
    const user = await DB.prepare("SELECT * FROM users WHERE email = ?").bind(lowerEmail).first();

    if (!user) {
      return c.json({ success: false, message: 'Invalid credentials' }, 401);
    }

    const hashedPassword = hashPassword(password);
    if (user.password_hash !== hashedPassword) {
      return c.json({ success: false, message: 'Invalid credentials' }, 401);
    }

    const token = generateToken(user.id);
    console.log(`[D1 Auth Worker] 用户登录成功: ${lowerEmail}`);

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(lowerEmail);
    let currentVipLevel = user.vip_level || 'free';
    if (isAdminEmail && currentVipLevel !== 'admin') {
      currentVipLevel = 'admin';
      await DB.prepare("UPDATE users SET vip_level = 'admin' WHERE id = ?").bind(user.id).run();
    }

    return c.json({
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
    console.error('[D1 Auth Worker] 登录核心异常:', error);
    return c.json({ success: false, message: error.message || '服务器忙，登录失败' }, 500);
  }
});

// 3. 用户自核验
apiApp.get('/auth/me', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }

    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期，请重新登录' }, 401);
    }

    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }

    const isAdminEmail = ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    let currentVipLevel = user.vip_level || 'free';
    if (isAdminEmail && currentVipLevel !== 'admin') {
      currentVipLevel = 'admin';
      await DB.prepare("UPDATE users SET vip_level = 'admin' WHERE id = ?").bind(user.id).run();
    }

    return c.json({
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
    return c.json({ success: false, message: '自核验异常' }, 500);
  }
});

// 4. 用户 VIP 激活与升级
apiApp.post('/auth/upgrade', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }

    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期，请重新登录' }, 401);
    }

    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }

    const expiration = new Date();
    expiration.setFullYear(expiration.getFullYear() + 1); // 1年有效期
    const expiresStr = expiration.toISOString();

    await DB.prepare("UPDATE users SET vip_level = 'pro', vip_expires_at = ? WHERE id = ?")
      .bind(expiresStr, tokenData.userId)
      .run();

    console.log(`[D1 Auth Worker] 用户 VIP 已成功激活(年度): ${user.email}`);

    return c.json({
      success: true,
      message: '升级成功(年度)',
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
    console.error('[D1 Auth Worker] 升级核心异常:', error);
    return c.json({ success: false, message: error.message || '激活失败' }, 500);
  }
});

// 4.5. 超级管理员：获取全量用户列表 (用于管理面板)
apiApp.get('/admin/users', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return c.json({ success: false, message: '无管理员操作权限' }, 403);
    }

    const userData = await DB.prepare("SELECT id, email, displayName, vip_level, vip_expires_at, created_at FROM users").all();
    const rows = userData.results || [];
    
    // 按注册时间倒序
    const sortedUsers = [...rows].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json({ success: true, users: sortedUsers });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '查询用户失败' }, 500);
  }
});

// 5. 用户反馈提交
apiApp.post('/feedback', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, email, content, screenshot } = body;
    
    if (!content) {
      return c.json({ success: false, message: '反馈内容不能为空' }, 400);
    }

    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const feedbackId = `f_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();
    await DB.prepare("INSERT INTO feedbacks (id, user_id, email, content, screenshot, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(feedbackId, userId || '', email || '', content, screenshot || '', createdAt)
      .run();

    return c.json({ success: true, message: '反馈已收到，感谢您的支持。' });
  } catch (error: any) {
    console.error('[Feedback Worker] 反馈提交异常:', error);
    return c.json({ success: false, message: '服务器忙，请稍后再试。' }, 500);
  }
});

// ---【D1 TRANSACTION, ORDER & SYSTEM QR CODE PIPELINES】---

// 1. 获取全局唯一的系统收款码
apiApp.get('/system/qr', async (c) => {
  try {
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, qrUrl: '', alipayQrUrl: '' });
    }
    const wxConfig = await DB.prepare("SELECT * FROM system_configs WHERE key = ?").bind('payment_qr_code_url').first();
    const alipayConfig = await DB.prepare("SELECT * FROM system_configs WHERE key = ?").bind('payment_qr_code_alipay').first();
    return c.json({
      success: true,
      qrUrl: wxConfig?.value || '',
      alipayQrUrl: alipayConfig?.value || ''
    });
  } catch (e: any) {
    return c.json({ success: false, qrUrl: '', alipayQrUrl: '' });
  }
});

// 2. 超级管理员安全配置收款码
apiApp.post('/system/qr', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return c.json({ success: false, message: '无管理员操作权限' }, 403);
    }

    const body = await c.req.json();
    const { qrUrl, alipayQrUrl } = body;
    
    // 保存微信二维码至 D1
    await DB.prepare("INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)")
      .bind('payment_qr_code_url', qrUrl || '')
      .run();

    // 保存支付宝二维码至 D1
    if (alipayQrUrl !== undefined) {
      await DB.prepare("INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)")
        .bind('payment_qr_code_alipay', alipayQrUrl || '')
        .run();
    }

    console.log(`[Admin Control Worker] 收款信息已被管理员 ${user.email} 升级为自定义源`);
    return c.json({ success: true, message: '收款码更新成功', qrUrl, alipayQrUrl });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '系统错误' }, 500);
  }
});

// 1.5. 获取全局系统配置的价格
apiApp.get('/system/price', async (c) => {
  try {
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: true, price: 399.00 });
    }
    
    let price = 399.00;
    const configs = await DB.prepare("SELECT * FROM system_configs").all();
    const rows = configs.results || configs || [];

    // 1. 优先度 A：任何一行带有自定义 `price` 属性列的数据 (支持直接通过 D1 面板修改单个单元格生效)
    for (const r of rows as any[]) {
      if (r.price !== undefined && r.price !== null && r.price !== '') {
        const p = parseFloat(r.price);
        if (!isNaN(p) && p >= 0) {
          price = p;
        }
      }
    }

    // 2. 优先度 B：系统定价专用行配置
    const proPriceRow = (rows as any[]).find((r: any) => r.key === 'pro_membership_price');
    if (proPriceRow && proPriceRow.value) {
      const p = parseFloat(proPriceRow.value);
      if (!isNaN(p) && p >= 0) {
        price = p;
      }
    }

    return c.json({
      success: true,
      price: isNaN(price) ? 399.00 : price
    });
  } catch (e: any) {
    return c.json({ success: true, price: 399.00 });
  }
});

// 2.5. 超级管理员安全配置价格
apiApp.post('/system/price', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return c.json({ success: false, message: '无管理员操作权限' }, 403);
    }

    const body = await c.req.json();
    const { price } = body;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      return c.json({ success: false, message: '非法价格数值' }, 400);
    }
    
    // 1. 保存会员定价专门键值对
    await DB.prepare("INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)")
      .bind('pro_membership_price', priceNum.toString())
      .run();

    // 2. 将此价格一并覆写更新至全局 price 字段上 (支持任何包含 price 字段的列)
    try {
      await DB.prepare("UPDATE system_configs SET price = ?")
        .bind(priceNum.toString())
        .run();
    } catch(e) {
      console.log("[Sync Warning Worker] system_configs table does not contain inline price column, ignoring.");
    }

    console.log(`[Admin Control Worker] PRO 会员价格已被管理员 ${user.email} 升级为 ${priceNum}`);
    return c.json({ success: true, message: '会员价格更新成功', price: priceNum });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '系统错误' }, 500);
  }
});

// 3. 用户提交转账核验申请订单
apiApp.post('/orders', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '请先登录账号后提交转账记录' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期，请重新登录' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }

    const body = await c.req.json();
    const { paymentMethod, amount, voucherName, voucherScreenshot } = body;
    if (!voucherName) {
      return c.json({ success: false, message: '请填写转账昵称或支付凭证号以供比对' }, 400);
    }

    const orderId = `ord_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();
    
    await DB.prepare("INSERT INTO orders (id, user_id, email, payment_method, amount, voucher_name, voucher_screenshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(orderId, user.id, user.email, paymentMethod || '微信/支付宝', amount || 399, voucherName, voucherScreenshot || '', 'pending', createdAt)
      .run();

    console.log(`[Order Processing Worker] 用户 ${user.email} 新提交一笔订单: ID=${orderId}, 凭证=${voucherName}`);
    return c.json({ success: true, message: '账单凭证提交成功！系统管理员核款确收后会自动极速升级您的账号。', orderId });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '账单提交异常' }, 500);
  }
});

// 4. 获取订单记录
apiApp.get('/orders', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }

    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    let ordersData: any;
    if (isAdmin) {
      ordersData = await DB.prepare("SELECT * FROM orders").all();
    } else {
      ordersData = await DB.prepare("SELECT * FROM orders WHERE user_id = ?").bind(user.id).all();
    }

    const rawOrders = Array.isArray(ordersData) ? ordersData : (ordersData?.results || []);
    const sortedOrders = [...rawOrders].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json({ success: true, orders: sortedOrders });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '系统错误' }, 500);
  }
});

// 5. 超级管理员：一键手动审批或作废订单
apiApp.post('/orders/approve', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }
    const isAdmin = user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim());
    if (!isAdmin) {
      return c.json({ success: false, message: '无管理员操作权限' }, 403);
    }

    const body = await c.req.json();
    const { orderId, status } = body;
    if (!orderId || !status) {
      return c.json({ success: false, message: '订单ID和状态(status)为必填项' }, 400);
    }

    const order = await DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) {
      return c.json({ success: false, message: '目标账单未找到' }, 404);
    }

    const updatedAt = new Date().toISOString();
    await DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, updatedAt, orderId)
      .run();

    if (status === 'success') {
      const expiration = new Date();
      expiration.setFullYear(expiration.getFullYear() + 1); // 账期 1 年 (Annual)
      const expiresStr = expiration.toISOString();

      await DB.prepare("UPDATE users SET vip_level = 'pro', vip_expires_at = ? WHERE id = ?")
        .bind(expiresStr, order.user_id)
        .run();
        
      console.log(`[Admin Action Worker] 订单审核通过，成功赋权(年度): 用户=${order.email}, 到期时间=${expiresStr}`);
    } else {
      console.log(`[Admin Action Worker] 订单审核拒绝/作废: ID=${orderId}, 申请者=${order.email}`);
    }

    return c.json({ success: true, message: `账单已审核更新为: ${status === 'success' ? '已支付过账' : '异常拒绝'}` });
  } catch (e: any) {
    return c.json({ success: false, message: e.message || '审核处理异常' }, 500);
  }
});

/**
 * --- 坐标转换计算核心 (移植自 server.ts) ---
 */
const PI = 3.1415926535897932384626;
const A = 6378137.0;
const EE = 0.00669342162296594323;

function getDistance(lng1: number, lat1: number, lng2: number, lat2: number) {
  const radLat1 = lat1 * PI / 180.0;
  const radLat2 = lat2 * PI / 180.0;
  const a = radLat1 - radLat2;
  const b = (lng1 * PI / 180.0) - (lng2 * PI / 180.0);
  let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));
  return s * 6378137.0;
}

function transformLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y * PI / 12.0) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function gcj02_to_wgs84(lng: number, lat: number) {
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

function wgs84_to_gcj02(lng: number, lat: number) {
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

function bd09_to_gcj02(bd_lon: number, bd_lat: number) {
  const x_pi = PI * 3000.0 / 180.0;
  const x = bd_lon - 0.0065;
  const y = bd_lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

/**
 * 依据 POI 的类别与名称特征进行归类分发
 */
function classifyPoi(poi: any): string {
  const type = (poi.type || '').toLowerCase();
  const name = (poi.name || '').toLowerCase();
  
  if (
    type.includes('学校') || type.includes('幼儿园') || type.includes('小学') || 
    type.includes('中学') || type.includes('大学') || type.includes('高等院校') || 
    type.includes('培训') || type.includes('科研') || type.includes('教育') || 
    name.includes('小学') || name.includes('中学') || name.includes('大学') || 
    name.includes('幼儿园') || name.includes('学校')
  ) {
    return '学校';
  }
  
  if (
    type.includes('医院') || type.includes('诊所') || type.includes('医疗') || 
    type.includes('急救') || type.includes('卫生院') || type.includes('药店') || 
    type.includes('疾病预防') || name.includes('医院') || name.includes('诊所') || 
    name.includes('康复中心') || name.includes('社区卫生')
  ) {
    return '医院';
  }
  
  if (
    type.includes('加油站') || type.includes('气站') || type.includes('加气站') || 
    type.includes('充电站') || type.includes('加氢站') || name.includes('加油站') || 
    name.includes('加气站') || name.includes('充电站')
  ) {
    return '加油站';
  }
  
  if (
    type.includes('政府') || type.includes('办事处') || type.includes('公安') || 
    type.includes('派出所') || type.includes('税务') || type.includes('民政') || 
    type.includes('公厕') || type.includes('垃圾转运') || type.includes('消防') || 
    type.includes('居委会') || type.includes('公共服务') || type.includes('社会团体') || 
    type.includes('大厅') || name.includes('政府') || name.includes('办事处') || 
    name.includes('居委会') || name.includes('派出所') || name.includes('服务中心')
  ) {
    return '公共服务设施';
  }
  
  if (
    type.includes('住宅') || type.includes('小区') || type.includes('居民') || 
    type.includes('生活区') || type.includes('公寓') || type.includes('新村') || 
    type.includes('别墅') || type.includes('社区') || type.includes('家属院') || 
    name.includes('小区') || name.includes('家园') || name.includes('公寓') || 
    name.includes('住宅') || name.includes('花园') || name.includes('新村')
  ) {
    return '居民区';
  }
  
  if (
    type.includes('商场') || type.includes('百货') || type.includes('超市') || 
    type.includes('购物') || type.includes('商业') || type.includes('市场') || 
    type.includes('写字楼') || type.includes('步行街') || type.includes('专卖店') || 
    name.includes('商场') || name.includes('购物中心') || name.includes('广场') || 
    name.includes('百货') || name.includes('超市') || name.includes('写字楼')
  ) {
    return '商场';
  }
  
  return '其他';
}

/**
 * ---【核心业务逻辑】分析与测算 ---
 */
apiApp.post('/analyze', checkUsageLimit, async (c) => {
  const body = await c.req.json();
  const { apiKeys, origin, targetMin, factor, coordSystem, entrySpeed, entryPenalty } = body;

  if (!apiKeys || apiKeys.length === 0) return c.json({ error: 'Missing API Keys' }, 400);

  let [inputLng, inputLat] = origin;
  let gcjLng: number, gcjLat: number;
  if (coordSystem === 'BD-09') [gcjLng, gcjLat] = bd09_to_gcj02(inputLng, inputLat);
  else if (coordSystem === 'WGS-84') [gcjLng, gcjLat] = wgs84_to_gcj02(inputLng, inputLat);
  else { gcjLng = inputLng; gcjLat = inputLat; }

  const radius = Math.min(Math.floor(targetMin * 800 * 1.5), 7500);
  const trailPoints: [number, number, number][] = [];
  const anchors: string[] = [];
  const poiMap = new Map<string, any>();

  // A.1 周边扫描 (使用 Fetch 替代 Axios)
  const aroundUrl = 'https://restapi.amap.com/v3/place/around';
  for (let page = 1; page <= 8; page++) { // Workers 限制并发/时间，适度减小
    const key = apiKeys[(page - 1) % apiKeys.length];
    try {
      const res = await fetch(`${aroundUrl}?key=${key}&location=${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}&radius=${radius}&offset=50&page=${page}`);
      const data: any = await res.json();
      if (data.status === '1' && data.pois) {
        data.pois.forEach((poi: any) => {
          poiMap.set(poi.location, poi);
          anchors.push(poi.location);
        });
        if (data.pois.length < 50) break;
      } else break;
    } catch (e) { break; }
  }

  // A.2 几何补盲
  for (let angle = 0; angle < 360; angle += 45) {
    for (const distStep of [0.5, 1.0, 1.3]) {
      const rad = (angle * Math.PI) / 180;
      const g_lng = gcjLng + (radius * distStep * Math.cos(rad)) / (111320 * Math.cos((gcjLat * Math.PI) / 180));
      const g_lat = gcjLat + (radius * distStep * Math.sin(rad)) / 111320;
      anchors.push(`${g_lng.toFixed(6)},${g_lat.toFixed(6)}`);
    }
  }

  const uniqueAnchors = Array.from(new Set(anchors)); // 去除 120 截取限制，实现全量测算
  const routeUrl = 'https://restapi.amap.com/v3/direction/driving';

  const routePromises = uniqueAnchors.map(async (destStr, idx) => {
    const key = apiKeys[idx % apiKeys.length];
    const strategy = idx % 2 === 0 ? 13 : 17;
    try {
      const res = await fetch(`${routeUrl}?key=${key}&origin=${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}&destination=${destStr}&strategy=${strategy}`);
      const data: any = await res.json();
      if (data.status === '1' && data.route) {
        const path = data.route.paths[0];
        let accTime = 0;
        let lastLng = gcjLng, lastLat = gcjLat;
        let hasUturn = false;

        path.steps.forEach((step: any, sIdx: number) => {
          let dur = parseInt(step.duration);
          const dist = parseInt(step.distance);
          if (step.instruction.includes('掉头')) { dur = Math.floor(dur * 0.1); hasUturn = true; }
          else if (!hasUturn && accTime < 60 && sIdx < 3 && dist > 50) { dur = Math.floor(dur * 0.3); }

          const polyline = step.polyline.split(';');
          const tStep = dur / Math.max(1, polyline.length - 1);
          polyline.forEach((p: string, j: number) => {
            const [plng, plat] = p.split(',').map(Number);
            const [wlng, wlat] = gcj02_to_wgs84(plng, plat);
            trailPoints.push([wlng, wlat, accTime + j * tStep]);
            lastLng = plng; lastLat = plat;
          });
          accTime += dur;
        });

        // 地块修正
        const [destLng, destLat] = destStr.split(',').map(Number);
        const gap = getDistance(lastLng, lastLat, destLng, destLat);
        let finalTotalTime = accTime;
        if (gap > 5) {
          const entryTime = (gap / Math.max(0.1, Number(entrySpeed || 3.0))) + Number(entryPenalty || 0);
          finalTotalTime = accTime + entryTime;
          const [wDestLng, wDestLat] = gcj02_to_wgs84(destLng, destLat);
          trailPoints.push([wDestLng, wDestLat, finalTotalTime]);
        }

        const targetSec = (targetMin * 60) / (factor || 0.8);
        if (finalTotalTime <= targetSec && poiMap.has(destStr)) {
          return poiMap.get(destStr);
        }
      }
    } catch (e) {}
    return null;
  });

  const routeResults = await Promise.all(routePromises);
  const reachedPois = routeResults.filter(Boolean);

  const poiStats: Record<string, number> = {
    '学校': 0,
    '医院': 0,
    '加油站': 0,
    '公共服务设施': 0,
    '居民区': 0,
    '商场': 0,
    '其他': 0
  };

  reachedPois.forEach((poi: any) => {
    const cat = classifyPoi(poi);
    poiStats[cat] = (poiStats[cat] || 0) + 1;
  });

  const [wgsLng, wgsLat] = gcj02_to_wgs84(gcjLng, gcjLat);

  return c.json({
    trailPoints,
    anchorCount: uniqueAnchors.length,
    poiStats,
    apiCalls: uniqueAnchors.length + 10,
    wgsOrigin: [wgsLng, wgsLat],
    remaining: c.get('remaining')
  });
});

/**
 * ---【标定计算拟合器】成果拟合模型 ---
 */
apiApp.post('/calibrate', checkUsageLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { apiKeys, samples, coordSystem } = body;
    
    if (!apiKeys || !samples || samples.length === 0) {
      return c.json({ error: '缺少秘钥或样本数据' }, 400);
    }

    const routeUrl = 'https://restapi.amap.com/v3/direction/driving';
    const results: any[] = [];

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
      try {
        const res = await fetch(`${routeUrl}?key=${key}&origin=${sLng.toFixed(6)},${sLat.toFixed(6)}&destination=${iLng.toFixed(6)},${iLat.toFixed(6)}&strategy=13`);
        const rData: any = await res.json();

        if (rData.status === '1' && rData.route) {
          const path = rData.route.paths[0];
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
      } catch (e) {}
    }

    // 2. 网格搜索寻找最优解 (Grid Search + Physical Constraints + Penalty)
    if (results.length === 0) {
      return c.json({
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

    for (let f = 0.4; f <= 1.2; f += 0.02) {
      for (let s = 1.0; s <= 15.0; s += 0.5) {
        const errors = results.map(item => {
          const simTime = (item.rawRoadTime * f) + (item.gapDist / s);
          return Math.abs(simTime - item.actualTotalTime);
        });

        errors.sort((a, b) => a - b);
        const keepCount = Math.max(1, Math.floor(errors.length * 0.8));
        const trimmedErrors = errors.slice(0, keepCount);
        const avgError = trimmedErrors.reduce((sum, e) => sum + e, 0) / keepCount;

        let penalty = 0;
        if (f > 0.95) penalty += (f - 0.95) * 500;
        if (s < 2.0) penalty += (2.0 - s) * 200;
        
        const currentScore = avgError + penalty;

        if (currentScore < minScore) {
          minScore = currentScore;
          bestFactor = f;
          bestEntrySpeed = s;
        }
      }
    }

    const finalErrors = results.map(item => {
      const simTime = (item.rawRoadTime * bestFactor) + (item.gapDist / bestEntrySpeed);
      return Math.abs(simTime - item.actualTotalTime);
    });
    finalErrors.sort((a, b) => a - b);
    const finalAvgError = finalErrors.slice(0, Math.floor(finalErrors.length * 0.8)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(finalErrors.length * 0.8));

    return c.json({
      recommendedFactor: Number(bestFactor.toFixed(2)),
      recommendedEntrySpeed: Number(bestEntrySpeed.toFixed(2)),
      averageErrorSeconds: Number(finalAvgError.toFixed(2)),
      sampleCount: results.length,
      trimmedCount: Math.floor(results.length * 0.2),
      remaining: c.get('remaining')
    });

  } catch (error: any) {
    return c.json({ error: '拟合计算失败: ' + error.message }, 500);
  }
});

/**
 * ---【导出研究成果】打包 Zip Shapefile ---
 */
apiApp.post('/export-shp', async (c) => {
  try {
    const body = await c.req.json();
    const { collection } = body;
    if (!collection) {
      return c.json({ success: false, message: '无效的研究数据要素' }, 400);
    }

    const zipArrayBuffer = await shpwrite.zip(collection);
    
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename=fire_isochrones.zip');
    return c.body(new Uint8Array(zipArrayBuffer));
  } catch (error: any) {
    console.error('[API SHP Export Exception]', error);
    return c.json({ success: false, message: error.message || '后端生成 GIS Shapefile 失败' }, 500);
  }
});

/**
 * ---【历史分析记录缓存管理器】 ---
 */

// 1. 保存当前分析的所有站点结果到 D1 数据库
apiApp.post('/history', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '请先登录账号后保存分析快照' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期，请重新登录' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(tokenData.userId).first();
    if (!user) {
      return c.json({ success: false, message: '用户不存在' }, 401);
    }

    const body = await c.req.json();
    const { name, stationsCount, results } = body;
    if (!results || !Array.isArray(results)) {
      return c.json({ success: false, message: '无效的分析结果数据，保存失败' }, 400);
    }

    const recordId = `rec_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const defaultName = name || `覆盖仿真快照 - ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;

    await DB.prepare("INSERT INTO analysis_records (id, user_id, record_name, stations_count, results_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(recordId, user.id, defaultName, stationsCount || results.length, JSON.stringify(results), createdAt)
      .run();

    console.log(`[History Worker] Account ${user.email} saved a new analysis snapshot: ${defaultName}`);
    return c.json({ success: true, message: '分析保存成功！此后可在底端控制台查看历史分析成果并拉取。', recordId });
  } catch (e: any) {
    console.error('[History Save Exception]', e);
    return c.json({ success: false, message: e.message || '系统繁忙，保存快照失败' }, 500);
  }
});

// 2. 获取当前用户全部成果列表
apiApp.get('/history', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问，请登录' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期，请重新登录' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const records = await DB.prepare("SELECT id, user_id, record_name, stations_count, created_at FROM analysis_records WHERE user_id = ?").bind(tokenData.userId).all();
    const rawRecords = Array.isArray(records) ? records : ((records as any).results || []);
    const sortedRecords = [...rawRecords].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json({ success: true, records: sortedRecords });
  } catch (e: any) {
    console.error('[History Fetch List Exception]', e);
    return c.json({ success: false, message: e.message || '读取历史快照列表失败' }, 500);
  }
});

// 3. 调阅特定成果详细信息
apiApp.get('/history/:id', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问，请登录' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const recordId = c.req.param('id');
    const record = await DB.prepare("SELECT * FROM analysis_records WHERE id = ?").bind(recordId).first();
    if (!record) {
      return c.json({ success: false, message: '该成果快照不存在' }, 404);
    }

    if (record.user_id !== tokenData.userId) {
      return c.json({ success: false, message: '越权查看其他用户成果，操作被拒绝' }, 403);
    }

    return c.json({ 
      success: true, 
      record: {
        id: record.id,
        record_name: record.record_name,
        stations_count: record.stations_count,
        results: JSON.parse(record.results_json),
        created_at: record.created_at
      }
    });
  } catch (e: any) {
    console.error('[History Record Detail Exception]', e);
    return c.json({ success: false, message: e.message || '调阅详细快照成果失败' }, 500);
  }
});

// 4. 删除特定的快照条目
apiApp.delete('/history/:id', async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, message: '未授权访问，请登录' }, 401);
    }
    const token = authHeader.split(' ')[1];
    const tokenData = verifyToken(token);
    if (!tokenData) {
      return c.json({ success: false, message: '会话已过期' }, 401);
    }
    const DB = c.env.DB;
    if (!DB) {
      return c.json({ success: false, message: 'D1 数据库未绑定' }, 500);
    }

    const id = c.req.param('id');
    const record = await DB.prepare("SELECT * FROM analysis_records WHERE id = ?").bind(id).first();
    if (!record) {
      return c.json({ success: false, message: '该分析备份不存在' }, 404);
    }

    if (record.user_id !== tokenData.userId) {
      return c.json({ success: false, message: '无权删除他人成果备份' }, 403);
    }

    await DB.prepare("DELETE FROM analysis_records WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: '快照已成功删除。' });
  } catch (e: any) {
    console.error('[History Record Delete Exception]', e);
    return c.json({ success: false, message: e.message || '删除快照成果失败' }, 500);
  }
});

// Create top-level Hono app to bundle both api routes and SPA assets fallback
const app = new Hono<{ Bindings: Bindings & { ASSETS?: any }; Variables: Variables }>();

// Route both API & static files fallback
app.route('/', apiApp);

// SPA Routing Fallback for Cloudflare Worker Assets
app.get('*', async (c) => {
  // If request begins with /api but didn't match any route, return API Not Found
  if (c.req.path.startsWith('/api')) {
    return c.json({ success: false, message: 'API Route Not Found' }, 404);
  }
  try {
    const assets = c.env.ASSETS;
    if (assets) {
      // Fetch and serve index.html directly from ASSETS
      const response = await assets.fetch(new URL('/', c.req.url).toString());
      return response;
    }
    return c.text('Cloudflare ASSETS binding not found', 500);
  } catch (err: any) {
    return c.text(`Not Found: ${err.message}`, 404);
  }
});

export default app;
