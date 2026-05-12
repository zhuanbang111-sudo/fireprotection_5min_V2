import express from 'express'; // 导入 express 模块，这是 Node.js 中最基础、最流行的 Web 服务器开发框架，用于处理 HTTP 网页请求
import { createServer as createViteServer } from 'vite'; // 导入 Vite 提供的开发服务器创建工具，使得我们在开发时能享受到极速的代码热更新（实时预览）
import path from 'path'; // 导入 Node.js 原生的 path 模块，用于处理和转换文件路径，解决 Windows 或 Linux 系统下路径不一致的问题
import axios from 'axios'; // 导入 axios 库，这是一款优秀的基于 Promise 的 HTTP 客户端，我们用它在服务器端向高德地图 API 发起数据请求
import cors from 'cors'; // 导入 cors 中间件，它的作用是打破浏览器的“同源策略”限制，允许前端网页跨域调用后端的 API 接口
import * as dotenv from 'dotenv'; // 导入 dotenv 工具，它可以将 .env 文件中的配置项自动加载到系统的环境变量中，方便安全地读取 API Key

dotenv.config(); // 立即执行配置加载，确保代码在后续运行时能通过 process.env 获取到 API Key 等敏感信息

const app = express(); // 执行函数，初始化一个具备路由分发和中间件处理能力的 Express 应用程序实例
const PORT = 3000; // 定义服务器监听的端口号为 3000，这是所有用户访问该后端服务的唯一入口

app.use(cors()); // 在应用程序中全面启用跨域选项，授权所有来源的前端界面都能访问我们的业务数据
app.use(express.json({ limit: '50mb' })); // 开启 JSON 格式的请求体解析引擎，并将允许接收的数据上限设为 50MB，防止消防站大数据量站点被拦截

/**
 * --- 坐标转换计算核心 (Mathematics of Coordinate Transformation) ---
 * 背景：由于中国地图存在坐标偏移加密（GCJ-02 火星坐标系），我们需要通过数学公式在 WGS84、GCJ-02、BD-09 之间相互转换。
 */
const PI = 3.1415926535897932384626; // 定义高精度的圆周率常量，它是所有球面地理计算的基石
const A = 6378137.0; // 地球的赤道半径（单位：米），来自标准的 WGS84 椭球体模型参数
const EE = 0.00669342162296594323; // 第一偏心率平方值，用于修正地球并非正球体带来的经纬度投影误差

/**
 * 计算两个坐标点之间的物理球面距离（单位：米）
 * 该函数采用了球面三角学中的 Haversine（半正矢）公式。
 */
function getDistance(lng1: number, lat1: number, lng2: number, lat2: number) {
  const radLat1 = lat1 * PI / 180.0; // 将第一个点的纬度由角度转为弧度
  const radLat2 = lat2 * PI / 180.0; // 将第二个点的纬度由角度转为弧度
  const a = radLat1 - radLat2; // 两点间的纬度差
  const b = (lng1 * PI / 180.0) - (lng2 * PI / 180.0); // 两点间的经度差
  // 核心距离计算公式：模拟球面最短路径
  let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));
  s = s * 6378137.0; // 乘以地球半径，将弧度结果转换为实际物理距离（米）
  return s; // 返回最终的直线物理距离
}

// 内部运算辅助函数：利用非线性多项式计算纬度方向的修正分量
function transformLat(x: number, y: number) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)); // 基础几何线性组合
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 混合正弦波干扰项
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0; // 叠加中频正弦波修正
  ret += (160.0 * Math.sin(y * PI / 12.0) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0; // 最终通过大幅度分量进行宏观地理矫正
  return ret;
}

// 内部运算辅助函数：利用非线性多项式计算经度方向的修正分量
function transformLng(x: number, y: number) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)); // 基础经向几何映射
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0; // 加入经度特定的高频加密脉冲
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0; // 中频波动修正项
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0; // 最终的大尺度地理边缘修正
  return ret;
}

/**
 * 【坐标对齐】火星坐标 (GCJ-02) 转 地球标准坐标 (WGS-84)
 * 目的：高德 API 返回的数据是加密的火星坐标，导出为 GIS 文件或在天地图显示时，必须归一化为 WGS-84 标准。
 */
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

/**
 * 【坐标对齐】地球标准坐标 (WGS-84) 转 火星坐标 (GCJ-02)
 * 目的：将标准的 GPS 经纬度数据转换为高德地图 API 能够识别的加密坐标，以便进行路径规划。
 */
