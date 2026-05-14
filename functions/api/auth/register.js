import { createClient } from '@supabase/supabase-js';

export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ success: false, message: 'Cloudflare 环境变量未配置' }), { status: 503 });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  
  try {
    const { email, password, displayName } = await request.json();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName } }
    });

    if (error) throw error;
    if (!data.user) throw new Error('注册未返回用户信息');

    return new Response(JSON.stringify({
      success: true,
      user: {
        uid: data.user.id,
        email: data.user.email,
        displayName: displayName || '新用户'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message }), { status: 400 });
  }
}
