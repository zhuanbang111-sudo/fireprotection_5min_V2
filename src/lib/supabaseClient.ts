import { createClient } from '@supabase/supabase-js'

/**
 * 消防专家系统 - Supabase 客户端配置
 */

const DEFAULT_URL = 'https://puzkestptayrjldqjrcb.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1emtlc3RwdGF5cmpsZHFqcmNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mzg4MDAsImV4cCI6MjA5NDMxNDgwMH0.NLJ6sLz_1zUTetS7CfSs3bGwlZb9q6KWUVWGLIG4LDM';

// 提取环境变量，如果未定义则使用默认值
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;

// 在客户端初始化前进行严格校验
if (!supabaseUrl) {
  console.error('[Supabase Error]: 缺少 VITE_SUPABASE_URL 环境变量');
  throw new Error('Supabase 初始化失败：未配置项目 URL。请检查环境变量设置。');
}

if (!supabaseAnonKey) {
  console.error('[Supabase Error]: 缺少 VITE_SUPABASE_ANON_KEY 环境变量');
  throw new Error('Supabase 初始化失败：未配置匿名密钥（Anon Key）。请检查环境变量设置。');
}

// 规范化 URL（去除末尾的斜杠）
const normalizedUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;

console.log('[FireEngineer] Supabase Provider init with URL:', normalizedUrl);

// 初始化并导出客户端
export const supabase = createClient(normalizedUrl, supabaseAnonKey);
