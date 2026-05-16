import { createClient } from '@supabase/supabase-js'

// Vite 架构使用 import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const sanitizedUrl = supabaseUrl?.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;

/**
 * 核心逻辑：如果环境变量缺失，我们不直接调用 createClient（这会导致 SDK 内部抛出异常并使整个 App 崩溃）。
 * 相反，我们返回一个具有相同接口结构的“安全 Mock 对象”，它仅在真正调用时打印警告，从而保证应用能够正常渲染展示，
 * 方便用户看到非登录态的预览界面，并修复由于 top-level 崩溃导致的无法进入应用的 Bug。
 */
const createSafeClient = () => {
  if (!sanitizedUrl || !supabaseAnonKey) {
    console.warn("⚠️ Supabase 环境变量缺失 [VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY]，身份验证功能将不可用。");
    
    // 构造一个满足 App 组件初始监听需求的最小化 Mock 对象
    return {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: (cb: any) => {
          // 立即触发一个 INITIAL_SESSION 事件，确保 App 中的 isAuthChecking 能正常结束
          setTimeout(() => cb('INITIAL_SESSION', null), 0);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithPassword: async () => ({ error: new Error('未配置 Supabase，无法登录') }),
        signUp: async () => ({ error: new Error('未配置 Supabase，无法注册') }),
        signOut: async () => ({ error: null }),
      }
    } as any;
  }
  
  return createClient(sanitizedUrl, supabaseAnonKey);
}

// 初始化并导出客户端
export const supabase = createSafeClient();
