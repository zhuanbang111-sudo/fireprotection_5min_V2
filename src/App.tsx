import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'; // 导入 React 核心库及常用钩子
import { 
  Upload,         // 上传图标
  Settings,       // 设置图标
  Play,           // 开始图标
  Download,       // 下载图标
  Map as MapIcon, // 地图图标（重命名为 MapIcon 避免冲突）
  FileText,       // 文档图标
  AlertCircle,    // 警告图标
  Scan,           // 扫描图标（用于坐标系）
  Loader2,        // 加载动画图标
  CheckCircle2,   // 成功图标
  XCircle,        // 失败图标
  ChevronRight,   // 向右箭头图标
  Info,           // 信息图标
  Zap,            // 闪电图标（用于标定功能）
  FastForward,    // 快进图标（用于分析功能）
  Database,       // 数据库图标
  FileSpreadsheet, // 表格文件图标
  Calculator,     // 计算器图标
  RotateCcw,      // 重置图标
  Pause,          // 暂停图标
  LogIn,          // 登录图标
  LogOut,         // 登出图标
  MessageSquare,  // 反馈图标
  Crown,          // Crown VIP图标
  Gem             // Gem VIP图标
} from 'lucide-react'; // 从 lucide-react 图标库导入图标组件
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, LayersControl, ZoomControl, LayerGroup } from 'react-leaflet'; // 导入 React-Leaflet 地图组件
import 'leaflet/dist/leaflet.css'; // 导入 Leaflet 样式文件
import L from 'leaflet'; // 导入 Leaflet 核心库
import * as XLSX from 'xlsx'; // 导入 Excel 处理库
import axios from 'axios'; // 导入网络请求库
import * as turf from '@turf/turf'; // 导入地理空间计算库
import { saveAs } from 'file-saver'; // 导入文件保存库
import JSZip from 'jszip'; // 导入压缩包处理库
import { motion, AnimatePresence } from 'motion/react'; // 导入动画库
import { useQuery } from '@tanstack/react-query'; // 导入 React Query

import { FeedbackModal } from './components/FeedbackModal'; // 导入反馈组件
import { VipModal } from './components/VipModal'; // 导入VIP专属弹层
import { StatusBadge } from './components/StatusBadge'; // 导入 VIP 身份徽章组件
import { SummaryReport } from './components/SummaryReport'; // 导入空间成果聚合报告组件
import { AdminDashboard } from './components/AdminDashboard'; // 导入管理员对账中心

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
  id?: string;          // 唯一标识符，防止 React 渲染 key 冲突
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
const MAX_DEMO_USAGE = 5;

// --- 全局网络引擎配置 (Axios Interceptor) ---
// 逻辑：每次发起请求前，自动检查本地存储的会话令牌并注入 Authorization 头部。
// 用户 ID 也会被注入，以兼容后端演示账号与限额逻辑。
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('fire_isochrone_auth_token');
  const savedUserStr = localStorage.getItem('fire_isochrone_user');
  if (token && savedUserStr) {
    try {
      const parsedUser = JSON.parse(savedUserStr);
      config.headers.Authorization = `Bearer ${token}`;
      config.headers['x-user-id'] = parsedUser.uid;
    } catch (e) {
      // fallback
    }
  } else if (savedUserStr) {
    // 降级检查本地 localStorage (用于演示账号)
    try {
      const parsed = JSON.parse(savedUserStr);
      config.headers['x-user-id'] = parsed.uid;
    } catch (e) {}
  }
  return config;
}, (error) => Promise.reject(error));

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      // 如果是用做登录或者注册，不能当作“会话令牌失效”做强制清理与强制重载
      if (!url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
        console.warn('[Session] 会话已过期，正在清理...');
        localStorage.removeItem('fire_isochrone_auth_token');
        localStorage.removeItem('fire_isochrone_user');
        // 仅在已登录状态下发生 401 时刷新，避免死循环
        if (localStorage.getItem('fire_isochrone_user_active')) {
          localStorage.removeItem('fire_isochrone_user_active');
          window.location.reload();
        }
      }
    }
    return Promise.reject(error);
  }
);

