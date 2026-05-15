import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages'; // 虽然是 Workers，但 Hono 的 Pages 处理逻辑也非常通用
import { createClient } from '@supabase/supabase-js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

type Variables = {
  remaining: number;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath('/api');

// 健康检查
app.all('/health', (c) => {
  const hasSupabase = !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY);
  return c.json({
    status: 'ok',
    environment: 'cloudflare-workers',
    supabase: hasSupabase,
    time: new Date().toISOString()
  });
});

// 演示账户限额 (Workers 内存不持久，仅供同一实例内简单演示)
let demoUsageCount = 0;
const MAX_DEMO_USAGE = 5;

// 快速试用接口
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

// 分析接口限额中间件
const checkUsageLimit = async (c: any, next: any) => {
  const userId = c.req.header('x-user-id');
  if (userId === 'demo-999') {
    if (demoUsageCount >= MAX_DEMO_USAGE) {
      return c.json({ 
        success: false, 
        message: `快速试用额度已用尽（共 ${MAX_DEMO_USAGE} 次），请注册账号继续使用完整功能` 
      }, 403);
    }
    demoUsageCount++;
    console.log(`[Limit] Demo user usage: ${demoUsageCount}/${MAX_DEMO_USAGE}`);
    c.set('remaining', MAX_DEMO_USAGE - demoUsageCount);
  }
  await next();
};

// 批量路网分析代理 (处理跨域和 Key 隐藏)
app.post('/analyze', checkUsageLimit, async (c) => {
  const body = await c.req.json();
  const { apiKeys } = body;

  if (!apiKeys || apiKeys.length === 0) return c.json({ error: 'Missing API Keys' }, 400);

  const remaining = c.get('remaining');
  return c.json({ 
    message: 'Workers Proxy Active',
    remaining
  });
});

export default app;
