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

-- 3. 升级路径：如果已有旧表但没有 VIP 字段，请单独执行以下列添加语句（D1 会自动忽略已存在的列或报错）：
-- ALTER TABLE users ADD COLUMN vip_level TEXT DEFAULT 'free';
-- ALTER TABLE users ADD COLUMN vip_expires_at TEXT DEFAULT NULL;
