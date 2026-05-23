-- Cloudflare D1 SQL Schema & Migration Script
-- 消防等时圈分析工具 V2 数据库初始化和升级脚本

-- 1. 创建用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  displayName TEXT,
  created_at TEXT,
  vip_level TEXT DEFAULT 'free',
  vip_expires_at TEXT DEFAULT NULL
);

-- 2. 创建用户反馈表
CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  content TEXT,
  screenshot TEXT,
  created_at TEXT
);

-- 3. 创建系统全局配置表
CREATE TABLE IF NOT EXISTS system_configs (
  key TEXT PRIMARY KEY,
  value TEXT,
  price TEXT -- 支持全局动态定价字段同步
);

-- 4. 创建订单管理与账单表
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  payment_method TEXT,
  amount REAL,
  voucher_name TEXT,
  voucher_screenshot TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 5. 升级路径：如果已有旧表但没有 VIP 字段，请单独执行以下列添加语句（D1 会自动忽略已存在的列或报错）：
-- ALTER TABLE users ADD COLUMN vip_level TEXT DEFAULT 'free';
-- ALTER TABLE users ADD COLUMN vip_expires_at TEXT DEFAULT NULL;
