import React, { useState, useCallback, useMemo } from 'react'; // 导入 React 核心库及常用钩子
import { 
  Upload,         // 上传图标
  Settings,       // 设置图标
  Play,           // 开始图标
  Download,       // 下载图标
  Map as MapIcon, // 地图图标（重命名为 MapIcon 避免冲突）
  FileText,       // 文档图标
  AlertCircle,    // 警告图标
  Loader2,        // 加载动画图标
  CheckCircle2,   // 成功图标
  XCircle,        // 失败图标
  ChevronRight,   // 向右箭头图标
  Info,           // 信息图标
  Zap,            // 闪电图标（用于标定功能）
  FastForward,    // 快进图标（用于分析功能）
  Database,       // 数据库图标
  FileSpreadsheet, // 表格文件图标
  Calculator      // 计算器图标
} from 'lucide-react'; // 从 lucide-react 图标库导入图标组件
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, LayersControl, ZoomControl } from 'react-leaflet'; // 导入 React-Leaflet 地图组件
import 'leaflet/dist/leaflet.css'; // 导入 Leaflet 样式文件
import L from 'leaflet'; // 导入 Leaflet 核心库
import * as XLSX from 'xlsx'; // 导入 Excel 处理库
import axios from 'axios'; // 导入网络请求库
import * as turf from '@turf/turf'; // 导入地理空间计算库
import { saveAs } from 'file-saver'; // 导入文件保存库
import JSZip from 'jszip'; // 导入压缩包处理库
import { motion, AnimatePresence } from 'motion/react'; // 导入动画库
// @ts-ignore
import shpwrite from 'shp-write'; // 导入 Shapefile 导出库

// 修复 Leaflet 默认图标在某些构建环境下无法显示的 Bug
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// 自定义消防站图标
const fireIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/495/495461.png', // 图标 URL
  iconSize: [32, 32],     // 图标大小 [宽, 高]
  iconAnchor: [16, 32],   // 锚点位置（图标底部尖端）
  popupAnchor: [0, -32],  // 弹出框相对于锚点的位置
});

// 定义站点数据结构接口
interface Station {
  station_name: string; // 站点名称
  lng: number;          // 经度 (WGS84)
  lat: number;          // 纬度 (WGS84)
}

// 定义分析结果数据结构接口
interface AnalysisResult {
  station: Station;     // 原始站点信息
  geometry: any;        // Turf 生成的 GeoJSON 几何图形
  area: number;          // 覆盖面积 (平方公里)
  poiCount: number;      // 使用的 POI 锚点数量
  apiCalls: number;      // 消耗的 API 调用次数
  timestamp: string;      // 分析完成的时间戳
}

// 地图中心点更新组件（由于 MapContainer 的 center 属性不是响应式的，需要此组件手动更新视图）
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap(); // 获取当前地图实例
  React.useEffect(() => {
    map.setView(center, 13); // 当中心点变化时，自动平移并缩放地图
  }, [center, map]);
  return null;
}

const TIANDITU_KEY = 'e97bd73ab261e619504c77adf4f61494'; // 天地图 API Key

