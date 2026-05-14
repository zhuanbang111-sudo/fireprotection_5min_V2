export async function onRequest(context) {
  const { env } = context;
  
  // 检查环境变量是否已配置
  const hasSupabase = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  const hasAmap = !!env.AMAP_KEYS;

  return new Response(JSON.stringify({
    status: 'ok',
    environment: 'cloudflare-pages',
    supabase: hasSupabase,
    amap: hasAmap,
    time: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
