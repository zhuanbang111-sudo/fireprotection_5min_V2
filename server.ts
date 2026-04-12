import express from 'express'; // 导入 express 框架，用于构建 Web 服务器
import { createServer as createViteServer } from 'vite'; // 从 vite 中导入创建服务器的方法，用于开发环境的中间件
import path from 'path'; // 导入 Node.js 的路径处理模块
import axios from 'axios'; // 导入 axios，用于发送 HTTP 请求（调用高德 API）
import cors from 'cors'; // 导入 cors 中间件，解决跨域问题
import * as dotenv from 'dotenv'; // 导入 dotenv，用于加载环境变量

dotenv.config(); // 初始化环境变量配置

const app = express(); // 创建 express 应用实例
const PORT = 3000; // 定义服务器运行端口为 3000

app.use(cors()); // 在应用中使用跨域中间件
app.use(express.json({ limit: '50mb' })); // 配置应用解析 JSON 格式的请求体，并设置大小限制为 50MB

// --- 坐标转换工具函数 ---
const PI = 3.1415926535897932384626; // 定义圆周率常量
const A = 6378137.0; // 定义 WGS84 坐标系的半长轴
const EE = 0.00669342162296594323; // 定义 WGS84 坐标系的第一偏心率平方

// 转换纬度的内部辅助函数
function transformLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y * PI / 12.0) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

// 转换经度的内部辅助函数
function transformLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

// 将 GCJ-02 (火星坐标) 转换为 WGS-84 (地球坐标)
export function gcj02_to_wgs84(lng: number, lat: number) {
  let dlat = transformLat(lng - 105.0, lat - 35.0);
  let dlng = transformLng(lng - 105.0, lat - 35.0);
  let radlat = lat / 180.0 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  let sqrtmagic = Math.sqrt(magic);
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
  return [lng - dlng, lat - dlat];
}

// 将 BD-09 (百度坐标) 转换为 GCJ-02 (火星坐标)
export function bd09_to_gcj02(bd_lon: number, bd_lat: number) {
  const x_pi = 3.14159265358979324 * 3000.0 / 180.0;
  const x = bd_lon - 0.0065;
  const y = bd_lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi);
  const gcj_lng = z * Math.cos(theta);
  const gcj_lat = z * Math.sin(theta);
  return [gcj_lng, gcj_lat];
}

// --- API 路由接口 ---