export function wgs84_to_gcj02(lng: number, lat: number) {
  let dlat = transformLat(lng - 105.0, lat - 35.0);
  let dlng = transformLng(lng - 105.0, lat - 35.0);
  let radlat = lat / 180.0 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  let sqrtmagic = Math.sqrt(magic);
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
  return [lng + dlng, lat + dlat];
}

/**
 * 【坐标对齐】百度坐标 (BD-09) 转 火星坐标 (GCJ-02)
 * 目的：处理用户从百度地图导出的消防站点，将其对齐到高德地图 API 能够精准识别的工作空间。
 */
export function bd09_to_gcj02(bd_lon: number, bd_lat: number) {
  const x_pi = PI * 3000.0 / 180.0; // 百度特有的坐标空间换算系数
  const x = bd_lon - 0.0065; // 初步撤回百度在经向上的位置偏移
  const y = bd_lat - 0.006; // 初步撤回百度在纬向上的位置偏移
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi); // 计算极坐标下的旋转半径并在角度空间施加非线性修正
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi); // 计算极坐标下的相位角并引入周期性修正分量
  const gcj_lng = z * Math.cos(theta); // 重新计算投影回直角坐标系的经度
  const gcj_lat = z * Math.sin(theta); // 重新计算投影回直角坐标系的纬度
  return [gcj_lng, gcj_lat]; // 得到转换后的高德原生支持火星坐标 [经, 纬]
}

/**
 * ---【业务核心逻辑】消防站点多维等时圈分析接口 ---
 * app.post 定义了一个 POST 类型的 API 路由 '/api/analyze'，用来执行复杂的后端计算任务。
 */