export default function App() {
  const [user, setUser] = useState<any | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isBackendReady, setIsBackendReady] = useState(false);

  // --- 全端微路由系统 (微前端单页接管核心) ---
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // --- 商业及VIP特权追踪状态 ---
  const [isVipModalOpen, setIsVipModalOpen] = useState(false);
  const [vipModalTitle, setVipModalTitle] = useState('解锁 PRO 专业版算力特权');
  const [vipModalDesc, setVipModalDesc] = useState('您的账户当前为【免费试用】状态，请升级以解锁批量测算与核心资产导出权限');

  const isVip = useMemo(() => {
    if (!user) return false;
    if (user.isTrial) return false; // 试用账户不算 VIP
    if (user.vip_level !== 'pro') return false;
    if (user.vip_expires_at) {
      try {
        return new Date(user.vip_expires_at) > new Date(); // 判断到期时间是否合规
      } catch {
        return false;
      }
    }
    return false;
  }, [user]);

  const vipExpiryDateStr = useMemo(() => {
    if (!user || !user.vip_expires_at) return '';
    try {
      const d = new Date(user.vip_expires_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch {
      return '';
    }
  }, [user]);

  // --- 业务状态定义 ---
  const [apiKeys, setApiKeys] = useState<string>(''); // 用户输入的多个高德 API Key（用逗号隔开）
  const [stations, setStations] = useState<Station[]>([]); // 上传解析后的所有待分析站点列表
  const [coordSystem, setCoordSystem] = useState<'GCJ-02' | 'BD-09' | 'WGS-84'>('WGS-84'); // 上传数据的原始坐标系（默认设为 WGS-84，因为 GPS 数据最常见）
  const [calibrationCoordSystem, setCalibrationCoordSystem] = useState<'GCJ-02' | 'BD-09' | 'WGS-84'>('WGS-84'); // 标定数据的原始坐标系
  const [targetMin, setTargetMin] = useState<number>(5); // 设定的目标到达时间（默认 5 分钟）
  const [factor, setFactor] = useState<number>(0.8); // 消防特权系数（车速补益，越小越快）
  const [walkSpeed, setWalkSpeed] = useState<number>(4.0); // 步行速度补偿（用于等时圈末端网格计算）
  const [entrySpeed, setEntrySpeed] = useState<number>(3.0); // 地块内部行驶速度 (m/s)
  const [sidebarTab, setSidebarTab] = useState<'analyze' | 'calibrate'>('analyze'); // 侧边栏当前选中的功能页
  const [isAnalyzing, setIsAnalyzing] = useState(false); // 当前是否正在执行分析任务
  const [isPaused, setIsPaused] = useState(false); // 当前是否处于暂停状态
  const pauseRef = useRef(false); // 用于中断循环的引用
  const currentIndexRef = useRef(0); // 当前分析到的索引
  const [isCalibrating, setIsCalibrating] = useState(false); // 当前是否正在执行标定拟合任务
  const [calibrationData, setCalibrationData] = useState<any[]>([]); // 上传的用于标定的历史实测样本
  const [calibrationResult, setCalibrationResult] = useState<any>(null); // 标定拟合后的最优参数结果
  const [results, setResults] = useState<AnalysisResult[]>([]); // 存储分析成功的站点结果
  const [logs, setLogs] = useState<string[]>([]); // 存储运行过程中的实时日志消息
  const [activeTab, setActiveTab] = useState<'map' | 'stats'>('map'); // 主视图当前显示的页面（地图或报表）
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false); // 反馈弹窗开关
  const [showUrgentPrompt, setShowUrgentPrompt] = useState(false); // 是否显示额度告急提示

  // 监听试用额度，在最后一次时提醒
  useEffect(() => {
    if (user?.isTrial && user?.remaining === 1) {
      setShowUrgentPrompt(true);
    } else {
      setShowUrgentPrompt(false);
    }
  }, [user?.remaining, user?.isTrial]);

  // 添加一条带时间戳的日志
  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // --- 使用 React Query 检查后端健康状态 ---
  const { data: healthData, error: healthFetchError, isFetched: isHealthFetched } = useQuery({
    queryKey: ['backendHealth'],
    queryFn: async () => {
      const res = await axios.get('/api/health');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5分钟内不重复检查
    retry: 1,
  });

  // --- 账户状态还原与初始化 ---
  useEffect(() => {
    // 1. 初始化健康检查
    if (isHealthFetched && healthData) {
      const isHtml = typeof healthData === 'string' && healthData.toLowerCase().includes('<!doctype html>');
      setIsBackendReady(!isHtml);
    }

    let isMounted = true;

    // 2. 检查演示账号 (优先从本地恢复，以维持计次)
    const checkDemo = () => {
      const savedUser = localStorage.getItem('fire_isochrone_user');
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed.isTrial) {
            setUser(parsed);
            return true;
          }
        } catch (e) {}
      }
      return false;
    };

    // 3. 校验本地登录凭证 (模拟 Cloudflare D1 + Worker 无痛持久化鉴权模式)
    const initAuth = async () => {
      try {
        const token = localStorage.getItem('fire_isochrone_auth_token');
        if (token) {
          const res = await axios.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (isMounted && res.data.success && res.data.user) {
            setUser(res.data.user);
            localStorage.setItem('fire_isochrone_user', JSON.stringify(res.data.user));
            localStorage.setItem('fire_isochrone_user_active', 'true');
            return;
          }
        }
        if (isMounted) {
          checkDemo();
        }
      } catch (e) {
        console.warn('[Auth Init Error] 凭证无效或核验异常，退回演示或空状态:', e);
        localStorage.removeItem('fire_isochrone_auth_token');
        localStorage.removeItem('fire_isochrone_user_active');
        if (isMounted) {
          checkDemo();
        }
      } finally {
        if (isMounted) setIsAuthChecking(false);
      }
    };

    initAuth();

    // 安全垫：3秒后强行关闭加载动画，防止极端网络情况挂起
    const timer = setTimeout(() => {
      if (isMounted) setIsAuthChecking(false);
    }, 3000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [healthData, isHealthFetched]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoading(true);

    try {
      if (isRegistering) {
        console.log('[LocalAuth] 正在向本地云服务发起注册:', email);
        const res = await axios.post('/api/auth/register', {
          email,
          password,
          displayName
        });
        
        if (res.data.success) {
          const { user: registeredUser, session } = res.data;
          addLog('✅ 注册指令提交成功，并已自动登录');
          localStorage.setItem('fire_isochrone_auth_token', session.access_token);
          localStorage.setItem('fire_isochrone_user', JSON.stringify(registeredUser));
          localStorage.setItem('fire_isochrone_user_active', 'true');
          setUser(registeredUser);
        }
      } else {
        console.log('[LocalAuth] 正在向本地云服务请求登录:', email);
        const res = await axios.post('/api/auth/login', {
          email,
          password
        });
        
        if (res.data.success) {
          const { user: loggedInUser, session } = res.data;
          addLog('✅ 登录成功，正在加载核心时空数据...');
          localStorage.setItem('fire_isochrone_auth_token', session.access_token);
          localStorage.setItem('fire_isochrone_user', JSON.stringify(loggedInUser));
          localStorage.setItem('fire_isochrone_user_active', 'true');
          setUser(loggedInUser);
        }
      }
    } catch (error: any) {
      console.error('[LocalAuth] 发生认证错误:', error);
      let errMsg = '服务不可用或网络异常，请稍后重试';
      
      if (error.response?.status === 401) {
        // HTTP 401 肯定是授权/验证失败（包括账号或密码错误、未注册但尝试登录、凭证无效等）
        const serverMsg = error.response.data?.message || '';
        if (serverMsg === 'already registered') {
          addLog('ℹ️ 自动切换：检测到该邮箱已注册，已为您切换为登录模式。');
          setAuthError('该账号已经注册过了，已为您自动切换至登录模式。请直接在下方输入密码并点击“登录”。');
          setIsRegistering(false);
          setIsLoading(false);
          return;
        } else {
          addLog('❌ 登录失败：账号密码有误、不存在或凭证错误。');
          setAuthError('账号不存在或密码输入错误！请检查邮箱地址或密码。');
          setIsLoading(false);
          return;
        }
      }

      if (error.response?.data?.message) {
        const serverMsg = error.response.data.message;
        if (serverMsg === 'already registered') {
          addLog('ℹ️ 自动切换：检测到该邮箱已注册，已为您切换为登录模式。');
          setAuthError('该账号已经注册过了，已为您自动切换至登录模式。请直接在下方输入密码并点击“登录”。');
          setIsRegistering(false);
          setIsLoading(false);
          return;
        } else if (serverMsg.includes('at least 6 characters')) {
          addLog('❌ 注册拦截：密码长度不符合要求。');
          setAuthError('密码太弱！出于安全考虑，密码长度必须大于或等于 6 位数。');
          return;
        } else if (serverMsg === 'Invalid login credentials' || serverMsg === 'Invalid credentials') {
          addLog('❌ 登录失败：账号密码有误或不存在。');
          setAuthError('账号不存在或密码不正确！请检查邮箱地址并重试密码输入。');
          return;
        } else {
          errMsg = serverMsg;
        }
      } else if (error.message) {
        errMsg = error.message;
      }
      
      setAuthError(`认证失败: ${errMsg}`);
      addLog(`❌ 认证错误: ${errMsg}`);
    } finally {
      console.log('[LocalAuth] 请求完成，停止载入动画');
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    addLog('正在退出登录...');
    try {
      // 清空本地所有会话缓存与 Session 标识
      localStorage.removeItem('fire_isochrone_auth_token');
      localStorage.removeItem('fire_isochrone_user');
      localStorage.removeItem('fire_isochrone_user_active');
      
      addLog('✅ 已安全退出登录');
      setUser(null);
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
      addLog('❌ 退出过程中出现外部异常');
    } finally {
      setIsLoading(false);
    }
  };

  // --- 视图组件集成 (在所有状态 Hook 之后) ---
  // 记忆化属性：计算地图显示的视觉中心（优先显示第一个分析成功的点，否则显示第一个上传点）
  const mapCenter = useMemo(() => {
    if (results.length > 0) return [results[0].station.lat, results[0].station.lng] as [number, number];
    if (stations.length > 0) return [stations[0].lat, stations[0].lng] as [number, number];
    return [22.54, 114.05] as [number, number]; // 默认深圳中心点
  }, [results, stations]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* 背景装饰轨迹 */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-red-600 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-600 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-red-600/30">
                <MapIcon className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mt-4">
                FireIsochrone <span className="text-red-500">PRO V2</span>
              </h1>
              <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest">
                {currentPath === '/admin' ? '请先登录管理员账号' : (isRegistering ? '立即创建您的账号' : '消防仿真系统授权登录')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-2 text-center">
                <p className="text-[10px] text-amber-200/80 leading-relaxed">
                  <span className="font-bold text-amber-400">💡 提示：</span>
                  请输入常用邮箱和密码，即可直接注册、登录并启用专属消防分析工作区。
                </p>
                {isHealthFetched && healthData && (
                  <p className="text-[9px] text-slate-300 mt-2 border-t border-white/10 pt-1.5 leading-normal">
                    当前环境: <span className="text-yellow-400 font-mono font-bold">{healthData.environment === 'cloudflare-workers' ? '🩵 Cloudflare Workers (D1 生产库)' : '🧡 AI Studio 本地沙盒 (JSON 仿真库)'}</span>
                    <br />
                    <span className="text-slate-400">
                      {healthData.environment === 'cloudflare-workers' 
                        ? '👉 注册信息会写入您真正的 Cloudflare D1 数据库。' 
                        : 'ℹ️ 此时任何注册操作仅保存于本地 `.data/d1_storage.json` 备份文件中，不写入您 Cloudflare 的 D1 库。部署上线后，用户在生产页面的注册才会保存至您的 D1 数据库！'}
                    </span>
                  </p>
                )}
              </div>

              {/* 选项卡切换 */}
              <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
                <button 
                  type="button"
                  onClick={() => { setIsRegistering(false); setAuthError(''); }}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${!isRegistering ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  账号登录
                </button>
                <button 
                  type="button"
                  onClick={() => { setIsRegistering(true); setAuthError(''); }}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${isRegistering ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  注册
                </button>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                {isRegistering && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-wider">用户名 (姓名/单位)</label>
                    <input 
                      type="text" 
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="您的姓名"
                      required={isRegistering}
                      className="w-full h-12 bg-white/10 border border-white/20 rounded-xl px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white/20 transition-all placeholder:text-slate-500"
                    />
                  </div>
                )}
                
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-wider">电子邮箱</label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                    className="w-full h-12 bg-white/10 border border-white/20 rounded-xl px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white/20 transition-all placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-wider">登录密码</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full h-12 bg-white/10 border border-white/20 rounded-xl px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white/20 transition-all placeholder:text-slate-500"
                  />
                </div>

                {authError && (
                  <div className="flex flex-col gap-2 bg-red-400/10 p-3.5 rounded-xl border border-red-400/20">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div className="text-red-400 text-[11px] font-bold leading-relaxed whitespace-pre-wrap flex-1 text-left">
                        {authError}
                      </div>
                    </div>
                    {authError.includes('账号或密码不正确') && (
                      <button 
                        type="button"
                        onClick={() => {
                          setIsRegistering(true);
                          setAuthError('已切换至注册模式。请重新输入密码并注册。');
                        }}
                        className="self-end text-[10px] bg-red-400/20 hover:bg-red-400/30 text-red-300 px-3 py-1.5 rounded-md transition-colors"
                      >
                        已删除该账号？点击注册新账号
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-600/30 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isRegistering ? '注册并进入系统' : '立即登录')}
                </button>
              </form>

              <div className="pt-4 text-center">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest flex items-center justify-center gap-2">
                  <Database size={10} />
                  Professional Fire Engineering Tool
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // 后台对账管理决策仓渲染阻断
  if (currentPath === '/admin') {
    return (
      <AdminDashboard
        user={user}
        onBack={() => navigateTo('/')}
        onLogout={handleLogout}
      />
    );
  }

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
      // 准备样本数据，允许不同的 Excel 表头兼容（支持中文、高德缩写以及标定说明中定义的英文全称）
      const samples = calibrationData.map(row => ({
        stationLng: Number(row['stationLng'] || row['消防站经度'] || row['lng'] || row['消防站经度'] || row['经度']),
        stationLat: Number(row['stationLat'] || row['消防站纬度'] || row['lat'] || row['消防站纬度'] || row['纬度']),
        incidentLng: Number(row['incidentLng'] || row['火警点经度'] || row['dest_lng'] || row['火警点经度']),
        incidentLat: Number(row['incidentLat'] || row['火警点纬度'] || row['dest_lat'] || row['火警点纬度']),
        actualTotalTime: Number(row['actualTotalTime'] || row['实际总耗时(秒)'] || row['actual_time'] || row['实际行驶总耗时 (秒)'])
      })).filter(s => 
        !isNaN(s.stationLng) && s.stationLng !== 0 && 
        !isNaN(s.actualTotalTime) && s.actualTotalTime > 0
      );

      if (samples.length === 0) {
        throw new Error('样本解析失败：未在表格中找到有效的经纬度或耗时数据。请检查表头名是否符合规范（详见下方说明）。');
      }

      addLog(`开始对 ${samples.length} 条有效样本进行模型拟合...`);

      // 请求后端拟合接口
      const response = await axios.post('/api/calibrate', {
        apiKeys: keyList,
        samples,
        coordSystem: calibrationCoordSystem
      });

      if (response.data.remaining !== undefined) {
        setUser(prev => prev ? { ...prev, remaining: response.data.remaining } : null);
      }

      if (response.data.sampleCount === 0) {
        throw new Error('后端未能成功分析任何样本路径，请检查 API Key 或样本点是否在路网外。');
      }

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
    let targetBand = isobands.features.find(f => f.properties?.time === '0-300' || f.properties?.time === `0-${targetSec}`);
    
    if (!targetBand && isobands.features.length > 0) {
      targetBand = isobands.features[0];
    }

    // --- 算法优化：消除空心 (Remove Internal Holes) ---
    //Isochrones 往往包含内部环（空腔），在展示覆盖范围时通常需要将其“实心化”
    if (targetBand && targetBand.geometry) {
      const geom = targetBand.geometry as any;
      if (geom.type === 'Polygon') {
        // 多边形结构为 [外轮廓, 孔洞1, 孔洞2...]，我们只保留第一个元素（外轮廓）
        geom.coordinates = [geom.coordinates[0]];
      } else if (geom.type === 'MultiPolygon') {
        // 对多面体中的每个多边形执行相同的“去孔”操作
        geom.coordinates = geom.coordinates.map((poly: any) => [poly[0]]);
      }
    }
    
    return targetBand;
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

    // 【商业卡口一：多站点批量计算限制拦截】
    if (stations.length > 1 && !isVip) {
      if (user && (user.vip_level === 'pro' || user.vip_level === 'admin')) {
        // 如果是 pro 或 admin 账户，强制逻辑关闭该弹窗并继续分析流（重定向至分析流）
        setIsVipModalOpen(false);
      } else {
        setVipModalTitle('🚨 批量计算专属 PRO 服务');
        setVipModalDesc(`您当前加载了 ${stations.length} 个站点。免费试用账户仅支持“单点（1个站点）”依次进行等时圈精密测算，无法进行全自动多点批量循环。请联系客服升级为 PRO 付费专业版以解锁企业级多站点并行全自动算力！`);
        setIsVipModalOpen(true);
        addLog('⚠️ 批量测算拦截：免费用户单次仅支持单站点计算，多点批量已被拦截。');
        return;
      }
    }

    // 启动分析时显式闭合任何开放中的会员结算收银台页面 (针对管理员账户或PRO账户)
    setIsVipModalOpen(false);

    setIsAnalyzing(true); // 开启分析状态
    setIsPaused(false);
    pauseRef.current = false;

    // 如果是从第一位开始，清空之前的结果
    if (currentIndexRef.current === 0) {
      setResults([]);
      setLogs([]);
      addLog('🚀 开始分析...');
    } else {
      addLog('▶️ 继续分析...');
    }

    const keyList = apiKeys.split(',').map(k => k.trim()).filter(k => k);

    // 遍历所有站点依次进行测算
    for (let i = currentIndexRef.current; i < stations.length; i++) {
      // 检查暂停标志
      if (pauseRef.current) {
        setIsAnalyzing(false);
        setIsPaused(true);
        currentIndexRef.current = i; // 记录当前位置
        addLog(`⏸ 分析已暂停 (当前第 ${i} 个)`);
        return;
      }

      const station = stations[i];
      addLog(`📍 正在分析: ${station.station_name} (${i + 1}/${stations.length})`);
      const stationStartTime = Date.now();

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

        if (response.data.remaining !== undefined) {
          setUser(prev => prev ? { ...prev, remaining: response.data.remaining } : null);
        }

        const { trailPoints, anchorCount, apiCalls, wgsOrigin } = response.data;
        const targetSec = (targetMin * 60) / factor;
        const isoGeometry = calculateIsochrone(trailPoints, targetSec);

        if (isoGeometry) {
          const area = turf.area(isoGeometry) / 1000000;
          const newResult: AnalysisResult = {
            id: `res-${station.station_name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            station: {
              ...station,
              lng: wgsOrigin[0],
              lat: wgsOrigin[1]
            },
            geometry: isoGeometry,
            area: Number(area.toFixed(2)),
            poiCount: anchorCount,
            apiCalls,
            timestamp: new Date().toLocaleString()
          };
          setResults(prev => [...prev, newResult]);
          addLog(`✅ ${station.station_name} 分析成功，覆盖面积: ${area.toFixed(2)} km²`);
        } else {
          addLog(`⚠️ ${station.station_name} 无法生成等时圈`);
        }
        
        const stationEndTime = Date.now();
        const durationSeconds = ((stationEndTime - stationStartTime) / 1000).toFixed(1);
        addLog(`站点 ${station.station_name} 分析完成，耗时 ${durationSeconds} 秒`);
      } catch (error: any) {
        const errorMsg = error.response?.data?.message || error.message;
        addLog(`❌ ${station.station_name} 失败: ${errorMsg}`);
        const stationEndTime = Date.now();
        const durationSeconds = ((stationEndTime - stationStartTime) / 1000).toFixed(1);
        addLog(`站点 ${station.station_name} 分析完成，耗时 ${durationSeconds} 秒`);
        if (error.response?.status === 403) {
          setAuthError(errorMsg);
          setIsAnalyzing(false);
          return;
        }
      }
      
      // 更新索引
      currentIndexRef.current = i + 1;
    }

    // 全部完成
    setIsAnalyzing(false); 
    setIsPaused(false);
    currentIndexRef.current = 0; // 重置进度
    addLog(`🎉 分析完成！`);
  };

  // 暂停分析
  const pauseAnalysis = () => {
    pauseRef.current = true;
    addLog('正在尝试请求暂停...');
  };

  // 重置分析（清空所有进度）
  const resetAnalysis = () => {
    setIsAnalyzing(false);
    setIsPaused(false);
    pauseRef.current = false;
    currentIndexRef.current = 0;
    setResults([]);
    addLog('🔄 分析已重置');
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
    // 【商业卡口二：GIS 矢量数据资产物理卡卡口】
    if (!isVip) {
      setVipModalTitle('🔒 导出 Shapefile 专属限制');
      setVipModalDesc('由本引擎生成的具有精密拓扑坐标的 WGS84 消防规划面要素 Shapefile（GIS 行业绝对生产媒介形式）属于专业版专属的高阶资产保护文件。免费版限制该项导出，请升级 PRO 以一秒打包并无缝兼容 ArcGIS/QGIS 开展深度设计制图。');
      setIsVipModalOpen(true);
      addLog('⚠️ 导出拦截：GIS 矢量资产导出（Shapefile）为 PRO 专业版专用功能，已被保护卡口拦截。');
      return;
    }

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

  return (
    // 最外层容器：铺满屏幕高度，采用 Flex 布局（垂直方向）
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* 顶部页眉区域：固定在顶部，提供标题和全局分析按钮 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {/* 红色 Logo 图标容器 */}
            <div className="bg-red-600 p-2 rounded-lg">
              <MapIcon className="text-white w-6 h-6" />
            </div>
            <div>
              {/* 主标题与副标题 */}
              <h1 className="text-lg font-black tracking-tight">FireIsochrone <span className="text-red-600">PRO V2</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Emergency Response Engine</p>
            </div>
          </div>
          
          <div className="h-6 w-px bg-slate-200 mx-2" />
          
          {/* 用户信息与退出 */}
          <div className="flex items-center gap-3 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 shadow-inner">
            {user?.photoURL && (
              <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full border border-slate-300" />
            )}
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-700 leading-none">
                  {user?.displayName || user?.email}
                </span>
                <StatusBadge 
                  user={user} 
                  onUpgradeClick={() => {
                    setVipModalTitle('升级解锁 PRO 专业版算力特权');
                    setVipModalDesc('升级您的账户以解锁无限量多站点并行批量运算、由于资产安全及核心隐私政策，标准 ArcGIS/QGIS 分层面要素 Shapefile（WGS84投影）为 PRO 专业版独享。');
                    setIsVipModalOpen(true);
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleLogout}
                  className="text-[9px] text-slate-400 font-bold hover:text-red-500 transition-colors text-left uppercase tracking-tighter w-fit"
                >
                  Sign Out
                </button>
                {(user?.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user?.email?.toLowerCase()?.trim() || '')) && (
                  <button
                    onClick={() => navigateTo('/admin')}
                    className="text-[9px] text-red-500 hover:text-red-600 font-black transition-colors uppercase tracking-tight flex items-center bg-red-50 border border-red-200/55 px-1.5 py-0.5 rounded ml-1.5 shadow-sm"
                  >
                    👑 进入后台
                  </button>
                )}
                {!user?.isTrial && user && isVip && vipExpiryDateStr && (
                  <span className="text-[8px] text-amber-600 font-bold font-mono">
                    • 尊享效期至 {vipExpiryDateStr}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 反馈按钮 */}
          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-slate-600 hover:bg-slate-100 transition-all border border-slate-200"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden md:inline">系统反馈</span>
          </button>

          {/* 重置按钮：仅在分析中或已暂停时显示 */}
          {(isAnalyzing || isPaused) && (
            <button
              onClick={resetAnalysis}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all border border-slate-200"
              title="重置进度"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          
          {/* 暂停按钮：仅在运行中显示 */}
          {isAnalyzing && (
            <button
              onClick={pauseAnalysis}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full font-bold bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all border border-amber-200"
            >
              <Pause className="w-4 h-4" />
              <span>暂停</span>
            </button>
          )}

          {/* 开始/继续分析按钮 */}
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
            {isAnalyzing ? '分析中...' : (isPaused ? '继续分析' : '开始分析')}
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
            <AnimatePresence>
              {showUrgentPrompt && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-gradient-to-r from-red-600 to-orange-600 p-4 rounded-2xl text-white shadow-lg shadow-red-200">
                    <div className="flex items-start gap-3">
                      <div className="bg-white/20 p-1.5 rounded-lg">
                        <AlertCircle className="w-4 h-4" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-tight">最后一次试用机会</p>
                        <p className="text-[10px] text-white/80 leading-relaxed font-medium">
                          您的试用额度即将耗尽。为了确保数据能够保存并享受不限次数的仿真，请立即注册。
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {user?.isTrial && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-4 border rounded-2xl space-y-3 shadow-sm transition-colors ${user.remaining === 1 ? 'bg-red-50 border-red-200' : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${user.remaining === 1 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                      <Zap className={`w-4 h-4 ${user.remaining === 1 ? 'animate-pulse' : ''} fill-current`} />
                    </div>
                    <span className={`text-xs font-black uppercase tracking-tight ${user.remaining === 1 ? 'text-red-800' : 'text-amber-800'}`}>
                      {user.remaining === 1 ? '额度即将耗尽' : '试用额度'}
                    </span>
                  </div>
                  <span className={`text-xs font-black ${user.remaining === 1 ? 'text-red-600' : 'text-amber-600'}`}>{user.remaining} / {MAX_DEMO_USAGE} 次</span>
                </div>
                
                {/* 进度条显示 */}
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(user.remaining / MAX_DEMO_USAGE) * 100}%` }}
                    className={`h-full transition-all ${user.remaining <= 1 ? 'bg-red-500' : 'bg-amber-500'}`}
                  />
                </div>
                
                <p className={`text-[10px] font-medium leading-relaxed ${user.remaining === 1 ? 'text-red-700/80' : 'text-amber-700/70'}`}>
                  {user.remaining === 1 
                    ? '这是您当前的最后一次免费仿真。注册后即可解锁全部高级功能并消除次数限制。'
                    : '当前处于试用装状态。完成所有分析后，您可以直接注册新账户以获取永久访问权限。'}
                </p>
                
                <button 
                  onClick={() => {
                    handleLogout();
                    setIsRegistering(true);
                  }}
                  className={`w-full py-2.5 text-[11px] font-black rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 ${
                    user.remaining === 1 
                      ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-200' 
                      : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200'
                  }`}
                >
                  <LogIn size={14} />
                  立即注册/登录账号
                </button>
              </motion.div>
            )}
            
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
                        {(['GCJ-02', 'BD-09', 'WGS-84'] as const).map((sys, idx) => (
                          <button
                            key={`coord-sys-${sys}-${idx}`}
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
                  
                  {/* 标定坐标系选择 */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Scan className="w-3 h-3" />
                        样本表坐标系
                      </div>
                      <span className="text-red-600 font-bold text-xs">{calibrationCoordSystem}</span>
                    </div>
                    <div className="flex p-1 bg-slate-100 rounded-lg">
                      {(['GCJ-02', 'BD-09', 'WGS-84'] as const).map((sys, idx) => (
                        <button
                          key={`calib-sys-${sys}-${idx}`}
                          onClick={() => setCalibrationCoordSystem(sys)}
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                            calibrationCoordSystem === sys ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {sys}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 数据说明与表头参考 */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <p className="text-[11px] text-slate-600 font-medium">
                      校验表必须包含以下列名（支持 Excel 或 CSV）：
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {[
                        { h: 'stationLng', d: '消防站经度' },
                        { h: 'stationLat', d: '消防站纬度' },
                        { h: 'incidentLng', d: '火警点经度' },
                        { h: 'incidentLat', d: '火警点纬度' },
                        { h: 'actualTotalTime', d: '实际总耗时(秒)' },
                      ].map((item, idx) => (
                        <div key={`calib-col-${idx}`} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-slate-100 shadow-sm">
                          <code className="text-[10px] font-bold text-red-600">{item.h}</code>
                          <span className="text-[10px] text-slate-400">{item.d}</span>
                        </div>
                      ))}
                    </div>
                  </div>

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
                      
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                          基于 {calibrationResult.sampleCount} 个有效样本，平均误差 <span className={`font-bold ${calibrationResult.averageErrorSeconds > 60 ? 'text-orange-500' : 'text-green-600'}`}>{calibrationResult.averageErrorSeconds}</span> 秒。
                        </p>
                        {calibrationResult.recommendedFactor >= 1.0 && (
                          <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-[9px] text-red-600 font-medium">
                            ⚠️ 警告：标定系数 ≥ 1.0。这意味着样本显示消防车比社会车辆更慢，请务必检查“样本坐标系”选择是否正确。
                          </div>
                        )}
                        {calibrationResult.trimmedCount > 0 && (
                          <p className="text-[9px] text-slate-400 text-center">
                            (模型已自动剔除 {calibrationResult.trimmedCount} 个极大离群点以优化拟合度)
                          </p>
                        )}
                      </div>

                      {calibrationResult.averageErrorSeconds > 120 && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2 items-start">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-[10px] text-amber-700 leading-normal">
                            <b>误差较大建议：</b> 平均误差超过 2 分钟，建议检查样本表格中的坐标系是否选对（WGS84?），或剔除掉交通极端拥堵、出警记录异常的散点。
                          </div>
                        </div>
                      )}

                      <button 
                        onClick={() => setSidebarTab('analyze')}
                        className="w-full py-2 bg-red-600 text-white text-[10px] font-bold rounded-lg hover:bg-red-700 transition-all uppercase tracking-widest"
                      >
                        立即应用并返回分析
                      </button>
                    </motion.div>
                  )}

                  {/* 标定优化建议指南 */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      <Info className="w-3.5 h-3.5 text-slate-400" />
                      标定质量优化指南
                    </div>
                    <ul className="text-[10px] text-slate-500 space-y-2 list-disc pl-3 leading-relaxed">
                      <li><b>剔除离群值：</b> 排除发生车祸、极端天气、非典型时段（如深夜或早高峰）的异常出警样本。</li>
                      <li><b>坐标统一：</b> 确保实测表中的 <code>stationLng/Lat</code> 等坐标系与当前选择的【样本表坐标系】严格一致。</li>
                      <li><b>样本分布：</b> 尽量均匀涵盖近距离（0.5km）和远距离（5km+）的样本，避免数据集中在某个半径。</li>
                    </ul>
                  </div>
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
                <div key={`log-item-${i}`} className="text-[10px] font-mono text-slate-600 break-words leading-relaxed">
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
                activeTab === 'map' 
                  ? 'bg-slate-900 text-white shadow-lg' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              <span>地图图层</span>
            </button>

            {/* 切换至报表视图按钮 */}
            <button 
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all ${
                activeTab === 'stats' 
                  ? 'bg-slate-900 text-white shadow-lg' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>统计报表</span>
            </button>
          </div>

          {/* 地图图层视图 */}
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
                <LayersControl.BaseLayer key="base-layer-1" checked name="天地图矢量">
                  <TileLayer
                    url={`https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                {/* 2. 天地图卫星影像图 */}
                <LayersControl.BaseLayer key="base-layer-2" name="天地图影像">
                  <TileLayer
                    url={`https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                {/* 3. 开源 OpenStreetMap 底图 */}
                <LayersControl.BaseLayer key="base-layer-3" name="OpenStreetMap">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                </LayersControl.BaseLayer>

                {/* 天地图文字标注层（叠加在底图之上显示地名） */}
                <LayersControl.Overlay key="overlay-annotation" checked name="标注">
                  <TileLayer
                    url={`https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                  />
                </LayersControl.Overlay>
              </LayersControl>

              {/* 渲染分析结果：在地图上直接绘制站点图标和等时圈图形 */}
              {results.map((res, i) => {
                const resId = res.id ? `${res.id}-${i}` : `res-${i}`;
                return (
                  <LayerGroup key={`result-g-${resId}`}>
                    {/* 站点坐标标记 (Marker) */}
                    <Marker 
                      key={`marker-${resId}`}
                      position={[res.station.lat, res.station.lng]} 
                      icon={fireIcon}
                    >
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
                      key={`iso-${resId}`}
                      data={res.geometry} 
                      style={{
                        fillColor: '#ef4444', // 填充红色
                        fillOpacity: 0.35,   // 稍微提高透明度增强对比
                        color: '#b91c1c',     // 边框深红
                        weight: 3,           // 加粗边框
                        lineJoin: 'round',    // 圆角连接
                        opacity: 0.8          // 边框不透明度
                      }} 
                    />
                  </LayerGroup>
                );
              })}

              <ZoomControl position="bottomright" /> {/* 放置缩放按钮 */}
              <MapUpdater center={mapCenter} /> {/* 当中心点状态改变时手动平移地图 */}
            </MapContainer>
          </div>

          {/* 报表视图：以电子表格形式展示分析详情 */}
          <div className={`flex-1 bg-white overflow-y-auto p-8 ${activeTab === 'stats' ? 'block' : 'hidden'}`}>
            <div className="max-w-4xl mx-auto space-y-8">
              {/* 报表顶部：标题及导出按钮 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-slate-800">分析成果统计</h2>
                    <StatusBadge 
                      user={user} 
                      onUpgradeClick={() => {
                        setVipModalTitle('升级解锁 PRO 专业版算力特权');
                        setVipModalDesc('升级您的账户以解锁无限量多站点并行批量运算、由于资产安全及核心隐私政策，标准 ArcGIS/QGIS 分层面要素 Shapefile（WGS84投影）为 PRO 专业版独享。');
                        setIsVipModalOpen(true);
                      }}
                    />
                  </div>
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

              {/* 空间成果多维聚合分析报告 */}
              <SummaryReport results={results} user={user} />

              {/* 结果数据展示表格 */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm shadow-slate-100">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-extrabold text-[#0f172a] text-xs uppercase tracking-wider">测算明细数据项 (Data Records Matrix)</h3>
                  <span className="text-[10px] text-slate-400 font-mono font-bold">WGS-84 MAP MAPPINGS</span>
                </div>
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
                    {results.map((res, i) => {
                      const resId = res.id ? `${res.id}-${i}` : `res-table-${i}`;
                      return (
                        <tr key={`res-tr-${resId}`} className="hover:bg-slate-50 transition-colors">
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
                      );
                    })}
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

      {/* 反馈弹窗 */}
      <FeedbackModal 
        isOpen={isFeedbackOpen} 
        onClose={() => setIsFeedbackOpen(false)} 
        user={user}
      />

      {/* 商业化VIP专属授权服务激活弹窗 */}
      <VipModal 
        isOpen={isVipModalOpen} 
        onClose={() => setIsVipModalOpen(false)} 
        user={user}
        onUpgradeSuccess={(updatedUser) => {
          setUser(updatedUser);
          localStorage.setItem('fire_isochrone_user', JSON.stringify(updatedUser));
        }}
        title={vipModalTitle}
        description={vipModalDesc}
      />
    </div>
  );
}
