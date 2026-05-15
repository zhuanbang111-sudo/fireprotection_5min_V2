import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages'; // 虽然是 Workers，但 Hono 的 Pages 处理逻辑也非常通用
import { createClient } from '@supabase/supabase-js';

const app = new Hono().basePath('/api');

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

// 登录接口
app.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json();
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return c.json({ success: false, message: error.message }, 401);

  return c.json({
    success: true,
    user: {
      uid: data.user.id,
      email: data.user.email,
      displayName: data.user.user_metadata?.full_name || data.user.email
    }
  });
});

// 注册接口
app.post('/auth/register', async (c) => {
  const { email, password, displayName } = await c.req.json();
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName } }
  });

  if (error) return c.json({ success: false, message: error.message }, 400);

  return c.json({
    success: true,
    user: {
      uid: data.user?.id,
      email: data.user?.email,
      displayName: displayName || '新用户'
    }
  });
});

// 批量路网分析代理 (处理跨域和 Key 隐藏)
app.post('/analyze', async (c) => {
  const body = await c.req.json();
  const { apiKeys, origin, targetMin } = body;

  if (!apiKeys || apiKeys.length === 0) return c.json({ error: 'Missing API Keys' }, 400);

  // 这里可以继续迁移 server.ts 中的复杂逻辑
  // 考虑到 Workers 的 30s 运行时限制，建议复杂计算依然由前端 axios 调用高德，后端仅做 Auth
  return c.json({ message: 'Workers Proxy Active' });
});

export default app;
