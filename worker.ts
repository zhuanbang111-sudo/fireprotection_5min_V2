import { Hono } from 'hono';
import crypto from 'node:crypto';

type Bindings = {
  DB: any;
};

type Variables = {
  remaining: number;
  user?: any;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath('/api');

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
app.all('/health', (c) => {
  const hasDB = !!c.env.DB;
  return c.json({
    status: 'ok',
    environment: 'cloudflare-workers',
    database_bound: hasDB,
    time: new Date().toISOString()
  });
});

// 一键演示登录
app.post('/auth/instant', async (c) => {
  return c.json({ 
    success: true, 
    user: { 
      uid: 'demo-999', 
      email: 'demo@fire-engineer.local', 
      displayName: '演示专家/指挥官',
      isTrial: true,
      remaining: MAX_DEMO_USAGE - demoUsageCount
    } 
  });
});

// 1. 用户注册
app.post('/auth/register', async (c) => {
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

    await DB.prepare("INSERT INTO users (id, email, password_hash, displayName, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, lowerEmail, pHash, dName, createdAt)
      .run();

    const token = generateToken(userId);
    console.log(`[D1 Auth Worker] 新用户注册成功: ${lowerEmail}`);

    return c.json({
      success: true,
      user: {
        uid: userId,
        email: lowerEmail,
        displayName: dName,
        isTrial: false,
        vip_level: 'free',
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
app.post('/auth/login', async (c) => {
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

    return c.json({
      success: true,
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        isTrial: false,
        vip_level: user.vip_level || 'free',
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
app.get('/auth/me', async (c) => {
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

    return c.json({
      success: true,
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        isTrial: false,
        vip_level: user.vip_level || 'free',
        vip_expires_at: user.vip_expires_at || null
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: '自核验异常' }, 500);
  }
});

// 4. 用户 VIP 激活与升级
app.post('/auth/upgrade', async (c) => {
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

    console.log(`[D1 Auth Worker] 用户 VIP 已成功激活: ${user.email}`);

    return c.json({
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
    console.error('[D1 Auth Worker] 升级核心异常:', error);
    return c.json({ success: false, message: error.message || '激活失败' }, 500);
  }
});

// 5. 用户反馈提交
app.post('/feedback', async (c) => {
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
 * ---【核心业务逻辑】分析与测算 ---
 */
app.post('/analyze', checkUsageLimit, async (c) => {
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

  // A.1 周边扫描 (使用 Fetch 替代 Axios)
  const aroundUrl = 'https://restapi.amap.com/v3/place/around';
  for (let page = 1; page <= 8; page++) { // Workers 限制并发/时间，适度减小
    const key = apiKeys[(page - 1) % apiKeys.length];
    try {
      const res = await fetch(`${aroundUrl}?key=${key}&location=${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}&radius=${radius}&offset=50&page=${page}`);
      const data: any = await res.json();
      if (data.status === '1' && data.pois) {
        data.pois.forEach((poi: any) => anchors.push(poi.location));
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

  const uniqueAnchors = Array.from(new Set(anchors)).slice(0, 120); // 限制点数确保 Workers 不会超时
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
        if (gap > 5) {
          const entryTime = (gap / Math.max(0.1, Number(entrySpeed || 3.0))) + Number(entryPenalty || 0);
          const [wDestLng, wDestLat] = gcj02_to_wgs84(destLng, destLat);
          trailPoints.push([wDestLng, wDestLat, accTime + entryTime]);
        }
      }
    } catch (e) {}
  });

  await Promise.all(routePromises);
  const [wgsLng, wgsLat] = gcj02_to_wgs84(gcjLng, gcjLat);

  return c.json({
    trailPoints,
    anchorCount: uniqueAnchors.length,
    wgsOrigin: [wgsLng, wgsLat],
    remaining: c.get('remaining')
  });
});

export default app;
