import { createClient } from '@supabase/supabase-js'

// Vite 架构使用 import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 检查是否为无效的占位符或空值
const isEnvValid = (val: any) => {
  if (!val) return false;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null' || trimmed.includes('your-short-code')) return false;
  return true;
};

const sanitizedUrl = isEnvValid(supabaseUrl) ? (supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl) : null;
const finalAnonKey = isEnvValid(supabaseAnonKey) ? supabaseAnonKey : null;

/**
 * 核心逻辑：如果环境变量缺失，我们不直接调用 createClient（这会导致 SDK 内部抛出异常并使整个 App 崩溃）。
 */
const createSafeClient = () => {
  if (!sanitizedUrl || !finalAnonKey) {
    console.warn("=== Supabase 客户端初始化检查 ===");
    console.warn("⚠️ 环境变量缺失或无效，Auth 功能将不可用。");
    console.warn("需配置: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
    
    return {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: (cb: any) => {
          setTimeout(() => cb('INITIAL_SESSION', null), 0);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithPassword: async () => ({ error: new Error('未配置 Supabase，无法登录') }),
        signUp: async () => ({ error: new Error('未配置 Supabase，无法注册') }),
        signOut: async () => ({ error: null }),
      }
    } as any;
  }
  
  return createClient(sanitizedUrl, finalAnonKey);
}

// 初始化并导出客户端
export const supabase = createSafeClient();
