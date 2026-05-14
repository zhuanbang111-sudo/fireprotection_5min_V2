import { createClient } from '@supabase/supabase-js';

export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ success: false, message: 'Cloudflare 环境变量未配置' }), { status: 503 });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  
  try {
    const { email, password } = await request.json();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      user: {
        uid: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.full_name || data.user.email
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message }), { status: 401 });
  }
}