// 处理分析请求的 POST 接口
app.post('/api/analyze', async (req, res) => {
  const { apiKeys, origin, targetMin, factor, coordSystem } = req.body; // 从请求体中解构参数
  
  // 检查是否提供了 API Key
  if (!apiKeys || apiKeys.length === 0) {
    return res.status(400).json({ error: 'Missing API Keys' });
  }

  let [lng, lat] = origin; // 获取原始经纬度
  // 如果是百度坐标系，先转换为火星坐标系 (GCJ-02)
  if (coordSystem === 'BD-09') {
    [lng, lat] = bd09_to_gcj02(lng, lat);
  }
  
  // 将火星坐标系 (GCJ-02) 转换为地球坐标系 (WGS-84)
  const [wgsLng, wgsLat] = gcj02_to_wgs84(lng, lat);

  const apiKey = apiKeys[0]; // 获取第一个 API Key（演示用途，实际可做轮询）
  const radius = Math.min(Math.floor(targetMin * 800 * 1.5), 15000); // 根据时间要求计算搜索半径，最大限制为 15km
  
  try {
    // 1. 获取周边的 POI 作为锚点
    const aroundUrl = 'https://restapi.amap.com/v3/place/around'; // 高德周边搜索接口
    const anchors: string[] = []; // 存储锚点坐标
    
    // 1.1 中心点全量搜索：尝试获取更多页的 POI (全量类型)
    for (let page = 1; page <= 3; page++) {
      const currentKey = apiKeys[(page - 1) % apiKeys.length];
      const aroundRes = await axios.get(aroundUrl, {
        params: {
          key: currentKey,
          location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
          radius,
          // 不指定 types 以获取全量 POI
          offset: 50,
          page
        }
      });

      if (aroundRes.data.status === '1' && aroundRes.data.pois && aroundRes.data.pois.length > 0) {
        aroundRes.data.pois.forEach((poi: any) => anchors.push(poi.location));
        if (aroundRes.data.pois.length < 50) break; // 最后一页
      } else {
        break;
      }
    }

    // 1.2 径向搜索优化：沿 8 个方向延伸，并在每个延伸点周边 500 米搜索 POI
    const radialPromises: Promise<void>[] = [];
    for (let angle = 0; angle < 360; angle += 45) {
      for (const distStep of [0.5, 1.0, 1.3]) {
        const rad = (angle * Math.PI) / 180;
        const g_lng = lng + (radius * distStep * Math.cos(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
        const g_lat = lat + (radius * distStep * Math.sin(rad)) / 111320;
        
        // 将延伸点本身加入锚点
        const radialPoint = `${g_lng.toFixed(6)},${g_lat.toFixed(6)}`;
        anchors.push(radialPoint);

        // 并发搜索延伸点周边 500 米的 POI
        radialPromises.push((async () => {
          try {
            const currentKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
            const res = await axios.get(aroundUrl, {
              params: {
                key: currentKey,
                location: radialPoint,
                radius: 500,
                offset: 20,
                page: 1
              }
            });
            if (res.data.status === '1' && res.data.pois) {
              res.data.pois.forEach((poi: any) => anchors.push(poi.location));
            }
          } catch (e) {
            console.error('Radial POI search error:', e);
          }
        })());
      }
    }
    await Promise.all(radialPromises);

    // 去重并限制锚点数量。增加到 150 个点以获得更精确的等时圈，同时兼顾 API 消耗。
    const uniqueAnchors = Array.from(new Set(anchors)).slice(0, 150); 
    const trailPoints: [number, number, number][] = []; // 存储路径点及其到达时间 [经度, 纬度, 时间(秒)]
    const routeUrl = 'https://restapi.amap.com/v3/direction/driving'; // 高德驾车路径规划接口

    // 2. 为每个锚点请求路径规划
    const routePromises = uniqueAnchors.map(async (dest, idx) => {
      const strategy = idx % 2 === 0 ? 13 : 17; // 交替使用不同的路径规划策略
      const currentKey = apiKeys[idx % apiKeys.length];
      try {
        const rRes = await axios.get(routeUrl, {
          params: {
            key: currentKey,
            origin: `${lng.toFixed(6)},${lat.toFixed(6)}`,
            destination: dest,
            strategy
          }
        });

        // 如果规划成功，解析路径点
        if (rRes.data.status === '1' && rRes.data.route) {
          const path = rRes.data.route.paths[0];
          let accTime = 0; // 累计时间
          path.steps.forEach((step: any) => {
            let dur = parseInt(step.duration); // 获取该路段耗时
            // 针对掉头动作进行时间修正（消防车特权模拟）
            if (step.instruction.includes('掉头') || step.action === '掉头') {
              dur = Math.floor(dur * 0.15);
            }
            const polyline = step.polyline.split(';'); // 解析路段坐标串
            const tStep = dur / Math.max(1, polyline.length - 1); // 计算每个点的平均耗时
            polyline.forEach((p: string, j: number) => {
              const [plng, plat] = p.split(',').map(Number);
              const [wlng, wlat] = gcj02_to_wgs84(plng, plat); // 转换为 WGS84 坐标
              trailPoints.push([wlng, wlat, accTime + j * tStep]); // 记录点位和时间
            });
            accTime += dur; // 累加时间
          });
        }
      } catch (e) {
        console.error('Route error:', e); // 捕获并记录路径规划错误
      }
    });

    await Promise.all(routePromises); // 等待所有路径规划请求完成

    // 返回分析结果给前端
    res.json({
      trailPoints,
      anchorCount: uniqueAnchors.length,
      apiCalls: uniqueAnchors.length + 1,
      wgsOrigin: [wgsLng, wgsLat] // 返回转换后的 WGS-84 坐标
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message }); // 捕获并返回服务器错误
  }
});

// 启动服务器的异步函数
async function startServer() {
  // 如果不是生产环境，配置 Vite 开发中间件
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares); // 使用 Vite 的中间件处理前端资源
  } else {
    // 生产环境下，提供静态文件服务
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // 所有未匹配路由指向 index.html (SPA 模式)
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 监听指定端口和主机地址
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer(); // 执行启动服务器函数