export default function App() {
  // --- 状态定义 ---
  const [apiKeys, setApiKeys] = useState<string>(''); // 用户输入的多个高德 API Key（用逗号隔开）
  const [stations, setStations] = useState<Station[]>([]); // 上传解析后的所有待分析站点列表
  const [coordSystem, setCoordSystem] = useState<'GCJ-02' | 'BD-09' | 'WGS-84'>('WGS-84'); // 上传数据的原始坐标系（默认设为 WGS-84，因为 GPS 数据最常见）
  const [targetMin, setTargetMin] = useState<number>(5); // 设定的目标到达时间（默认 5 分钟）
  const [factor, setFactor] = useState<number>(0.8); // 消防特权系数（车速补益，越小越快）
  const [walkSpeed, setWalkSpeed] = useState<number>(4.0); // 步行速度补偿（用于等时圈末端网格计算）
  const [entrySpeed, setEntrySpeed] = useState<number>(3.0); // 地块内部行驶速度 (m/s)
  const [sidebarTab, setSidebarTab] = useState<'analyze' | 'calibrate'>('analyze'); // 侧边栏当前选中的功能页
  const [isAnalyzing, setIsAnalyzing] = useState(false); // 当前是否正在执行分析任务
  const [isCalibrating, setIsCalibrating] = useState(false); // 当前是否正在执行标定拟合任务
  const [calibrationData, setCalibrationData] = useState<any[]>([]); // 上传的用于标定的历史实测样本
  const [calibrationResult, setCalibrationResult] = useState<any>(null); // 标定拟合后的最优参数结果
  const [results, setResults] = useState<AnalysisResult[]>([]); // 存储分析成功的站点结果
  const [logs, setLogs] = useState<string[]>([]); // 存储运行过程中的实时日志消息
  const [activeTab, setActiveTab] = useState<'map' | 'stats'>('map'); // 主视图当前显示的页面（地图或报表）

  // 添加一条带时间戳的日志
  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // 处理 Excel/CSV 文件的通用上传函数
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'station' | 'calibration' = 'station') => {
    const file = e.target.files?.[0]; // 获取选择的文件
    if (!file) return;

    const reader = new FileReader(); // 创建文件读取器
    reader.onload = (evt) => {
      const bstr = evt.target?.result; // 获取读取到的二进制字符串
      const wb = XLSX.read(bstr, { type: 'binary' }); // 解析 Excel 工作簿
      const wsname = wb.SheetNames[0]; // 获取第一个工作表（Sheet）的名称
      const ws = wb.Sheets[wsname]; // 获取工作表对象
      const data = XLSX.utils.sheet_to_json(ws) as any[]; // 将工作表转换为 JSON 数组

      if (type === 'station') {
        // 解析站点数据：清洗并过滤出有效的经纬度和名称
        const validStations = data.filter(row => row.station_name && row.lng && row.lat)
          .map(row => ({
            station_name: String(row.station_name),
            lng: Number(row.lng),
            lat: Number(row.lat)
          }));
        setStations(validStations); // 更新状态
        addLog(`成功加载 ${validStations.length} 个站点`);
      } else {
        // 解析标定样本数据
        setCalibrationData(data);
        addLog(`成功载入 ${data.length} 条校验样本`);
      }
    };
    reader.readAsBinaryString(file); // 以二进制字符串格式开始读取
  };

  // 核心逻辑：执行参数标定（拟合）
  const runCalibration = async () => {
    if (!apiKeys || calibrationData.length === 0) {
      addLog('❌ 请确保已填入 API Key 并上传了校验数据表');
      return;
    }

    const keyList = apiKeys.split(',').map(k => k.trim()).filter(Boolean); // 解析 API Key
    setIsCalibrating(true); // 开启标定状态
    addLog('开始模型参数拟合计算...');

    try {
      // 准备样本数据，允许不同的 Excel 表头兼容
      const samples = calibrationData.map(row => ({
        stationLng: Number(row['消防站经度'] || row['lng']),
        stationLat: Number(row['消防站纬度'] || row['lat']),
        incidentLng: Number(row['火警点经度'] || row['dest_lng']),
        incidentLat: Number(row['火警点纬度'] || row['dest_lat']),
        actualTotalTime: Number(row['实际行驶总耗时 (秒)'] || row['actual_time'])
      })).filter(s => !isNaN(s.stationLng) && !isNaN(s.actualTotalTime)); // 过滤非数值行

      // 请求后端拟合接口
      const response = await axios.post('/api/calibrate', {
        apiKeys: keyList,
        samples,
        coordSystem
      });

      // 应用拟合出的最优参数
      setCalibrationResult(response.data);
      addLog(`标定完成！推荐系数: ${response.data.recommendedFactor}, 推荐速度: ${response.data.recommendedEntrySpeed}m/s`);
      
      setFactor(response.data.recommendedFactor);
      setEntrySpeed(response.data.recommendedEntrySpeed);
    } catch (err: any) {
      addLog(`标定失败: ${err.message}`);
    } finally {
      setIsCalibrating(false); // 关闭标定状态
    }
  };

  // 工具函数：根据后端的“探针粒子”计算空间等时圈几何体
  const calculateIsochrone = (trailPoints: [number, number, number][], targetSec: number) => {
    if (trailPoints.length < 10) return null; // 粒子数太少直接返回（可能该区域无路）

    // 1. 定义分析网格的矩形边界
    const lons = trailPoints.map(p => p[0]);
    const lats = trailPoints.map(p => p[1]);
    const minLon = Math.min(...lons) - 0.01;
    const maxLon = Math.max(...lons) + 0.01;
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;

    // 2. 创建高分辨率插值网格 (Grid)
    const gridRes = 60; // 分辨率数值，越高计算越慢但图形越圆润
    const gridPoints: any[] = [];
    const cellWidth = (maxLon - minLon) / gridRes;
    const cellHeight = (maxLat - minLat) / gridRes;

    for (let i = 0; i <= gridRes; i++) {
      for (let j = 0; j <= gridRes; j++) {
        const lon = minLon + i * cellWidth;
        const lat = minLat + j * cellHeight;
        
        // 关键逻辑：计算每一个网格点到所有“探针粒子”的加权最小时间
        let minTime = Infinity;
        trailPoints.forEach(tp => {
          // tp: [经度, 纬度, 该点路网耗时]
          const dist = turf.distance([lon, lat], [tp[0], tp[1]], { units: 'meters' });
          const walkTime = dist / walkSpeed; // 步行补偿时间（模拟从路边走到楼宇）
          const penalty = 1.0 + Math.max(0, dist - 100) / 60.0; // 距离惩罚系数，防止图形无限扩张
          const totalTime = tp[2] + walkTime * (penalty * penalty);
          if (totalTime < minTime) minTime = totalTime;
        });

        gridPoints.push(turf.point([lon, lat], { time: minTime })); // 标记该坐标点的时间属性
      }
    }

    // 3. 使用 Turf.isobands（等值带）算法提取 0 秒到 目标秒数 之间的封闭区域
    const featureCollection = turf.featureCollection(gridPoints) as any;
    const breaks = [0, targetSec];
    const isobands = turf.isobands(featureCollection, breaks, { zProperty: 'time' });
    
    // 过滤出符合条件的那个闭合多边形
    const targetBand = isobands.features.find(f => f.properties?.time === '0-300' || f.properties?.time === `0-${targetSec}`);
    
    return targetBand || isobands.features[0];
  };

  // 核心逻辑：执行所有站点的可达性分析
  const runAnalysis = async () => {
    if (!apiKeys) {
      addLog('❌ 请输入高德 API Key');
      return;
    }
    if (stations.length === 0) {
      addLog('❌ 请先上传站点数据');
      return;
    }

    setIsAnalyzing(true); // 开启分析状态（界面会变红并显示 Loading）
    setResults([]);      // 清理上一次的分析结果
    setLogs([]);         // 清理上一次的日志
    addLog('🚀 开始分析...');

    const keyList = apiKeys.split(',').map(k => k.trim()).filter(k => k); // 处理多 Key
    const newResults: AnalysisResult[] = [];

    // 遍历所有站点依次进行测算
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      addLog(`📍 正在分析: ${station.station_name} (${i + 1}/${stations.length})`);

      try {
        // 请求后端仿真接口
        const response = await axios.post('/api/analyze', {
          apiKeys: keyList,
          origin: [station.lng, station.lat], // 车库起点
          targetMin,                         // 目标时间
          factor,                            // 特权系数
          coordSystem,                       // 坐标系标识
          entrySpeed,                        // 地块内部速
          entryPenalty: 0                     // (已移除该功能)
        });

        const { trailPoints, anchorCount, apiCalls, wgsOrigin } = response.data; // 获取后端仿真出的海量粒子数据
        const targetSec = (targetMin * 60) / factor; // 换算成路网规划的基础秒数目标
        const isoGeometry = calculateIsochrone(trailPoints, targetSec); // 在前端执行多点差值算法生成等值多边形

        if (isoGeometry) {
          const area = turf.area(isoGeometry) / 1000000; // 计算多边形面积（平方米转平方公里）
          newResults.push({
            station: {
              ...station,
              lng: wgsOrigin[0], // 存储后端转换后的 WGS84 经度
              lat: wgsOrigin[1]  // 存储后端转换后的 WGS84 纬度
            },
            geometry: isoGeometry,
            area: Number(area.toFixed(2)), // 保留两位小数
            poiCount: anchorCount,
            apiCalls,
            timestamp: new Date().toLocaleString()
          });
          addLog(`✅ ${station.station_name} 分析成功，覆盖面积: ${area.toFixed(2)} km²`);
        } else {
          addLog(`⚠️ ${station.station_name} 无法生成等时圈`);
        }
      } catch (error: any) {
        // 捕获 API 限制或网络错误
        addLog(`❌ ${station.station_name} 失败: ${error.message}`);
      }
    }

    setResults(newResults); // 更新结果列表，触发地图和报表渲染
    setIsAnalyzing(false);  // 结束分析状态
    addLog(`🎉 分析完成！共 ${newResults.length} 个站点成功`);
  };

  // 导出分析结果为 Excel 报表
  const exportCSV = () => {
    const data = results.map(r => ({
      '站点名称': r.station.station_name,
      '覆盖面积(km²)': r.area,
      'POI锚点数': r.poiCount,
      'API消耗': r.apiCalls,
      '测算时刻': r.timestamp
    }));
    const ws = XLSX.utils.json_to_sheet(data); // 转换 JSON 为表格行
    const wb = XLSX.utils.book_new(); // 创建工作簿
    XLSX.utils.book_append_sheet(wb, ws, "Results"); // 写入 Sheet
    XLSX.writeFile(wb, "消防站分析结果.xlsx"); // 触发下载
  };

  // 导出分析结果为 GIS 专业的 Shapefile 格式 (WGS84 坐标系)
  const exportSHP = () => {
    const collection = turf.featureCollection(results.map(r => ({
      ...r.geometry,
      properties: {
        name: r.station.station_name,
        area: r.area,
        timestamp: r.timestamp
      }
    })));
    
    // 使用 shp-write 库直接在浏览器端打包并下载 SHP 压缩包
    // @ts-ignore
    shpwrite.download(collection, {
      folder: 'fire_isochrones',
      filename: 'fire_isochrones'
    });
  };

  // 记忆化属性：计算地图显示的视觉中心（优先显示第一个分析成功的点，否则显示第一个上传点）
  const mapCenter = useMemo(() => {
    if (results.length > 0) return [results[0].station.lat, results[0].station.lng] as [number, number];
    if (stations.length > 0) return [stations[0].lat, stations[0].lng] as [number, number];
    return [22.54, 114.05] as [number, number]; // 默认深圳中心点
  }, [results, stations]);

  return (
    // 最外层容器：铺满屏幕高度，采用 Flex 布局（垂直方向）
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* 顶部页眉区域：固定在顶部，提供标题和全局分析按钮 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          {/* 红色 Logo 图标容器 */}
          <div className="bg-red-600 p-2 rounded-lg">
            <MapIcon className="text-white w-6 h-6" />
          </div>
          <div>
            {/* 主标题与副标题 */}
            <h1 className="text-xl font-bold tracking-tight">消防站点可达性圈分析工具V2</h1>
            <p className="text-xs text-slate-500 font-medium">基于高德地图 API & 实时路况模拟</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 开始分析按钮：当正在分析或未加载站点时置灰不可用 */}
          <button 
            onClick={runAnalysis}
            disabled={isAnalyzing || stations.length === 0}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-semibold transition-all ${
              isAnalyzing || stations.length === 0 
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200 active:scale-95'
            }`}
          >
            {/* 动态显示加载动画或播放图标 */}
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            {isAnalyzing ? '分析中...' : '开始分析'}
          </button>
        </div>
      </header>

      {/* 主体操作区域：左右排布 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 左侧边栏：用于参数控制和数据上传 */}
        <aside className="w-80 bg-white border-r border-slate-200 overflow-y-auto flex flex-col shrink-0">
          {/* 功能切换导航（分析 vs 标定） */}
          <nav className="p-4 border-b border-slate-200">
            <div className="flex gap-4">
              <button 
                onClick={() => setSidebarTab('analyze')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-all ${sidebarTab === 'analyze' ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <FastForward className="w-4 h-4" />
                分析
              </button>
              <button 
                onClick={() => setSidebarTab('calibrate')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-all ${sidebarTab === 'calibrate' ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Zap className="w-4 h-4" />
                标定
              </button>
            </div>
          </nav>

          {/* 侧边页内容区域 */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* 根据当前选中的 sidebarTab 渲染不同的面板 */}
            {sidebarTab === 'analyze' ? (
              <>
                {/* 1. API Key 配置区 */}
                <section className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Settings className="w-4 h-4 text-slate-400" />
                    高德 API Keys
                  </label>
                  <textarea 
                    value={apiKeys}
                    onChange={(e) => setApiKeys(e.target.value)}
                    placeholder="输入 API Key，多个用逗号分隔"
                    className="w-full h-24 p-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none bg-slate-50"
                  />
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    建议提供多个 Key 以应对并发限制
                  </p>
                </section>

                {/* 2. 站点 Excel 文件上传区 */}
                <section className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Upload className="w-4 h-4 text-slate-400" />
                    数据上传
                  </label>
                  <div className="relative group">
                    {/* 隐藏的 File Input，覆盖在样式容器上方 */}
                    <input 
                      type="file" 
                      onChange={(e) => handleFileUpload(e, 'station')}
                      accept=".xlsx,.xls,.csv"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    {/* 拖拽上传的可视化容器 */}
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-red-400 group-hover:bg-red-50 transition-all">
                      <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2 group-hover:text-red-500 transition-colors" />
                      <p className="text-xs font-medium text-slate-500 group-hover:text-red-600">点击或拖拽上传 Excel/CSV</p>
                      <p className="text-[10px] text-slate-400 mt-1">需包含: station_name, lng, lat</p>
                    </div>
                  </div>
                  {/* 如果有站点已加载，显示成功标识 */}
                  {stations.length > 0 && (
                    <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 p-2 rounded-lg">
                      <CheckCircle2 className="w-3 h-3" />
                      已加载 {stations.length} 个站点
                    </div>
                  )}
                </section>

                {/* 3. 仿真数学参数配置区 */}
                <section className="space-y-5">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Settings className="w-4 h-4 text-slate-400" />
                    参数配置
                  </label>
                  
                  <div className="space-y-4">
                    {/* 坐标系切换按钮组 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-500">坐标系</span>
                        <span className="text-red-600">{coordSystem}</span>
                      </div>
                      <div className="flex p-1 bg-slate-100 rounded-lg">
                        {(['GCJ-02', 'BD-09', 'WGS-84'] as const).map(sys => (
                          <button
                            key={sys}
                            onClick={() => setCoordSystem(sys)}
                            className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                              coordSystem === sys ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {sys}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 目标时间滑块 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-500">到场时间要求</span>
                        <span className="text-red-600 font-bold">{targetMin} 分钟</span>
                      </div>
                      <input 
                        type="range" min="3" max="15" step="1"
                        value={targetMin} onChange={(e) => setTargetMin(Number(e.target.value))}
                        className="w-full accent-red-600"
                      />
                    </div>

                    {/* 特权系数滑块（表示消防车相对于普通车速度的比例） */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-500">消防车特权系数</span>
                        <span className="text-red-600 font-bold">{factor}</span>
                      </div>
                      <input 
                        type="range" min="0.1" max="1.5" step="0.05"
                        value={factor} onChange={(e) => setFactor(Number(e.target.value))}
                        className="w-full accent-red-600"
                      />
                    </div>

                    {/* 地块内行驶速度滑块 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-500">地块内行驶速度</span>
                        <span className="text-red-600 font-bold">{entrySpeed} m/s</span>
                      </div>
                      <input 
                        type="range" min="0" max="15" step="0.5"
                        value={entrySpeed} onChange={(e) => setEntrySpeed(Number(e.target.value))}
                        className="w-full accent-red-600"
                      />
                    </div>
                  </div>
                </section>
              </>
            ) : (
              // 标定面板内容：用于寻找最优数学参数
              <div className="space-y-8 animate-in fade-in duration-300">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-800 font-bold">
                    <Database className="w-4 h-4 text-red-600" />
                    模型拟合校准
                  </div>
                  <div className="p-4 bg-red-50 rounded-xl space-y-2">
                    <p className="text-[10px] text-red-700 leading-relaxed font-medium">
                      原理：通过上传真实出警的历史实测数据，程序会自动尝试数万种参数组合，为您寻找最符合本地交通现状的“黄金系数”。
                    </p>
                  </div>
                </section>

                {/* 标定样本上传区 */}
                <section className="space-y-4">
                  <div className="text-sm font-bold text-slate-700">1. 上传实测样本</div>
                  <div className="relative group">
                    <input 
                      type="file" 
                      onChange={(e) => handleFileUpload(e, 'calibration')}
                      accept=".xlsx,.xls,.csv"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-red-400 group-hover:bg-red-50 transition-all">
                      <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto mb-2 group-hover:text-red-500 transition-colors" />
                      <p className="text-xs font-medium text-slate-500 group-hover:text-red-600">上传出警实测校验表</p>
                    </div>
                  </div>
                  {calibrationData.length > 0 && (
                    <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 p-2 rounded-lg">
                      <CheckCircle2 className="w-3 h-3" />
                      已载入 {calibrationData.length} 组实测样本
                    </div>
                  )}
                </section>

                {/* 标定执行按钮 */}
                <section className="space-y-6">
                  <div className="text-sm font-bold text-slate-700">2. 执行拟合</div>
                  <button
                    onClick={runCalibration}
                    disabled={isCalibrating || calibrationData.length === 0}
                    className="w-full flex items-center justify-center gap-3 bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white font-bold py-4 rounded-xl shadow-lg transition-all"
                  >
                    {isCalibrating ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Calculator className="w-5 h-5" />
                    )}
                    {isCalibrating ? '拟合计算中...' : '开始自动生成标定参数'}
                  </button>

                  {/* 标定结果展示卡片 */}
                  {calibrationResult && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-6 bg-white border-2 border-red-100 rounded-2xl shadow-xl space-y-4"
                    >
                      <div className="text-center font-bold text-red-600 text-sm italic">标定成功！推荐参数：</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                          <div className="text-[10px] text-red-500 uppercase font-bold">系数 (Factor)</div>
                          <div className="text-xl font-black text-red-700">×{calibrationResult.recommendedFactor}</div>
                        </div>
                        <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                          <div className="text-[10px] text-red-500 uppercase font-bold">速度 (Speed)</div>
                          <div className="text-xl font-black text-red-700">{calibrationResult.recommendedEntrySpeed}m/s</div>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                        基于 {calibrationResult.sampleCount} 个样本拟合，平均误差仅 {calibrationResult.averageErrorSeconds} 秒。
                      </p>
                      <button 
                        onClick={() => setSidebarTab('analyze')}
                        className="w-full py-2 bg-red-600 text-white text-[10px] font-bold rounded-lg hover:bg-red-700 transition-all uppercase tracking-widest"
                      >
                        立即应用并返回分析
                      </button>
                    </motion.div>
                  )}
                </section>
              </div>
            )}
          </div>

          {/* 运行日志显示区域：固定在左侧边栏最底部 */}
          <div className="mt-auto border-t border-slate-200 bg-slate-50 p-4 max-h-64 overflow-y-auto">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">运行日志</h3>
            <div className="space-y-1">
              {/* 循环渲染日志列表中的每一条信息 */}
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-600 break-words leading-relaxed">
                  {log}
                </div>
              ))}
              {/* 列表为空时提示用户等待 */}
              {logs.length === 0 && <p className="text-[10px] text-slate-400 italic">等待操作...</p>}
            </div>
          </div>
        </aside>

        {/* 右侧主展示区：包含地图预览和统计报表 */}
        <div className="flex-1 flex flex-col relative">
          {/* 页面底部居中的视图切换器 (Tabs) */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex bg-white/90 backdrop-blur-md p-1 rounded-full shadow-xl border border-white/20">
            {/* 切换至地图视图按钮 */}
            <button 
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all ${
                activeTab === 'map' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              地图预览
            </button>
            {/* 切换至统计报表按钮 */}
            <button 
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all ${
                activeTab === 'stats' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              统计报表
            </button>
          </div>

          {/* 地图视图容器：使用 React-Leaflet 实现交互式地图 */}
          <div className={`flex-1 relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
            <MapContainer 
              center={mapCenter} 
              zoom={13} 
              className="w-full h-full"
              zoomControl={false} // 禁用默认控件，方便自定义样式和位置
            >
              {/* 底图切换控制器：提供多种底图选择 */}
              <LayersControl position="topright">
                {/* 1. 天地图矢量路网底图（默认选中） */}
                <LayersControl.BaseLayer checked name="天地图矢量">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="http://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                {/* 2. 天地图卫星影像图 */}
                <LayersControl.BaseLayer name="天地图影像">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="http://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                {/* 3. 开源 OpenStreetMap 底图 */}
                <LayersControl.BaseLayer name="OpenStreetMap">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                </LayersControl.BaseLayer>

                {/* 天地图文字标注层（叠加在底图之上显示地名） */}
                <LayersControl.Overlay checked name="标注">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                  />
                </LayersControl.Overlay>
              </LayersControl>

              <ZoomControl position="bottomright" /> {/* 放置缩放按钮 */}
              <MapUpdater center={mapCenter} /> {/* 当中心点状态改变时手动平移地图 */}
              
              {/* 渲染分析结果：在地图上绘制站点图标和等时圈图形 */}
              {results.map((res, i) => (
                <React.Fragment key={i}>
                  {/* 站点坐标标记 (Marker) */}
                  <Marker position={[res.station.lat, res.station.lng]} icon={fireIcon}>
                    {/* 点击图标弹出的详细信息框 */}
                    <Popup>
                      <div className="p-1">
                        <h3 className="font-bold text-sm text-red-600">{res.station.station_name}</h3>
                        <p className="text-[10px] text-slate-500 mt-1">覆盖面积: {res.area} km²</p>
                      </div>
                    </Popup>
                  </Marker>
                  {/* GeoJSON 数据展示层：用于绘制分析出的等时圈多边形 */}
                  <GeoJSON 
                    data={res.geometry} 
                    style={{
                      fillColor: '#ef4444', // 填充浅红色
                      fillOpacity: 0.3,    // 30% 透明度
                      color: '#b91c1c',     // 边框深红色
                      weight: 2,           // 边框粗细
                      dashArray: '4'       // 虚线边框
                    }} 
                  />
                </React.Fragment>
              ))}
            </MapContainer>
          </div>

          {/* 报表视图：以电子表格形式展示分析详情 */}
          <div className={`flex-1 bg-white overflow-y-auto p-8 ${activeTab === 'stats' ? 'block' : 'hidden'}`}>
            <div className="max-w-4xl mx-auto space-y-8">
              {/* 报表顶部：标题及导出按钮 */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">分析成果统计</h2>
                  <p className="text-sm text-slate-500">共完成 {results.length} 个站点的可达性评估</p>
                </div>
                <div className="flex gap-3">
                  {/* 导出为 Excel 按钮 */}
                  <button 
                    onClick={exportCSV}
                    disabled={results.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 Excel
                  </button>
                  {/* 导出为 GIS 专用 Shapefile 按钮 */}
                  <button 
                    onClick={exportSHP}
                    disabled={results.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-all disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 SHP (WGS84)
                  </button>
                </div>
              </div>

              {/* 结果数据展示表格 */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    {/* 表头定义 */}
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">站点名称</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">覆盖面积 (km²)</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">POI 锚点</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">API 消耗</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">测算时刻</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* 循环结果数组并输出各行数据 */}
                    {results.map((res, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">{res.station.station_name}</td>
                        <td className="px-6 py-4">
                          {/* 覆盖面积徽章样式 */}
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-700">
                            {res.area}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-mono">{res.poiCount}</td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-mono">{res.apiCalls}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{res.timestamp}</td>
                      </tr>
                    ))}
                    {/* 当没有结果时显示的空状态文案 */}
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic text-sm">
                          暂无分析结果，请先开始分析
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
