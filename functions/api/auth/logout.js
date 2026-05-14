import { createClient } from '@supabase/supabase-js';

export async function onRequestPost(context) {
  const { env } = context;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  
  try {
    await supabase.auth.signOut();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500 });
  }
}
