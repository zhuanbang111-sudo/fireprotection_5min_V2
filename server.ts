import express from 'express'; // 导入 express 框架，用于构建 Web 服务器，处理路由和中间件
import { createServer as createViteServer } from 'vite'; // 从 vite 模块导入创建服务器的方法，用于在开发环境下支持热更新和前端构建
import path from 'path'; // 导入 Node.js 原生的路径处理模块，用于处理跨平台的目录和文件路径
import axios from 'axios'; // 导入 axios 库，用于在服务器端发起向高德地图 API 的 HTTP 网络请求
import cors from 'cors'; // 导入 cors 中间件，用于处理跨域资源共享，允许前端页面跨域访问分析接口
import * as dotenv from 'dotenv'; // 导入 dotenv 库，用于从本地 .env 文件中加载环境变量到 process.env

dotenv.config(); // 执行配置加载，确保服务器能够读取到 API Key 等敏感环境变量

const app = express(); // 初始化一个 Express 应用程序实例
const PORT = 3000; // 设置服务器运行的监听端口号

app.use(cors()); // 在应用程序全局启用 CORS 中间件，允许所有来源的跨域请求
app.use(express.json({ limit: '50mb' })); // 配置中间件解析 JSON 格式的请求体，并将接收上限设置为 50MB，以支持大批量站点数据上传

// --- 坐标转换工具函数区域 ---
// 用于处理 WGS84、GCJ02 (火星) 和 BD09 (百度) 坐标系之间的相互转换数学算法
const PI = 3.1415926535897932384626; // 定义圆周率常量
const A = 6378137.0; // WGS84 坐标系下的地球长半轴参数（单位：米）
const EE = 0.00669342162296594323; // WGS84 坐标系下的地球第一偏心率平方值

// 坐标转换内部使用的辅助函数：计算纬度偏差值
function transformLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)); // 基础二次多项式拟合
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 叠加正弦波干扰项
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0; // 继续叠加中频正弦波
  ret += (160.0 * Math.sin(y * PI / 12.0) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0; // 叠加低频大幅度波形
  return ret; // 返回计算后的纬度偏移结果
}

// 坐标转换内部使用的辅助函数：计算经度偏差值
function transformLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)); // 基础线性及二次映射
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 添加经度向的高频抖动矫正
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0; // 添加中频抖动矫正
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0; // 添加大幅度低频抖动矫正
  return ret; // 返回计算后的经度偏移结果
}

// 将 GCJ-02 (即高德/火星坐标) 转换为 WGS-84 (地球标准真实坐标)
export function gcj02_to_wgs84(lng: number, lat: number) {
  let dlat = transformLat(lng - 105.0, lat - 35.0); // 调用辅助函数计算当前的纬度偏移角度
  let dlng = transformLng(lng - 105.0, lat - 35.0); // 调用辅助函数计算当前的经度偏移角度
  let radlat = lat / 180.0 * PI; // 将输入的纬度转换为弧度制，用于后续三角函数运算
  let magic = Math.sin(radlat); // 计算纬度的正弦值
  magic = 1 - EE * magic * magic; // 结合偏心率计算中间变量
  let sqrtmagic = Math.sqrt(magic); // 对中间变量进行开方运算
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI); // 将纬度偏移值从米转换为地球维度距离
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI); // 将经度偏移值根据所在纬度圈半径进行转换
  return [lng - dlng, lat - dlat]; // 使用输入的坐标减去偏移量，反推得到 WGS-84 真实坐标
}

// 将 BD-09 (百度地图坐标) 转换为 GCJ-02 (高德/火星坐标)
export function bd09_to_gcj02(bd_lon: number, bd_lat: number) {
  const x_pi = 3.14159265358979324 * 3000.0 / 180.0; // 定义百度坐标转换专用的圆周率常数
  const x = bd_lon - 0.0065; // 初步减去百度坐标系的偏移常量
  const y = bd_lat - 0.006; // 初步减去坐标系的偏移常量
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi); // 计算极坐标系中的半径 z，并施加正弦波分量
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi); // 计算极坐标系中的方位角，并施加余弦波分量
  const gcj_lng = z * Math.cos(theta); // 重新投影到直角坐标系的经度
  const gcj_lat = z * Math.sin(theta); // 重新投影到直角坐标系的纬度
  return [gcj_lng, gcj_lat]; // 返回转换后的火星坐标对
}

// --- 业务 API 路由处理中心 ---