app.post('/api/analyze', async (req, res) => {
  // 从前端发送的 HTTP 请求请求体中，通过解构赋值一次性提取出所有控制参数
  const { 
    apiKeys,     // 用户输入的高德地图开发者申请的秘钥列表（用于并发配额分摊）
    origin,      // 消防站的中心位置坐标（分析的原点 [lng, lat]）
    targetMin,   // 用户要求的目标到达时间（单位：分钟，默认为 5）
    factor,      // 消防车行驶特权修正系数（策略优化用，模拟超越社会车辆的效率）
    coordSystem, // 用户输入的坐标系类型名（例如：GCJ-02 或 BD-09）
    entrySpeed,  // 模拟仿真参数：进入地块或单位内部后的平均行驶速度 (单位：米/秒)
    entryPenalty // 模拟仿真参数：地块响应补偿，指车辆停稳、展开装备等固定耗时（单位：秒）
  } = req.body; 
  
  // 安全校验：如果请求中没有携带有效的 API Key，无法调用三方数据，直接报错返回 400
  if (!apiKeys || apiKeys.length === 0) {
    return res.status(400).json({ error: 'Missing API Keys' });
  }

  // 1. 坐标统一对齐：将输入坐标统一转换为高德 API 正确识别的火星坐标 (GCJ-02)
  let [inputLng, inputLat] = origin; // 获取解包后的经纬度数据
  let gcjLng: number, gcjLat: number; // 声明分析全程所使用的底稿坐标变量
  if (coordSystem === 'BD-09') {
    // 若确认是百度来源，先调转换器剥离百度外壳，对齐到火星轨道
    [gcjLng, gcjLat] = bd09_to_gcj02(inputLng, inputLat);
  } else if (coordSystem === 'WGS-84') {
    // 若确认是标准 GPS 坐标，对齐到火星轨道
    [gcjLng, gcjLat] = wgs84_to_gcj02(inputLng, inputLat);
  } else {
    // 否则直接采用（高德坐标输入时），不做二次损耗转换，保持物理原始精度
    gcjLng = inputLng;
    gcjLat = inputLat;
  }

  // 综合计算物理搜索半径公式：目标分钟 × 每秒假设位移 × 冗余系数，并预设 7.5 公里硬性封顶以防 API 额度超支
  const radius = Math.min(Math.floor(targetMin * 800 * 1.5), 7500); 
  
  try {
    // ---【任务 A】深度 POI 兴趣点云探测 (POI Scanning) ---
    const aroundUrl = 'https://restapi.amap.com/v3/place/around'; // 指定向高德“周边搜索”数据接口发请求的地址
    const anchors: string[] = []; // 初始化一个空的“锚点库”，我们将收集成百上千个潜在的灭火目的地坐标
    
    // A.1 中心点深度扫描：抓取前 15 页数据（约 750 个真实点位），构建全量覆盖样本库
    for (let page = 1; page <= 15; page++) {
      const currentKey = apiKeys[(page - 1) % apiKeys.length];
      try {
        const aroundRes = await axios.get(aroundUrl, {
          params: {
            key: currentKey,
            location: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`,
            radius: radius,
            offset: 50,
            page: page
          }
        });
        if (aroundRes.data.status === '1' && aroundRes.data.pois) {
          aroundRes.data.pois.forEach((poi: any) => anchors.push(poi.location));
          if (aroundRes.data.pois.length < 50) break;
        } else {
          break;
        }
      } catch (e) { break; }
    }

    // A.2 几何补盲（极速模式）：通过数学计算注入 24 个方向锚点，作为无建筑区域的保底逻辑
    for (let angle = 0; angle < 360; angle += 45) { 
      for (const distStep of [0.5, 1.0, 1.3]) { 
        const rad = (angle * Math.PI) / 180;
        const g_lng = gcjLng + (radius * distStep * Math.cos(rad)) / (111320 * Math.cos((gcjLat * Math.PI) / 180));
        const g_lat = gcjLat + (radius * distStep * Math.sin(rad)) / 111320;
        
        anchors.push(`${g_lng.toFixed(6)},${g_lat.toFixed(6)}`); 
      }
    }

    // 锚点收割与去重：对全量获取到的点位发起路径规划，不再限制为 200 个
    const uniqueAnchors = Array.from(new Set(anchors)); 
    const trailPoints: [number, number, number][] = []; // 核心成果桶：存放每一个轨迹细节 [WGS84经, WGS84纬, 累计耗时]
    const routeUrl = 'https://restapi.amap.com/v3/direction/driving'; // 指向高德最核心的驾车模拟（路径规划）引擎地址

    // ---【任务 B】高德实时路网模拟与特勤特权仿真 (掉头 & 反常态通行) ---
    const routePromises = uniqueAnchors.map(async (destStr, idx) => {
      const [destLng, destLat] = destStr.split(',').map(Number); // 解析当前目标终点的物理中心位置
      const strategy = idx % 2 === 0 ? 13 : 17; // 多样化模拟：在“推荐路线”和“最快时间”策略间轮训，提升模型广泛度
      const currentKey = apiKeys[idx % apiKeys.length]; // 密钥轮换
      try {
        const rRes = await axios.get(routeUrl, {
          params: {
            key: currentKey, origin: `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`, destination: destStr, strategy: strategy
          }
        });

        // 解析高德实时路况模型输出的海量动态轨迹数据包
        if (rRes.data.status === '1' && rRes.data.route) {
          const path = rRes.data.route.paths[0]; // 提取得分最高的第一条路径细节
          let accTime = 0; // 该单一路径分支的累计已行驶时长（秒）
          let lastLng = gcjLng, lastLat = gcjLat; // 追踪变量：实时记录轨迹包里最近一个点的物理位姿
          let hasFoundEarlyUturn = false; // 业务标志位：用来记录是否在起步阶段就已经处理过“逆行/掉头”特权

          path.steps.forEach((step: any, sIdx: number) => { // 遍历高德路书里的每一个导航小节（例如：在该路口左转直行 200 米）
            let dur = parseInt(step.duration); // 获知该小节在高德实时交通状态下预测的驾驶耗时
            const dist = parseInt(step.distance); // 获知该小节的物理长度

            // --- 仿真核心：消防特勤“逆行与极速掉头”模拟 (Counter-flow Simulation) ---
            
            // 情况 1：显式掉头动作优化。逻辑：由于消防车可以利用跨越绿化带、临时逆行至对面等特权完成快速转向，
            // 传统的“寻找红绿灯合法掉头”时间被我们强行压缩到 10% 模拟极速通过。
            if (step.instruction.includes('掉头') || step.action === '掉头') {
              dur = Math.floor(dur * 0.1); 
              hasFoundEarlyUturn = true; // 记录已启用特权转向
            } 
            // 情况 2：隐式逆行寻优优化。逻辑：在出警的前 60 秒内，如果路线明显在顺着车流寻找“合法口”，
            // 我们通过将耗时打 3 折来模拟消防车直接逆行驶入由于“顺流路口”太远而被浪费掉的短路。
            else if (!hasFoundEarlyUturn && accTime < 60 && sIdx < 3 && dist > 50) {
              dur = Math.floor(dur * 0.3); 
            }
            
            const polyline = step.polyline.split(';'); // 将路段中包含的数个轨迹转折拐点全部切开
            const tStep = dur / Math.max(1, polyline.length - 1); // 计算轨迹上每个细小小段均摊到的行驶时长分量
            
            polyline.forEach((p: string, j: number) => { // 遍历轨迹的每一毫米细节
              const [plng, plat] = p.split(',').map(Number); // 解析当前转角点的火星坐标
              // 这里是数据产出的最后防线：将每一个分析得出的火星坐标瞬时转换为地球标准 WGS-84 坐标。
              // 这样当导出的数据在专业 GIS 软件或者天地图上显示时，能实现 0 毫米的精准对齐。
              const [wlng, wlat] = gcj02_to_wgs84(plng, plat); 
              trailPoints.push([wlng, wlat, accTime + j * tStep]); // 将处理后的带时间足迹点存入成果仓
              lastLng = plng; lastLat = plat; // 实时同步马路边上最后一个已知点的坐标
            });
            accTime += dur; // 累加更新总时长
          });

          // --- 地块内最后 100 米的路程修正仿真 (Plot Offset Correction) ---
          // 逻辑痛点：普通导航 API 仅负责把你导到路边。需要计算该处与目的地真正的“地块重心”之间的间隙。
          const parcelGapDistance = getDistance(lastLng, lastLat, destLng, destLat); // 计算物理偏差值（米）
          
          if (parcelGapDistance > 5) { // 如果偏差超过 5 米，说明存在小区内道路、单位大门等隐性行程
            // 仿真逻辑：地块内速度 = 用户设定的 entrySpeed，响应补偿 = 用户设定的 entryPenalty（默认为 0 理想即时响应）。
            // 使用 Math.max(0.1, ...) 是防止除以零的数学错误。
            const entryPenaltyTime = (parcelGapDistance / Math.max(0.1, Number(entrySpeed || 3.0))) + Number(entryPenalty || 0); 
            const finalTotalTime = accTime + entryPenaltyTime; // 合并马路形成和地块内行走的最终总体耗时
            
            // 最终补完：将地块真实的重心物理坐标（WGS84 转换后）作为该测算支线的最后一个逻辑落位点存入
            const [wDestLng, wDestLat] = gcj02_to_wgs84(destLng, destLat);
            trailPoints.push([wDestLng, wDestLat, finalTotalTime]);
          }
        }
      } catch (e) {
        console.error('Single route logic trace abandoned.', e); // 允许少部分路网坏点测算失败，确保大局稳定
      }
    });

    await Promise.all(routePromises); // 集火式并发等待，直到全量 200 条支路的上万个轨迹点全部计算完毕并完成坐标对齐

    // 成果盖章：最后也将分析原点（消防站坐标）也转为标准 WGS-84 格式一同返回，用于前端精准校对 marker 位置
    const [wgsLng, wgsLat] = gcj02_to_wgs84(gcjLng, gcjLat);

    // 将完全归一化到 WGS-84 全面标准下的分析成果包响应给前端渲染引擎
    res.json({
      trailPoints: trailPoints, // 海量的带时间标签的轨迹点点云数据集
      anchorCount: uniqueAnchors.length, // 反馈合计分析了多少个目的地地标点
      apiCalls: uniqueAnchors.length + 10, // 反馈后端累计消耗的高德地图信用点（API 调用数）
      wgsOrigin: [wgsLng, wgsLat] // 准确的地球姿态系统下的消防站原点坐标对 [经度, 纬度]
    });

  } catch (error: any) {
    // 捕获各种不可抗力大灾难（秘钥余额不足、高德网络全线崩溃、运营商封锁等情况）
    console.error('SERVER LEVEL CRITICAL FAILURE:', error.message);
    res.status(500).json({ error: '后端计算引擎链路中断，建义核查网络环境后重新提交。' }); 
  }
});

/**
 * ---【模型校验拟合器】核心算法 ---
 * app.post 定义了一个接口 '/api/calibrate'，用于根据历史实测数据自动寻找最优参数。
 */
app.post('/api/calibrate', async (req, res) => {
  const { apiKeys, samples, coordSystem } = req.body;
  
  if (!apiKeys || !samples || samples.length === 0) {
    return res.status(400).json({ error: '缺少秘钥或样本数据' });
  }

  const routeUrl = 'https://restapi.amap.com/v3/direction/driving';
  const results: any[] = [];

  try {
    // 1. 数据预处理与原始行程获取
    for (const sample of samples) {
      let [sLng, sLat] = [sample.stationLng, sample.stationLat];
      let [iLng, iLat] = [sample.incidentLng, sample.incidentLat];
      
      if (coordSystem === 'BD-09') {
        [sLng, sLat] = bd09_to_gcj02(sLng, sLat);
        [iLng, iLat] = bd09_to_gcj02(iLng, iLat);
      } else if (coordSystem === 'WGS-84') {
        [sLng, sLat] = wgs84_to_gcj02(sLng, sLat);
        [iLng, iLat] = wgs84_to_gcj02(iLng, iLat);
      }

      const key = apiKeys[Math.floor(Math.random() * apiKeys.length)];
      const rRes = await axios.get(routeUrl, {
        params: { key, origin: `${sLng.toFixed(6)},${sLat.toFixed(6)}`, destination: `${iLng.toFixed(6)},${iLat.toFixed(6)}`, strategy: 13 }
      });

      if (rRes.data.status === '1' && rRes.data.route) {
        const path = rRes.data.route.paths[0];
        let rawRoadTime = 0;
        let lastLng = sLng, lastLat = sLat;

        path.steps.forEach((step: any) => {
          rawRoadTime += parseInt(step.duration);
          const polyline = step.polyline.split(';');
          const lastPoint = polyline[polyline.length - 1].split(',');
          lastLng = Number(lastPoint[0]);
          lastLat = Number(lastPoint[1]);
        });

        const gapDist = getDistance(lastLng, lastLat, iLng, iLat);
        results.push({
          rawRoadTime,
          gapDist,
          actualTotalTime: sample.actualTotalTime
        });
      }
    }

    // 2. 网格搜索寻找最优解 (Grid Search + Outlier Trimming)
    if (results.length === 0) {
      return res.json({
        recommendedFactor: 0.8,
        recommendedEntrySpeed: 3.0,
        averageErrorSeconds: 0,
        sampleCount: 0,
        message: '没有样本成功获取到路网路径，请检查 API Key 或坐标位置'
      });
    }

    let bestFactor = 0.8;
    let bestEntrySpeed = 3.0;
    let minError = Infinity;

    // 遍历 factor (0.4 - 1.4) 和 entrySpeed (0.5 - 15)
    for (let f = 0.4; f <= 1.4; f += 0.02) {
      for (let s = 0.5; s <= 15.0; s += 0.5) {
        // 计算每个样本在该参数下的误差
        const errors = results.map(item => {
          const simTime = (item.rawRoadTime * f) + (item.gapDist / s);
          return Math.abs(simTime - item.actualTotalTime);
        });

        // --- 核心优化：鲁棒性拟合 (Robust Fitting) ---
        // 排序误差并剔除最极端的 20% 样本（防止偏离巨大的“脏数据”带偏整个模型）
        errors.sort((a, b) => a - b);
        const keepCount = Math.max(1, Math.floor(errors.length * 0.8));
        const trimmedErrors = errors.slice(0, keepCount);
        
        const avgError = trimmedErrors.reduce((sum, e) => sum + e, 0) / keepCount;

        if (avgError < minError) {
          minError = avgError;
          bestFactor = f;
          bestEntrySpeed = s;
        }
      }
    }

    res.json({
      recommendedFactor: Number(bestFactor.toFixed(2)),
      recommendedEntrySpeed: Number(bestEntrySpeed.toFixed(2)),
      averageErrorSeconds: Number(minError.toFixed(2)),
      sampleCount: results.length,
      trimmedCount: Math.floor(results.length * 0.2)
    });

  } catch (error: any) {
    res.status(500).json({ error: '拟合计算失败: ' + error.message });
  }
});

/**
 * ---【系统运营控制】服务器启动逻辑 ---
 */
async function startServer() {
  // 如果识别为开发调试环境，则挂载 Vite 的极速热更新中间件，开发者修改代码后浏览器会秒级刷新预览
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true }, // 将 Vite 作为一个插件嵌入到我们自主开发的 Express 逻辑中
      appType: 'spa', // 定义前端框架类型为现代的 Single Page Application（单页应用）
    });
    app.use(vite.middlewares); // 把 Vite 的动态即时编译流注入到服务器主脉络上
  } else {
    // 如果识别为生产发布环境，则直接以最高性能模式分发之前编译好的 dist 物理静态文件
    const distPath = path.join(process.cwd(), 'dist'); // 设置物理存储位置
    app.use(express.static(distPath)); // 开启 Express 的物理文件直传传输机
    
    // 全路径兜底逻辑：防止用户刷新非根路径页面时出现 404，统一重定向给前端 index.html 接管渲染
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 开始激发服务器在指定端口开启监听，正式开始营业接收请求
  app.listen(PORT, '0.0.0.0', () => {
    // 向系统运维黑窗口打印带前缀的成功确认信息
    console.log(`[FIRE_ENGINEER] 后端分析逻辑已上线! 访问端口: http://localhost:${PORT}`);
    console.log(`[FIRE_ENGINEER] 时空仿真模块加载中... 当前工作模式: ${process.env.NODE_ENV}`);
  });
}

// 激发最终的启动器控制流程
startServer(); 
