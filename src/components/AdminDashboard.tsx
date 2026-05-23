import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  Check, 
  X, 
  RefreshCw, 
  Search, 
  Mail, 
  FileText, 
  CreditCard, 
  ArrowLeft, 
  AlertTriangle, 
  LogOut, 
  Clock, 
  ExternalLink, 
  Eye, 
  Sparkles,
  ClipboardCheck,
  Ban,
  Database,
  QrCode,
  Upload,
  Loader2
} from 'lucide-react';

interface Order {
  id: string;
  user_id: string;
  email: string;
  payment_method?: string;
  amount: number;
  voucher_name: string;
  voucher_screenshot?: string;
  status: 'pending' | 'success' | 'rejected';
  created_at: string;
  updated_at?: string;
}

interface AdminDashboardProps {
  user: any;
  onBack: () => void;
  onLogout: () => void;
}

export function AdminDashboard({ user, onBack, onLogout }: AdminDashboardProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'success' | 'rejected'>('pending');
  
  // Custom Toast Message state (Iframe safe notifications)
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  
  // Lightbox view for screenshots
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  
  // Dynamic action confirm state
  const [activeConfirmAction, setActiveConfirmAction] = useState<{ order: Order; status: 'success' | 'rejected' } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg(null);
    }, 4000);
  };

  // Fetch orders from server (verifies admin privileges via response code)
  const fetchOrders = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const token = localStorage.getItem('fire_isochrone_auth_token');
      const res = await axios.get('/api/orders', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      if (res.data.success) {
        setOrders(res.data.orders || []);
        setIsAuthorized(true);
      } else {
        setIsAuthorized(false);
      }
    } catch (err: any) {
      console.error('[Admin Auth Check Error]', err);
      // If server returns 401 or 403, it means the user has non-admin rights or session expired
      if (err.response?.status === 401 || err.response?.status === 403) {
        setIsAuthorized(false);
      } else {
        showToast('获取订单列表时发生异常，请稍后重试。', 'error');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // 1. 系统配置数据绑定的收款码
  const [adminQrUrl, setAdminQrUrl] = useState(''); // 微信收款码
  const [adminAlipayQrUrl, setAdminAlipayQrUrl] = useState(''); // 支付宝收款码
  const [isConfigSaving, setIsConfigSaving] = useState(false);

  // 1.5. 系统配置数据绑定的价格
  const [adminPrice, setAdminPrice] = useState<number>(399.00);
  const [isPriceSaving, setIsPriceSaving] = useState(false);

  // 获取服务端的账单价格
  const fetchSystemPrice = async () => {
    try {
      const res = await axios.get('/api/system/price');
      if (res.data.success && typeof res.data.price === 'number') {
        setAdminPrice(res.data.price);
      }
    } catch (e) {
      console.error('[Admin] 获取服务端价格配置出错:', e);
    }
  };

  // 超级管理员保存会员价格
  const handleSaveSystemPrice = async () => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) return;

    if (adminPrice < 0 || isNaN(adminPrice)) {
      showToast('请输入有效的会员价格！', 'error');
      return;
    }

    setIsPriceSaving(true);
    try {
      const res = await axios.post('/api/system/price', {
        price: adminPrice
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        showToast(`🎉 全局 PRO 会员价格已更新为 ￥${adminPrice.toFixed(2)} 元！全体前台页面以及收银台将立即同步热部署更新！`, 'success');
      } else {
        throw new Error(res.data.message || '保存价格失败');
      }
    } catch (e: any) {
      console.error('[Save Price Error]', e);
      showToast(e.response?.data?.message || '价格配置更新失败', 'error');
    } finally {
      setIsPriceSaving(false);
    }
  };

  // 获取服务端的全局收款码配置 (热更新)
  const fetchSystemQr = async () => {
    try {
      const res = await axios.get('/api/system/qr');
      if (res.data.success) {
        setAdminQrUrl(res.data.qrUrl || '');
        setAdminAlipayQrUrl(res.data.alipayQrUrl || '');
      }
    } catch (e) {
      console.error('[Admin] 获取服务端收款配置出错:', e);
    }
  };

  // 处理管理员微信收款码替换上传 (Base64)
  const handleAdminLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setAdminQrUrl(base64);
        showToast('微信收款二维码读取成功！请点击下方的“保存配置并部署上线”按钮，将收款码实时在线部署发布！', 'info');
      }
    };
    reader.onerror = () => {
      showToast('读取微信图片文件失败，请尝试其他格式。', 'error');
    };
    reader.readAsDataURL(file);
  };

  // 处理管理员支付宝收款码替换上传 (Base64)
  const handleAdminAlipayLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setAdminAlipayQrUrl(base64);
        showToast('支付宝收款二维码读取成功！请点击下方的“保存配置并部署上线”按钮，将收款码实时在线部署发布！', 'info');
      }
    };
    reader.onerror = () => {
      showToast('读取支付宝图片文件失败，请尝试其他格式。', 'error');
    };
    reader.readAsDataURL(file);
  };

  // 超级管理员保存系统全局配置
  const handleSaveSystemQr = async () => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) return;

    setIsConfigSaving(true);
    try {
      const res = await axios.post('/api/system/qr', {
        qrUrl: adminQrUrl,
        alipayQrUrl: adminAlipayQrUrl
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        showToast('🎉 全局云端双重收款码（微信与支付宝）热部署上线！前台全体普通访客现在将直接显示这组最新收款信息。', 'success');
      } else {
        throw new Error(res.data.message || '保存配置失败');
      }
    } catch (e: any) {
      console.error('[Save Config Error]', e);
      showToast(e.response?.data?.message || '配置上传失败', 'error');
    } finally {
      setIsConfigSaving(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchSystemQr();
    fetchSystemPrice();
  }, []);

  // Filter orders based on filter selection and search bar (fuzzy search email, order id, memo)
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const matchStatus = statusFilter === 'all' ? true : order.status === statusFilter;
      const cleanQuery = searchQuery.toLowerCase().trim();
      const matchSearch = !cleanQuery ? true : (
        order.email.toLowerCase().includes(cleanQuery) ||
        order.id.toLowerCase().includes(cleanQuery) ||
        (order.voucher_name && order.voucher_name.toLowerCase().includes(cleanQuery))
      );
      return matchStatus && matchSearch;
    });
  }, [orders, statusFilter, searchQuery]);

  // Handle Approve or Reject
  const handleApproveExecute = async (orderId: string, status: 'success' | 'rejected') => {
    setIsActionLoading(true);
    setActiveConfirmAction(null);
    try {
      const token = localStorage.getItem('fire_isochrone_auth_token');
      const res = await axios.post('/api/orders/approve', {
        orderId,
        status
      }, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.data.success) {
        // 先做乐观更新：理解更新本地状态，实现界面秒级响应及统计数据的同步
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status, updated_at: new Date().toISOString() } : o));

        showToast(
          status === 'success' 
            ? '🎉 该订单核确成功！核对款项无误，用户已秒级自动升级为 PRO 会员。' 
            : '❌ 该订单已作废/驳回。', 
          status === 'success' ? 'success' : 'info'
        );
        // Soft refresh orders silently in the background
        fetchOrders(true);
      } else {
        showToast(res.data.message || '操作失败，请重试', 'error');
      }
    } catch (err: any) {
      console.error('[Action Error]', err);
      showToast(err.response?.data?.message || '服务器审批失败', 'error');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Compute key stats for admin dashboard widgets
  const stats = useMemo(() => {
    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const successCount = orders.filter(o => o.status === 'success').length;
    const totalRevenue = orders
      .filter(o => o.status === 'success')
      .reduce((sum, o) => sum + (o.amount || 0), 0);
      
    return { pendingCount, successCount, totalRevenue };
  }, [orders]);

  if (isAuthorized === false) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-red-900/10 rounded-full blur-[160px] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-6 shadow-2xl relative z-10"
        >
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto border border-red-500/25">
            <Shield className="w-8 h-8 shrink-0" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-black tracking-tight">🚨 无管理员操作权限</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              您的邮箱账户 <span className="text-red-400 font-mono">{user?.email}</span> 未被授权访问总调度舱后台管理系统。该路径仅对具备根级权限的独立开发和财务审批者开放。
            </p>
          </div>
          
          <div className="pt-2 flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> 返回系统主页
            </button>
            <button
              onClick={onLogout}
              className="flex-1 py-3 bg-red-600/15 hover:bg-red-600/25 text-red-400 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 border border-red-500/20"
            >
              <LogOut className="w-4 h-4" /> 登出该账户
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 antialiased">
      {/* 🚀 Standout Admin Navigation Header Ribbon */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4 sticky top-0 z-40 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 p-2.5 rounded-2xl shadow-md shadow-red-900/30">
              <Shield className="text-white w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-tight font-mono text-slate-100">CLOUD CONTROL TOWER</span>
                <span className="bg-emerald-500/10 text-emerald-400 text-[9px] px-2 py-0.5 rounded font-black border border-emerald-500/20 uppercase">
                  ROOT ADMIN
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">财务对账与B端授权控制中枢</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Session user badge */}
            <div className="text-right hidden md:block">
              <p className="text-[11px] font-black text-slate-200">{user?.displayName || '系统统辖者'}</p>
              <p className="text-[9px] text-slate-400 font-mono">{user?.email}</p>
            </div>
            
            <div className="h-8 w-px bg-slate-800 hidden md:block" />
            
            <button
              onClick={onBack}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 border border-slate-700/60 shadow"
            >
              <ArrowLeft className="w-4 h-4" /> 返回主地图系统
            </button>
            
            <button
              onClick={onLogout}
              className="p-2 bg-red-900/35 hover:bg-red-900/50 text-red-400 rounded-xl transition-all border border-red-500/20"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {/* Custom Toast Alerts */}
        <AnimatePresence>
          {toastMsg && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              className={`p-4 rounded-2xl text-xs font-bold shadow-xl border flex items-center justify-between gap-3 ${
                toastMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 shadow-emerald-100'
                  : toastMsg.type === 'error'
                  ? 'bg-rose-50 border-rose-250 text-rose-800 shadow-rose-100'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-800 shadow-indigo-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500 shrink-0" />
                <span>{toastMsg.text}</span>
              </div>
              <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 📊 High Contrast Flight Performance Widget Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-600 rounded-2xl flex items-center justify-center border border-amber-500/20">
              <Clock className="w-6 h-6 shrink-0" />
            </div>
            <div>
              <p className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">待审核款项笔数</p>
              <h3 className="text-2xl font-black font-mono tracking-tight text-slate-900 mt-1">
                {isLoading ? '...' : stats.pendingCount}
                <span className="text-xs font-bold text-amber-600 ml-1">笔挂起</span>
              </h3>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-500/20">
              <ClipboardCheck className="w-6 h-6 shrink-0" />
            </div>
            <div>
              <p className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">成功结账笔数</p>
              <h3 className="text-2xl font-black font-mono tracking-tight text-slate-900 mt-1">
                {isLoading ? '...' : stats.successCount}
                <span className="text-xs font-bold text-emerald-600 ml-1">笔已放行</span>
              </h3>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-500/10 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-500/20">
              <CreditCard className="w-6 h-6 shrink-0" />
            </div>
            <div>
              <p className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">平台纯收入（对账规模）</p>
              <h3 className="text-2xl font-black font-mono tracking-tight text-slate-900 mt-1">
                ￥{isLoading ? '...' : stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
            </div>
          </div>

        </div>

        {/* 💳 收款系统全球热部署中枢 */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-5">
            <div className="p-2.5 bg-red-600/10 text-red-650 rounded-2xl border border-red-100">
              <QrCode className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                收款系统配置中心 (全局热部署中枢)
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                GLOBAL PAYMENT GATEWAY CUSTOMIZATION & LIVE HOT-DEPLOY
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Box: Current QR Preview */}
            <div className="lg:col-span-4 flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-slate-100 min-h-[220px]">
              <span className="text-[10px] text-slate-405 font-bold mb-3 uppercase tracking-wider font-mono">
                当前运行中收款码预览
              </span>
              {adminQrUrl ? (
                <div className="relative group">
                  <img
                    src={adminQrUrl}
                    alt="Current Cloud Collection QR"
                    className="w-40 h-40 object-contain rounded-xl border border-slate-200 bg-white p-2 shadow-sm transition-transform hover:scale-102"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none transition-opacity animate-fade-in">
                    <span className="text-white text-[10px] font-bold">运行中</span>
                  </div>
                </div>
              ) : (
                <div className="w-40 h-40 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-405 p-4 text-center">
                  <QrCode className="w-8 h-8 text-slate-350 mb-2" />
                  <span className="text-[10px] font-bold">未配置收款码</span>
                </div>
              )}
              <span className="text-[9px] text-slate-400 font-mono mt-3 max-w-[200px] truncate">
                源: {adminQrUrl.startsWith('data:') ? '本地上传 (Base64 编码)' : adminQrUrl || '空'}
              </span>
            </div>

            {/* Right Box: Settings Form */}
            <div className="lg:col-span-8 space-y-4">
              <div className="p-3.5 bg-amber-500/[0.03] border border-amber-500/15 rounded-2xl">
                <p className="text-[11px] text-amber-800 leading-relaxed font-semibold">
                  <span className="font-sans font-bold text-amber-600">💡 运行逻辑：</span>
                  此处的收款码将用于全局交易对账。管理员在此上传或更改收款码并保存后，会热部署覆盖系统默认的收款绑定。全体普通访客在前台点击【升级账户】时会实现在线热更新，无需重新部署代码即可瞬间生效！
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Method A: File Upload */}
                <div className="border border-slate-150 rounded-2xl p-4 bg-white/50 space-y-3 relative hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 uppercase tracking-tight">
                    <Upload className="w-4 h-4 text-red-500" />
                    <span>方式一：本地上传收款码</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    支持从本地选择微信或支付宝生成的付款二维码图片。
                  </p>
                  
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAdminLocalFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-full py-3 border-2 border-dashed border-slate-250 hover:border-red-500/30 rounded-xl bg-slate-50 hover:bg-slate-100/50 transition-colors flex items-center justify-center gap-2">
                      <Upload className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[11px] text-slate-600 font-bold">选择本地图片</span>
                    </div>
                  </div>
                </div>

                {/* Method B: URL Link */}
                <div className="border border-slate-150 rounded-2xl p-4 bg-white/50 space-y-3 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 uppercase tracking-tight">
                    <ExternalLink className="w-4 h-4 text-red-500" />
                    <span>方式二：网络图片 URL</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    如果您已将收款码图片托管至图床，亦可直接输入其在线 URL 网址。
                  </p>
                  <input
                    type="text"
                    value={adminQrUrl.startsWith('data:') ? '' : adminQrUrl}
                    onChange={(e) => setAdminQrUrl(e.target.value)}
                    placeholder="https://example.com/pay_qr.png"
                    className="w-full h-9 bg-slate-50 hover:bg-slate-100/50 border border-slate-250 rounded-xl px-3 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all placeholder:text-slate-405"
                  />
                </div>
              </div>

              {/* Action save button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                {adminQrUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdminQrUrl('');
                      showToast('预览已重置，请点击右侧“保存配置并部署上线”按钮应用修改。', 'info');
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl border border-slate-250 transition-all select-none cursor-pointer"
                  >
                    重置清空
                  </button>
                )}
                <button
                  type="button"
                  disabled={isConfigSaving}
                  onClick={handleSaveSystemQr}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-900/10 flex items-center gap-1.5 select-none cursor-pointer disabled:opacity-50"
                >
                  {isConfigSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在部署...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>保存配置并部署上线</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 🏷️ PRO 会员定价调整中心 */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-5">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-2xl border border-amber-500/10">
              <CreditCard className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                PRO 会员定价调整中心 (动态定价中心)
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                GLOBAL SYSTEM PRICING MANAGER & DYNAMIC SETTINGS
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Input & Info description */}
            <div className="md:col-span-8 space-y-4">
              <div className="p-3.5 bg-amber-500/[0.03] border border-amber-500/15 rounded-2xl">
                <p className="text-[11px] text-amber-800 leading-relaxed font-semibold">
                  <span className="font-sans font-bold text-amber-600">💡 动态价格逻辑：</span>
                  管理员在此处设置的 PRO 会员授权价格（人民币，元）将被即时写入云端 D1 数据库。前台用户在点击「升级账户」拉起账单以及提交财务确认申请订单时，均会自动实时匹配此处设置的最新的金额标准！
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">￥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adminPrice}
                    onChange={(e) => setAdminPrice(parseFloat(e.target.value) || 0)}
                    placeholder="请输入授权金额（例如 399.00）"
                    className="w-full h-10 bg-slate-50 hover:bg-slate-100/50 border border-slate-250 rounded-xl pl-8 pr-12 text-xs font-black focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-slate-900"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-slate-450">元</span>
                </div>

                <button
                  type="button"
                  disabled={isPriceSaving}
                  onClick={handleSaveSystemPrice}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/60 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-amber-900/10 flex items-center justify-center gap-1.5 select-none cursor-pointer"
                >
                  {isPriceSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>正在更新...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>更新会员价格</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Current Pricing Showcase Box */}
            <div className="md:col-span-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center justify-center min-h-[140px]">
              <span className="text-[9px] text-slate-405 font-black uppercase tracking-wider font-mono mb-2">
                当前云端实时结算标价
              </span>
              <div className="text-3xl font-black text-slate-800 tracking-tight font-sans">
                ￥{adminPrice.toFixed(2)}
              </div>
              <span className="text-[9px] text-emerald-600 font-black bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full mt-2 uppercase tracking-wide">
                ● 实时生效中
              </span>
            </div>
          </div>
        </div>

        {/* 📋 Central Datagrid Filter Panel */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          
          {/* Controls Bar */}
          <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
            
            <div className="flex items-center gap-3">
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索申请邮箱 / 转账人姓名..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 bg-white border border-slate-250 rounded-xl pl-9 pr-4 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-500 transition-all placeholder:text-slate-400"
                />
              </div>

              {/* Status Tabs */}
              <div className="flex bg-slate-200/80 p-1 rounded-xl border border-slate-300/40">
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    statusFilter === 'pending' 
                      ? 'bg-amber-500 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  待审批 ({orders.filter(o => o.status === 'pending').length})
                </button>
                <button
                  onClick={() => setStatusFilter('success')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    statusFilter === 'success' 
                      ? 'bg-emerald-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  已放行 ({orders.filter(o => o.status === 'success').length})
                </button>
                <button
                  onClick={() => setStatusFilter('rejected')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    statusFilter === 'rejected' 
                      ? 'bg-rose-500 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  拒绝通过 ({orders.filter(o => o.status === 'rejected').length})
                </button>
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    statusFilter === 'all' 
                      ? 'bg-slate-800 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  总全量 ({orders.length})
                </button>
              </div>
            </div>

            <button
              onClick={() => fetchOrders()}
              disabled={isLoading}
              className="px-4 h-10 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl border border-slate-250 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>刷新流水</span>
            </button>
          </div>

          {/* Table Area */}
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="py-24 text-center text-slate-400 text-xs font-semibold flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-8 h-8 text-slate-400 animate-spin" />
                <span>正在实时调取全局 D1 收单流水线，请稍候...</span>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <Database className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-xs font-bold">没有找到匹配此过滤器的账单信息</p>
                <p className="text-[11px] text-slate-400">用户在收单中心提交凭证后，此处会触发秒级闪断通知。</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-150 bg-slate-100/40 text-slate-450 uppercase font-bold text-[10px] tracking-wider">
                    <th className="py-3 px-5">账单号 / 创建时间</th>
                    <th className="py-3 px-5">申请邮箱 (User ID)</th>
                    <th className="py-3 px-5">核对信息 / 转账备注</th>
                    <th className="py-3 px-5 text-right">拟定金额</th>
                    <th className="py-3 px-5 text-center">截屏单据凭证</th>
                    <th className="py-3 px-5 text-center">状态</th>
                    <th className="py-3 px-5 text-right">快捷放行</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOrders.map((order, idx) => {
                    const isPending = order.status === 'pending';
                    
                    return (
                      <tr 
                        key={`admin-order-${order.id}-${idx}`} 
                        className={`hover:bg-slate-50/70 transition-colors ${
                          isPending ? 'bg-amber-500/[0.01]' : ''
                        }`}
                      >
                        {/* ID & Date */}
                        <td className="py-4 px-5">
                          <code className="text-[11px] font-black font-mono text-slate-800 block">
                            {order.id}
                          </code>
                          <span className="text-[10px] text-slate-400 font-bold font-mono mt-1 block">
                            {new Date(order.created_at).toLocaleString()}
                          </span>
                        </td>

                        {/* User Email & ID */}
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-405 shrink-0" />
                            <span className="font-bold text-slate-700">{order.email}</span>
                          </div>
                          <span className="text-[9px] font-mono text-slate-400 mt-1 block max-w-[140px] truncate">
                            UID: {order.user_id}
                          </span>
                        </td>

                        {/* Account Verification Info */}
                        <td className="py-4 px-5">
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-700">
                              通道: <span className="text-slate-900 border border-slate-200 px-1 py-0.5 rounded bg-slate-50 text-[10px] font-bold font-mono">{order.payment_method || '微信/支付宝'}</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              转账备注: <span className="text-amber-600 font-bold bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded text-[10px]">{order.voucher_name}</span>
                            </p>
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="py-4 px-5 text-right">
                          <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                            ￥{order.amount ? order.amount.toFixed(2) : '399.00'}
                          </span>
                        </td>

                        {/* Attachment Receipt Thumbnail */}
                        <td className="py-4 px-5 text-center">
                          {order.voucher_screenshot ? (
                            <div className="relative inline-block group">
                              <img
                                src={order.voucher_screenshot}
                                alt="Screenshot Receipt"
                                className="w-10 h-10 object-cover rounded-lg border border-slate-200 cursor-pointer shadow-sm hover:scale-105 transition-all"
                                onClick={() => setZoomImg(order.voucher_screenshot || null)}
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/45 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none transition-opacity">
                                <Eye className="w-3 h-3 text-white" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-405 font-semibold">无图片单据</span>
                          )}
                        </td>

                        {/* Status Label */}
                        <td className="py-4 px-5 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[9px] font-black border uppercase tracking-wider ${
                            order.status === 'success' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-250/50'
                              : order.status === 'rejected'
                              ? 'bg-rose-50 text-rose-600 border-rose-200/50'
                              : 'bg-amber-50 text-amber-700 border-amber-250/60 animate-pulse'
                          }`}>
                            {order.status === 'success' ? '已过账放行' : order.status === 'rejected' ? '拒绝通过' : '等待确收'}
                          </span>
                        </td>

                        {/* Actions or Inline Verify Controls */}
                        <td className="py-4 px-5 text-right whitespace-nowrap">
                          {isPending ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveConfirmAction({ order, status: 'rejected' })}
                                className="w-7 h-7 bg-white hover:bg-rose-50 text-rose-500 hover:text-rose-650 border border-slate-200 hover:border-rose-200 rounded-lg transition-all flex items-center justify-center shadow-inner cursor-pointer"
                                title="驳回作废单据"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => setActiveConfirmAction({ order, status: 'success' })}
                                className="h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black rounded-lg transition-all flex items-center justify-center gap-1 shadow-md shadow-emerald-900/10 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>确认过账</span>
                              </button>
                            </div>
                          ) : (
                            order.status === 'success' ? (
                              <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                                已放行
                              </span>
                            ) : (
                              <span className="text-[10px] text-rose-500 font-bold bg-rose-50 px-2 py-1 rounded-md border border-rose-100">
                                拒绝通过
                              </span>
                            )
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          
        </div>

      </main>

      {/* 🔮 Receipt Image Lightbox Zoom Overlay (Pure CSS & JS Iframe Safe modal) */}
      <AnimatePresence>
        {zoomImg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4"
          >
            <button
              onClick={() => setZoomImg(null)}
              className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2.5 rounded-full text-white transition-all border border-white/10 z-10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              src={zoomImg}
              alt="Receipt zoom"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
              referrerPolicy="no-referrer"
            />
            <div className="text-center text-xs text-slate-400 font-medium font-mono mt-3">
              按上方 [X] 按钮或点击背景返回
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 Sleek Centered Confirmation Modal (Iframe-safe replacement for window.confirm) */}
      <AnimatePresence>
        {activeConfirmAction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
            style={{ pointerEvents: 'auto' }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="max-w-md w-full bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5"
            >
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className={`p-2.5 rounded-2xl ${
                  activeConfirmAction.status === 'success' 
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                    : 'bg-rose-50 text-rose-600 border border-rose-100'
                }`}>
                  {activeConfirmAction.status === 'success' ? (
                    <Check className="w-5 h-5 shrink-0" />
                  ) : (
                    <X className="w-5 h-5 shrink-0" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    {activeConfirmAction.status === 'success' ? '确认支付并升级过账' : '确定驳回订单'}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">FINANCIAL VERIFICATION DOUBLE CONFIRM</p>
                </div>
              </div>

              {/* Order Info Summary Details */}
              <div className="bg-slate-55 rounded-2xl p-4 border border-slate-200/65 space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">申请邮箱:</span>
                  <span className="font-bold text-slate-800">{activeConfirmAction.order.email}</span>
                </div>
                <div className="flex justify-between flex-wrap">
                  <span className="text-slate-400">订单编号:</span>
                  <span className="text-slate-650 text-[10px] break-all">{activeConfirmAction.order.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">核对备注/凭证:</span>
                  <span className="font-bold text-slate-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px]">{activeConfirmAction.order.voucher_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">交易金额:</span>
                  <span className="font-bold text-emerald-600 font-mono">￥{activeConfirmAction.order.amount ? activeConfirmAction.order.amount.toFixed(2) : '399.00'}</span>
                </div>
              </div>

              {activeConfirmAction.order.voucher_screenshot && (
                <div className="bg-slate-55 rounded-2xl p-2 border border-slate-200/60 text-center">
                  <p className="text-[10px] text-slate-400 font-bold mb-1 font-sans">转账单据缩略图 (点击可直接展开大图)</p>
                  <img
                    src={activeConfirmAction.order.voucher_screenshot}
                    alt="Receipt preview"
                    className="max-h-24 rounded-lg mx-auto object-contain shadow-sm hover:scale-102 transition-all cursor-zoom-in"
                    onClick={() => {
                      setZoomImg(activeConfirmAction.order.voucher_screenshot || null);
                    }}
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                {activeConfirmAction.status === 'success' 
                  ? '💡 请务必通过手机微信/支付宝实盘核对账户。确认后，系统将秒级在云端下发 PRO 授权，用户可瞬间解锁消防计算特权。'
                  : '⚠️ 驳回订单后，用户可在前台面板看到自己对应的该交易凭证被退回/驳回。'}
              </p>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => setActiveConfirmAction(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-all border border-slate-200 select-none cursor-pointer font-sans"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={async () => {
                    await handleApproveExecute(activeConfirmAction.order.id, activeConfirmAction.status);
                  }}
                  className={`flex-1 py-2.5 text-white text-xs font-black rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 select-none cursor-pointer font-sans ${
                    activeConfirmAction.status === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-505 shadow-emerald-990/10'
                      : 'bg-rose-600 hover:bg-rose-505 shadow-rose-990/10'
                  }`}
                >
                  {isActionLoading ? '正在确认...' : (activeConfirmAction.status === 'success' ? '确认付款并升级' : '确认作废此单')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