// 这里是全量消防分析的核心接口。前端通过 POST 请求发送参数。
app.post('/api/analyze', async (req, res) => {
  const { apiKeys, origin, targetMin, factor, coordSystem } = req.body; // 从请求数据中获取：API Key 列表、中心点、时长要求、优化系数和原始坐标系类型
  
  // 基础校验：如果没有提供 API Key，分析无法进行，直接截断请求
  if (!apiKeys || apiKeys.length === 0) {
    return res.status(400).json({ error: 'Missing API Keys' });
  }

  // 第一阶段：坐标对齐与先行转换。
  // 按照要求，无论初始输入是百度 (BD-09) 还是高德 (GCJ-02)，都先行确立其对应的 WGS-84 标准坐标。
  let [inputLng, inputLat] = origin; 
  let gcjLng: number, gcjLat: number;

  if (coordSystem === 'BD-09') {
    // 如果是百度坐标，首先转换为火星坐标 (GCJ-02) 作为中间步骤
    [gcjLng, gcjLat] = bd09_to_gcj02(inputLng, inputLat);
  } else {
    // 否则默认为火星坐标 (GCJ-02)
    [gcjLng, gcjLat] = [inputLng, inputLat];
  }

  // 先行计算出 WGS-84 标准坐标（响应用户要求：无论何种输入都先行转为 WGS84）
  const [wgsLng, wgsLat] = gcj02_to_wgs84(gcjLng, gcjLat);

  // 初步估算搜索半径：核心逻辑是 5 分钟时间，按 800 米/分钟的保守速度，并留出 50% 的宽裕度，最高锁定 15 公里。
  const radius = Math.min(Math.floor(targetMin * 800 * 1.5), 15000); 
  
  try {
    // 任务 A: 智能锚点获取逻辑
    const aroundUrl = 'https://restapi.amap.com/v3/place/around'; // 高德周边搜索的 API 端点
    const anchors: string[] = []; // 初始化用于规划路径的采样点池子
    
    // A.1: 深度广域搜索。对中心点周边进行 3 页翻页操作，总计获取约 150 个 POI，确保基础点位分布密度。
    for (let page = 1; page <= 3; page++) {
      const currentKey = apiKeys[(page - 1) % apiKeys.length]; // 在多组授权 Key 之间自动进行轮询切换，防止单账号被封禁
      const aroundRes = await axios.get(aroundUrl, {
        params: {
          key: currentKey,
          location: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`, // 使用对齐后的火星坐标进行 API 搜索
          radius: radius, // 搜索半径
          offset: 50, // 每页获取 50 个点
          page: page // 指定页码
        }
      });

      // 如果高德 API 成功返回数据
      if (aroundRes.data.status === '1' && aroundRes.data.pois && aroundRes.data.pois.length > 0) {
        aroundRes.data.pois.forEach((poi: any) => anchors.push(poi.location)); // 提取经纬度字符串，塞入采样池
        if (aroundRes.data.pois.length < 50) break; // 如果返回数据已经不到 50 条，说明拿完了，提前跳出循环节省额度
      } else {
        break; // 出错或无数据则停止
      }
    }

    // A.2: 径向补盲搜索。沿着 8 个主罗盘方向延伸，并在每个延伸点的核心区域也进行采集。
    const radialPromises: Promise<void>[] = []; // 创建用于存放径向异步搜索的 Promise 集合
    for (let angle = 0; angle < 360; angle += 45) { // 遍历 0, 45, 90... 等 8 个方位
      for (const distStep of [0.5, 1.0, 1.3]) { // 分别在半径路径的半程、全程、及溢出区设点
        const rad = (angle * Math.PI) / 180; // 方向转换为弧度
        // 计算延伸点的物理经纬度 (GCJ-02)
        const g_lng = gcjLng + (radius * distStep * Math.cos(rad)) / (111320 * Math.cos((gcjLat * Math.PI) / 180));
        const g_lat = gcjLat + (radius * distStep * Math.sin(rad)) / 111320;
        
        const radialPoint = `${g_lng.toFixed(6)},${g_lat.toFixed(6)}`; // 格式化为坐标点字符串
        anchors.push(radialPoint); // 将生成的虚拟点也作为分析锚点，确保即使没有 POI 也能有路网模拟

        // 同步在这些径向采样点周边 500 米搜索当地最活跃的 POI，加强等时圈末端的形状表现
        radialPromises.push((async () => {
          try {
            const currentKey = apiKeys[Math.floor(Math.random() * apiKeys.length)]; // 随机抽取一把钥匙开门
            const res = await axios.get(aroundUrl, { // 再次发起周边搜索
              params: {
                key: currentKey,
                location: radialPoint,
                radius: 500, // 搜索小圆内的兴趣点
                offset: 20,
                page: 1
              }
            });
            if (res.data.status === '1' && res.data.pois) {
              res.data.pois.forEach((poi: any) => anchors.push(poi.location)); // 加入最终大名单
            }
          } catch (e) {
            console.error('Radial POI search error (Skip):', e); // 如果单次补盲失败，打印日志并跳过，不影响全局
          }
        })());
      }
    }
    await Promise.all(radialPromises); // 并行处理完所有 24 个径向补盲任务

    // 锚点收拢与精炼：通过 Set 结构自动去除重复的经纬度字符串，并选取前 150 个最具分析价值的点发送至高德
    const uniqueAnchors = Array.from(new Set(anchors)).slice(0, 150); 
    const trailPoints: [number, number, number][] = []; // 最终结果集，每项包含 [标准经度, 标准纬度, 到达耗时(秒)]
    const routeUrl = 'https://restapi.amap.com/v3/direction/driving'; // 高德强大的实时驾车路径规划终端

    // 任务 B: 路径时空模拟。针对名单上的 150 个目的地发起单点分析请求。
    const routePromises = uniqueAnchors.map(async (dest, idx) => {
      const strategy = idx % 2 === 0 ? 13 : 17; // 策略交替使用方案 13 (多路口考虑) 和 17 (速度最快)，增加地理样本差异性
      const currentKey = apiKeys[idx % apiKeys.length]; // 密钥轮番上阵，应对高并发高负载
      try {
        const rRes = await axios.get(routeUrl, {
          params: {
            key: currentKey,
            origin: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`, // 使用对齐的高德坐标作为出发点
            destination: dest, // 每一个锚点作为终点
            strategy: strategy // 设置导航策略
          }
        });

        // 路径解析核心逻辑：不仅看终点耗时，更要看路径上的每一个弯道细节点及其耗时，这对生成精确等时圈至关重要
        if (rRes.data.status === '1' && rRes.data.route) {
          const path = rRes.data.route.paths[0]; // 获取规划的第一条路线
          let accTime = 0; // 累计已行驶时间
          path.steps.forEach((step: any) => {
            let dur = parseInt(step.duration); // 获取该小节路段在高德大数据下的预测耗时
            
            // 重要：消防业务模型修正。消防车在复杂调度（如掉头）时受物理限制小，通过修正系数模拟消防特权。
            if (step.instruction.includes('掉头') || step.action === '掉头') {
              dur = Math.floor(dur * 0.15); // 将掉头动作的时间评估强制压缩至 15%，体现快速响应能力
            }
            
            const polyline = step.polyline.split(';'); // 将路段中包含的多个拐点坐标切分为数组
            const tStep = dur / Math.max(1, polyline.length - 1); // 计算每个轨迹点平均分到的时长负载
            
            polyline.forEach((p: string, j: number) => {
              const [plng, plat] = p.split(',').map(Number); // 解析出拐点当前的火星经纬度
              const [wlng, wlat] = gcj02_to_wgs84(plng, plat); // 这里是关键：将每一个轨迹点全部转为 WGS-84 地球坐标系，完成数据重塑
              trailPoints.push([wlng, wlat, accTime + j * tStep]); // 保存轨迹节点的地理属性及其被覆盖测算的时长属性
            });
            accTime += dur; // 汇总这一路段总时长到任务总额中
          });
        }
      } catch (e) {
        console.error('Route path simulation failed (Skip):', e); // 只要多数点路径模拟成功，单个点失败不影响大盘，此处选择容错
      }
    });

    await Promise.all(routePromises); // 集火等待，这通常是整个后端最耗时的步骤，约需数秒

    // 任务 C: 成果打包。将清洗后的数据、统计数和中心点标准位置一并吐给前端展示。
    res.json({
      trailPoints: trailPoints, // 海量的时空元数据，前端将基于此进行空间差值运算生成等时圈多边形
      anchorCount: uniqueAnchors.length, // 反馈实际成功处理了多少个有效锚点
      apiCalls: uniqueAnchors.length + 2, // 数据指标，便于管理员估算 API 余额消耗状况
      wgsOrigin: [wgsLng, wgsLat] // 特别传回中心点的 WGS84 原始位姿，用于地图图层校准
    });

  } catch (error: any) {
    // 处理各种不可抗力（如 API 全线封禁、网络崩溃、数学溢出等）
    console.error('SERVER LEVEL CRITICAL ERROR:', error.message);
    res.status(500).json({ error: '分析引擎出错，请检查 KEY 是否正确并重试' }); 
  }
});

// 开发/生产同构服务器启动流程逻辑
async function startServer() {
  // 如果当前是非生产环境，挂载 Vite 实时热更新中间件，这能让开发者修改代码后在几秒内就能同步到浏览器
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true }, // 告诉 Vite 作为中间件嵌入其它服务器
      appType: 'spa', // 定制应用类型为 Single Page Application
    });
    app.use(vite.middlewares); // 将 Vite 的处理管线对接到系统主流程中
  } else {
    // 生产环境中，系统直接从编译好的 dist 硬盘目录读取浏览器能识别的文件，追求极致性能
    const distPath = path.join(process.cwd(), 'dist'); // 定位编译输出包的位置
    app.use(express.static(distPath)); // 开启文件传输权限
    
    // 路由终结符。由于是 SPA，若用户访问的链接不存在，统一重定向回 index.html，交给 React 处理后续路由
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 开始激活服务器监听端口，对外开门营业
  app.listen(PORT, '0.0.0.0', () => {
    // 在系统终端打印标志性成功日志
    console.log(`[FIRE_STATION_ANALYZER] 引擎激活成功! 您可以在浏览器访问 http://localhost:${PORT}`);
  });
}

// 最终启动命令：执行定义好的异步初始化函数
startServer(); 
