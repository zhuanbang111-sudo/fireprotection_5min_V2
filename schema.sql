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

-- 5. 创建历史分析记录表（支持同账号多版本多时段结果对比与回载）
CREATE TABLE IF NOT EXISTS analysis_records (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  record_name TEXT,
  stations_count INTEGER,
  results_json TEXT, -- 存储一次性全站分析 JSON 数据对象/数组，保留等时圈和计算属性
  created_at TEXT
);

-- D1 数据库升级与创建步骤 (Cloudflare D1 Operations Command Line):
-- 步骤 A: 本地开发或测试阶段（如果使用 wrangler 本地模拟）:
--   npx wrangler d1 execute <D1_DATABASE_NAME> --local --file=./schema.sql
-- 步骤 B: 部署上线生产阶段:
--   npx wrangler d1 execute <D1_DATABASE_NAME> --remote --file=./schema.sql
-- 步骤 C: 如果属于部分增量升级，可直接单独在 D1 控制台执行：
--   CREATE TABLE IF NOT EXISTS analysis_records (id TEXT PRIMARY KEY, user_id TEXT, record_name TEXT, stations_count INTEGER, results_json TEXT, created_at TEXT);


-- 5. 升级路径：如果已有旧表但没有 VIP 字段，请单独执行以下列添加语句（D1 会自动忽略已存在的列或报错）：
-- ALTER TABLE users ADD COLUMN vip_level TEXT DEFAULT 'free';
-- ALTER TABLE users ADD COLUMN vip_expires_at TEXT DEFAULT NULL;
