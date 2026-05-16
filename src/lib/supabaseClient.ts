import { createClient } from '@supabase/supabase-js'

// Vite 架构使用 import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("⚠️ Supabase 环境变量缺失，请检查 .env 配置")
}

// 初始化客户端
// 确保 URL 结尾没有多余的斜杠，防止 Supabase Auth 报错 (invalid claim: slash in issuer)
const sanitizedUrl = supabaseUrl?.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
export const supabase = createClient(sanitizedUrl || '', supabaseAnonKey || '')
