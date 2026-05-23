import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Crown, ShieldAlert, Sparkles, Database, FileDown, Zap, 
  ArrowRight, CheckCircle2, QrCode, ArrowLeft, Heart, Check, 
  Smartphone, Loader2, Settings, Upload 
} from 'lucide-react';
import axios from 'axios';

// ==========================================
// PRO 商业版定价配置（已支持后台动态调整与更新）
// ==========================================
const DEFAULT_FALLBACK_PRICE = 399.00;

interface VipModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onUpgradeSuccess?: (updatedUser: any) => void;
  title?: string;
  description?: string;
}

export const VipModal: React.FC<VipModalProps> = ({ 
  isOpen, 
  onClose, 
  user,
  onUpgradeSuccess,
  title = "解锁 PRO 专业版算力特权",
  description = "您的账户当前为【免费试用】状态，请升级以解锁批量测算与核心资产导出权限"
}) => {
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user');
  const [showPayment, setShowPayment] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');

  // 1. 系统配置数据绑定的收款码
  const [customQrUrl, setCustomQrUrl] = useState('');
  const [customAlipayQrUrl, setCustomAlipayQrUrl] = useState('');
  
  // 1.5. 系统配置数据绑定的价格
  const [price, setPrice] = useState<number>(399.00);
  const [adminPriceInput, setAdminPriceInput] = useState<string>('399.00');
  const [isPriceSaving, setIsPriceSaving] = useState(false);
  
  // 2. 交易凭证与申领登记表
  const [voucherName, setVoucherName] = useState('');
  const [voucherScreenshot, setVoucherScreenshot] = useState('');
  
  // 3. 管理端数据与操作状态
  const [adminQrUrl, setAdminQrUrl] = useState('');
  const [adminAlipayQrUrl, setAdminAlipayQrUrl] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);

  // 4. 双重确认状态与弹窗 Toast 代理 (解决 iframe 禁 alert/confirm 阻断点击及无响应的问题)
  const [activeConfirmAction, setActiveConfirmAction] = useState<{ order: any; status: 'success' | 'rejected' } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg(null);
    }, 4500);
  };

  // 判断是否拥有全站超级管理员权限 (zhuanbang111@gmail.com, 714400040@qq.com, zhuanbang111@foxmail.com 或高级 Admin 标签)
  const isAdmin = user && (user.vip_level === 'admin' || ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com'].includes(user.email.toLowerCase().trim()));

  // 获取服务端的全局收款码配置 (热更新)
  const fetchSystemQr = async () => {
    try {
      const res = await axios.get('/api/system/qr');
      if (res.data.success) {
        setCustomQrUrl(res.data.qrUrl || '');
        setCustomAlipayQrUrl(res.data.alipayQrUrl || '');
        setAdminQrUrl(res.data.qrUrl || '');
        setAdminAlipayQrUrl(res.data.alipayQrUrl || '');
      }
    } catch (e) {
      console.error('[Checkout] 获取服务端收款配置出错:', e);
    }
  };

  // 获取订单凭证列表 (非 Admin 仅查个人，Admin 纵览全局)
  const fetchOrders = async () => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) return;
    setIsOrdersLoading(true);
    try {
      const res = await axios.get('/api/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setOrders(res.data.orders || []);
      }
    } catch (e) {
      console.error('[Checkout] 挂载凭证账单列表出错:', e);
    } finally {
      setIsOrdersLoading(false);
    }
  };

  // 获取服务端的账单价格
  const fetchSystemPrice = async () => {
    try {
      const res = await axios.get('/api/system/price');
      if (res.data.success && typeof res.data.price === 'number') {
        setPrice(res.data.price);
        setAdminPriceInput(res.data.price.toString());
      }
    } catch (e) {
      console.error('[VipModal] 获取服务端价格配置出错:', e);
    }
  };

  // 超级管理员保存会员价格
  const handleSaveSystemPrice = async () => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) return;

    const parsedPrice = parseFloat(adminPriceInput);
    if (parsedPrice < 0 || isNaN(parsedPrice)) {
      showToast('请输入有效的会员价格！', 'error');
      return;
    }

    setIsPriceSaving(true);
    try {
      const res = await axios.post('/api/system/price', {
        price: parsedPrice
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        setPrice(parsedPrice);
        showToast(`🎉 全局 PRO 会员价格已更新为 ￥${parsedPrice.toFixed(2)} 元！`, 'success');
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

  // 挂载加载
  useEffect(() => {
    if (isOpen) {
      fetchSystemQr();
      fetchOrders();
      fetchSystemPrice();
      // 默认流式复位
      setShowPayment(false);
      setPaySuccess(false);
      setUpgradeError('');
      setVoucherName('');
      setVoucherScreenshot('');
      setActiveTab('user');
    }
  }, [isOpen]);

  // 处理管理员本地替换上传 (Base64) - 微信
  const handleAdminLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setAdminQrUrl(base64);
        setUpgradeError('');
      }
    };
    reader.onerror = () => {
      setUpgradeError('读取图片大文件失败，请尝试其他格式。');
    };
    reader.readAsDataURL(file);
  };

  // 处理管理员本地替换上传 (Base64) - 支付宝
  const handleAdminAlipayLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setAdminAlipayQrUrl(base64);
        setUpgradeError('');
      }
    };
    reader.onerror = () => {
      setUpgradeError('读取支付宝大文件失败，请尝试其他格式。');
    };
    reader.readAsDataURL(file);
  };

  // 处理用户离线转账截图转换为 Base64 凭证
  const handleVoucherScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setVoucherScreenshot(base64);
        setUpgradeError(''); // 复位错误提示
      }
    };
    reader.onerror = () => {
      setUpgradeError('读取转账截图失败，请重试。');
    };
    reader.readAsDataURL(file);
  };

  // 提交订单凭据 (转账核验申请)
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) {
      setUpgradeError('抱歉，激活服务需要您先“注册”或“登录”账号后，才能将 VIP 权限永久绑定至该账号！请先关闭此弹窗并于系统顶部注册或登录账号。');
      return;
    }

    if (!voucherName.trim()) {
      setUpgradeError('请输入转账人的支付宝/微信账号昵称，或转账账单后 4 位，以便财务比对激活！');
      return;
    }

    setIsUpgrading(true);
    setUpgradeError('');
    try {
      const res = await axios.post('/api/orders', {
        paymentMethod: '微信/支付宝扫码',
        amount: price,
        voucherName: voucherName.trim(),
        voucherScreenshot: voucherScreenshot
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        setPaySuccess(true);
        fetchOrders(); // 刷新本地列表
      } else {
        throw new Error(res.data.message || '凭证申请失败');
      }
    } catch (e: any) {
      console.error('[Submit Order Error]', e);
      setUpgradeError(e.response?.data?.message || e.message || '网络繁忙，凭证转账申请未成功传送');
    } finally {
      setIsUpgrading(false);
    }
  };

  // 管理员保存系统全局配置
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
        setCustomQrUrl(res.data.qrUrl);
        setCustomAlipayQrUrl(res.data.alipayQrUrl);
        showToast('🎉 全局云端双重收款码热部署上线！全体普通访客现在将直接显示这组新收款信息。', 'success');
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

  // 管理员一键确收、升级过账
  const handleApproveOrderExecute = async (orderId: string, status: 'success' | 'rejected') => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) return;

    setIsActionLoading(true);
    setActiveConfirmAction(null);
    try {
      const res = await axios.post('/api/orders/approve', {
        orderId,
        status
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        fetchOrders(); // 刷新全局数据
        showToast(`🎉 审批指令执行成功！ ${status === 'success' ? '核心 PRO 算力已秒级拨付到该用户账户。' : '账单已标红作废。'}`, 'success');

        // 如果刚好是在核验自己账单，一并主动回调刷新主站状态
        const matched = orders.find(o => o.id === orderId);
        if (matched && status === 'success') {
          if (onUpgradeSuccess) {
            onUpgradeSuccess({ ...user, vip_level: 'pro' });
          }
        }
      } else {
        showToast(res.data.message || '操作异常', 'error');
      }
    } catch (e: any) {
      console.error('[Approve Action Error]', e);
      showToast(e.response?.data?.message || '无法提交审批请求', 'error');
    } finally {
      setIsActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
        {/* 背景毛玻璃遮罩 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (!paySuccess) {
              setShowPayment(false);
              onClose();
            }
          }}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
        />

        {/* 升级卡片主容器 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-xl my-auto bg-gradient-to-b from-slate-900 to-slate-950 text-slate-100 rounded-3xl border border-amber-500/30 shadow-[0_25px_50px_-12px_rgba(245,158,11,0.15)] max-h-[92vh] overflow-y-auto z-10 p-6 sm:p-7"
        >
          {/* 金黄色渐变背景修饰 */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />

          {/* 右上角关闭按钮 */}
          {!paySuccess && (
            <button
              onClick={() => {
                setShowPayment(false);
                onClose();
              }}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Custom Toast Message Alert Overlay (解决 iframe 阻断系统 alert 的优秀方案) */}
          <AnimatePresence>
            {toastMsg && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                className={`mb-5 p-3.5 rounded-2xl text-xs font-black shadow-lg border flex items-center gap-2 ${
                  toastMsg.type === 'success'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-emerald-900/10'
                    : toastMsg.type === 'error'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 shadow-rose-900/10'
                    : 'bg-slate-800 text-slate-200 border-slate-700/60'
                }`}
              >
                <Sparkles className="w-4 h-4 shrink-0 animate-pulse text-amber-400" />
                <span>{toastMsg.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 👑 管理员双卡页快捷切换导轨 (仅管理员可见) */}
          {isAdmin && (
            <div className="flex bg-slate-950/90 rounded-2xl p-1 mb-5 border border-white/5 w-fit">
              <button
                maxLength={40}
                type="button"
                onClick={() => setActiveTab('user')}
                className={`px-4 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeTab === 'user' 
                    ? 'bg-amber-500/90 text-slate-950 shadow-md shadow-amber-500/15'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                💳 收单前台面板
              </button>
              <button
                maxLength={40}
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeTab === 'admin' 
                    ? 'bg-rose-500 text-white shadow-md shadow-rose-500/15'
                    : 'text-rose-400 hover:text-rose-300'
                }`}
              >
                ⚙️ 管理控制舱 (Admin)
              </button>
            </div>
          )}

          {activeTab === 'admin' && isAdmin ? (
            /* ================= 管理后台超级仪表盘面板 ================= */
            <div className="space-y-6">
              <div className="border-b border-rose-500/15 pb-4">
                <h3 className="text-base font-black text-rose-300 flex items-center gap-1.5">
                  <Settings className="w-5 h-5 animate-spin duration-3000" />
                  D1 财务及云支付安全配置中心
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5 font-mono">ROOT MASTER CONSOLE • ZH_ENG CONTROL PANEL</p>
              </div>

              {/* 1. 云端收款码管控配置 */}
              <div className="bg-slate-950/60 rounded-2xl p-4 border border-rose-500/10 space-y-4 shadow-inner">
                <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                  🔧 配置系统收款码 (微信与支付宝 D1 映射)
                </span>
                
                <div className="space-y-4 text-xs">
                  {/* WeChat Configuration */}
                  <div className="space-y-2 border border-emerald-500/20 p-3 rounded-xl bg-emerald-950/10">
                    <span className="text-[11px] font-black text-emerald-400">微信收款码设置</span>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 block pb-1">方案 A: 网络 URL 链接</label>
                      <input type="text" value={adminQrUrl} onChange={(e) => setAdminQrUrl(e.target.value)} placeholder="如: https://.../wx-pay.png" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 focus:border-rose-500 font-mono text-[10px]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 block pt-1 pb-1">方案 B: 快捷上传 (保留 Base64)</label>
                      <div className="flex gap-2">
                        <label className="flex-1 flex items-center justify-center gap-1.5 border border-dashed border-emerald-800/50 hover:border-emerald-500/50 rounded-lg py-1.5 px-3 bg-slate-900/50 cursor-pointer text-[10px] text-slate-300 hover:text-emerald-300 transition-all">
                          <Upload className="w-3 h-3" /> 加载微信收款码 <input type="file" accept="image/*" onChange={handleAdminLocalFileChange} className="hidden" />
                        </label>
                        {adminQrUrl && <button type="button" onClick={() => setAdminQrUrl('')} className="px-3 bg-slate-900 text-slate-400 border border-slate-800 rounded-lg text-[10px]">重置</button>}
                      </div>
                    </div>
                  </div>

                  {/* Alipay Configuration */}
                  <div className="space-y-2 border border-blue-500/20 p-3 rounded-xl bg-blue-950/10">
                    <span className="text-[11px] font-black text-blue-400">支付宝收款码设置</span>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 block pb-1">方案 A: 网络 URL 链接</label>
                      <input type="text" value={adminAlipayQrUrl} onChange={(e) => setAdminAlipayQrUrl(e.target.value)} placeholder="如: https://.../alipay.png" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 focus:border-rose-500 font-mono text-[10px]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 block pt-1 pb-1">方案 B: 快捷上传 (保留 Base64)</label>
                      <div className="flex gap-2">
                        <label className="flex-1 flex items-center justify-center gap-1.5 border border-dashed border-blue-800/50 hover:border-blue-500/50 rounded-lg py-1.5 px-3 bg-slate-900/50 cursor-pointer text-[10px] text-slate-300 hover:text-blue-300 transition-all">
                          <Upload className="w-3 h-3" /> 加载支付宝收款码 <input type="file" accept="image/*" onChange={handleAdminAlipayLocalFileChange} className="hidden" />
                        </label>
                        {adminAlipayQrUrl && <button type="button" onClick={() => setAdminAlipayQrUrl('')} className="px-3 bg-slate-900 text-slate-400 border border-slate-800 rounded-lg text-[10px]">重置</button>}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveSystemQr}
                    disabled={isConfigSaving}
                    className="w-full py-2 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white rounded-xl text-xs font-black tracking-wider shadow-lg shadow-rose-950/40 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isConfigSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '💾 热更新部署至 D1 数据库'}
                  </button>
                </div>
              </div>

              {/* Token price setup config */}
              <div className="bg-slate-950/60 rounded-2xl p-4 border border-rose-500/10 space-y-4 shadow-inner">
                <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                  🏷️ PRO 会员定价调整 (D1 映射)
                </span>
                
                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block font-bold">设置授权标价费用 (元)</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">￥</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={adminPriceInput}
                          onChange={(e) => setAdminPriceInput(e.target.value)}
                          placeholder="如: 399.00"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500 font-mono text-[11px]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveSystemPrice}
                        disabled={isPriceSaving}
                        className="px-4 py-2 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white rounded-xl text-xs font-black tracking-wider shadow-lg shadow-rose-950/40 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isPriceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '更新价格'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. 待审/已批订单账目审计表 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    📑 扫码付款申请流水 (Orders Matrix)
                  </span>
                  <button
                    onClick={fetchOrders}
                    className="text-[10px] text-slate-400 hover:text-white bg-white/5 border border-white/5 px-2 py-1 rounded"
                  >
                    刷新账单
                  </button>
                </div>

                {isOrdersLoading ? (
                  <div className="py-10 text-center text-xs text-slate-500">正在调取云端账单流水...</div>
                ) : orders.length === 0 ? (
                  <div className="py-8 bg-slate-950/30 rounded-2xl border border-white/5 text-center text-[11px] text-slate-500">
                    目前尚未收到交易审批账目，用户提交凭证后会自动显示于此处
                  </div>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {orders.map((item, idx) => (
                      <div key={`order-item-${item.id}-${idx}`} className="bg-slate-950/70 border border-slate-800/60 rounded-xl p-3.5 space-y-3 text-xs leading-normal">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-bold text-slate-100 font-mono text-[11px]">单号: {item.id}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">申请者: {item.email}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
                            item.status === 'success' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : item.status === 'rejected'
                              ? 'bg-slate-800 text-slate-500 border border-slate-700/60'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                          }`}>
                            {item.status === 'success' ? 'SUCCESS 已过账' : item.status === 'rejected' ? 'REJECTED 已驳回' : 'PENDING 待确收'}
                          </span>
                        </div>

                        <div className="bg-slate-900/50 p-2.5 rounded-lg space-y-1 text-[11px] font-mono border border-slate-900">
                          <div>转账人核对凭证: <span className="text-amber-300 font-bold">{item.voucher_name}</span></div>
                          <div>交易拟定金额: <span className="text-emerald-400">￥{item.amount}</span></div>
                          <div className="text-[10px] text-slate-500">创建于: {new Date(item.created_at).toLocaleString()}</div>
                        </div>

                        {item.voucher_screenshot && (
                          <div className="bg-slate-900/30 rounded-lg p-1 text-center border border-slate-800/40">
                            <span className="text-[9px] text-rose-300 block mb-1 font-bold">付款截图凭证预览：</span>
                            <img
                              src={item.voucher_screenshot}
                              className="max-h-40 max-w-full rounded mx-auto object-contain cursor-zoom-in"
                              alt="Voucher"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}

                        {item.status === 'pending' && (
                          <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800/40">
                            <button
                              type="button"
                              onClick={() => setActiveConfirmAction({ order: item, status: 'rejected' })}
                              className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] font-bold rounded-xl border border-slate-800/45 transition-all cursor-pointer"
                            >
                              ❌ 驳回订单
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveConfirmAction({ order: item, status: 'success' })}
                              className="flex-1 py-1.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-[10px] font-black rounded-xl transition-all shadow-md shadow-emerald-900/15 cursor-pointer"
                            >
                              ✅ 确认过账 (自动升级用户)
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : !showPayment ? (
            /* ================= 主特权介绍页面 ================= */
            <>
              {/* 模态框头部 */}
              <div className="text-center pt-2 pb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-4 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse">
                  <Crown className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-amber-100 tracking-tight flex items-center justify-center gap-2">
                  {title}
                  <span className="text-[10px] uppercase font-bold tracking-widest bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">PRO v2</span>
                </h3>
                <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                  {description}
                </p>
              </div>

              {/* 核心权益对比卡片 */}
              <div className="space-y-3 my-4">
                {/* 特权 1 */}
                <div className="flex items-start gap-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      批量计算保护专线
                      <span className="text-[9px] bg-amber-500/10 text-amber-400 font-mono font-bold">免除单点限制</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      免费版单次仅允许生成第一个消防工作点。升级 PRO 专业版，支持无限地点批量投放、全自动多站点并行精密等时圈测算。
                    </p>
                  </div>
                </div>

                {/* 特权 2 */}
                <div className="flex items-start gap-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                    <FileDown className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      标准 GIS 矢量数据一秒导出 (WGS84 Shapefile) 🔒
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold">高价值</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      一键快速下载带有地理测距坐标的精密 WGS84 消防空间覆盖多边形（Shapefile 压包格式），轻松在 ArcGIS、QGIS 进行深度专业制图。
                    </p>
                  </div>
                </div>

                {/* 特权 3 */}
                <div className="flex items-start gap-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100">
                      多维度全景空间分析聚合报告 (Summary PDF)
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      智能整合已生成的所有站点等时圈面积、覆盖消防缺口、人口承载力和地理几何，生成图文并茂的规划成果决策汇总。
                    </p>
                  </div>
                </div>
              </div>

              {/* 开通指南配文 */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 my-4">
                <h5 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 animate-bounce" /> 
                  账单登记与授权一触即达
                </h5>
                <p className="text-[10px] text-slate-300 mt-1 leading-normal">
                  本系统采用云服务 D1 自动核验机制。如您所在设计院、消防大队、研究所需要常态化开通使用：
                </p>
                <div className="mt-2 space-y-1.5 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>特定绑定邮箱档案：<span className="text-amber-200 underline font-mono select-all ml-1">{user?.email || '您的注册邮箱'}</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>扫描专属收款展示页转入开通，并在页面一键提交，静候管理员 1 分钟一键通过！</span>
                  </div>
                </div>
              </div>

              {/* 底部动作区域 */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="w-full sm:w-1/3 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all outline-none"
                >
                  保持免费使用
                </button>
                <button
                  onClick={() => setShowPayment(true)}
                  className="w-full sm:w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-slate-950 font-black text-xs hover:from-amber-400 hover:to-amber-500 shadow-lg shadow-amber-900/30 hover:shadow-amber-500/30 flex items-center justify-center gap-1.5 group transition-all"
                >
                  一键扫码 / 自主登记
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </>
          ) : (
            /* ================= 收费二维码与收银台结算面 ================= */
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* 顶部标题及回退 */}
              <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                {!paySuccess && (
                  <button
                    onClick={() => setShowPayment(false)}
                    className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div>
                  <h3 className="text-base font-black text-slate-100 flex items-center gap-1.5">
                    <QrCode className="w-5 h-5 text-amber-400" />
                    安全收单自助结算中心
                  </h3>
                  <p className="text-[10px] text-slate-400">正在为账号: {user?.email || '当前注册终端'} 下发高级服务</p>
                </div>
              </div>

              {paySuccess ? (
                /* ============= 成功支付过渡状态 ============= */
                <div className="flex flex-col items-center justify-center py-10 space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.2)] animate-[bounce_1.5s_infinite]">
                    <Check className="w-8 h-8" strokeWidth={3} />
                  </div>
                  <h4 className="text-base font-black text-emerald-300">付款核对凭据已安全过账！</h4>
                  <p className="text-xs text-slate-400 text-center max-w-sm leading-relaxed">
                    您的登记订单（单号自动下发）已被 D1 云数据库安全锁存。管理员将在 1-5 分钟内核实钱款微信/支付宝到账，后台一键过账开通。
                    系统已自动为您载入申请历史。感谢您的鼎力支持！
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPaySuccess(false);
                      setShowPayment(false);
                      onClose();
                    }}
                    className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                  >
                    返回地图
                  </button>
                </div>
              ) : (
                /* ============= 收单二维码主页面 ============= */
                <div className="space-y-5">
                  {/* 金额展示区域 */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center relative overflow-hidden">
                    <p className="text-slate-400 text-[10px] uppercase font-bold tracking-widest mb-1">PRO 专业版终身授权费用</p>
                    <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 font-sans tracking-tight">
                      ￥{price.toFixed(2)} 元
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                    {/* 左侧：双重付款二维码展示 */}
                    <div className="flex flex-col items-center justify-center space-y-4 bg-slate-950/40 p-4 shrink-0 rounded-3xl border border-white/5 w-full overflow-hidden">
                      <div className="flex flex-row justify-evenly items-center w-full overflow-x-auto pb-2 custom-scrollbar gap-4">
                        {/* 微信二维码 */}
                        <div className="flex flex-col items-center space-y-2 min-w-[200px] max-w-[45%] shrink-0">
                          <div className="relative p-3 bg-white border-4 border-[#f59e0b] w-full aspect-square shadow-lg flex items-center justify-center">
                            {customQrUrl ? (
                              <img 
                                src={customQrUrl} 
                                className="w-full h-full object-contain payment-qr-code" 
                                alt="微信收单二维码" 
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-slate-100">
                                <QrCode className="w-16 h-16 text-slate-400" />
                              </div>
                            )}
                          </div>
                          <span className="flex items-center gap-1 font-bold text-xs text-emerald-400">
                            <Smartphone className="w-4 h-4 text-emerald-400" />
                            微信扫码
                          </span>
                        </div>

                        {/* 支付宝二维码 */}
                        <div className="flex flex-col items-center space-y-2 min-w-[200px] max-w-[45%] shrink-0">
                          <div className="relative p-3 bg-white border-4 border-[#f59e0b] w-full aspect-square shadow-lg flex items-center justify-center">
                            {customAlipayQrUrl ? (
                              <img 
                                src={customAlipayQrUrl} 
                                className="w-full h-full object-contain payment-qr-code" 
                                alt="支付宝收单二维码" 
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-slate-100">
                                <QrCode className="w-16 h-16 text-slate-400" />
                              </div>
                            )}
                          </div>
                          <span className="flex items-center gap-1 font-bold text-xs text-sky-400">
                            <Smartphone className="w-4 h-4 text-sky-400" />
                            支付宝扫码
                          </span>
                        </div>
                      </div>
                      
                      <div className="text-[10px] text-slate-500 text-center font-bold">
                        手机可左右滑动查看二维码，支持任意方式付款
                      </div>
                    </div>

                    {/* 右侧：交易核验认领申领表单 */}
                    <form onSubmit={handleSubmitOrder} className="space-y-3 text-left">
                      <span className="text-[11px] font-black text-amber-400 block tracking-wider uppercase">📝 完成支付后填写下表认领</span>
                      
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 block font-bold">您的微信/支付宝转账昵称 或 单号后4位 (必填)</label>
                        <input
                          type="text"
                          required
                          value={voucherName}
                          onChange={(e) => setVoucherName(e.target.value)}
                          placeholder="例如: 张三(微信) 或 后四位9821"
                          className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-all"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 block font-bold">附带支付成功截图（可选，极速秒审）</label>
                        <label className="w-full flex items-center justify-center gap-1.5 border border-dashed border-slate-700/60 rounded-xl py-2 px-3 bg-slate-950/40 hover:bg-slate-950 text-slate-400 hover:text-amber-400 cursor-pointer text-[10px] font-bold transition-all">
                          <Upload className="w-3.5 h-3.5" />
                          <span>{voucherScreenshot ? '已装载付款截图一张' : '点击上传转账回单截图'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleVoucherScreenshotChange}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {upgradeError && (
                        <div className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/10 p-2 rounded-lg font-medium">
                          {upgradeError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isUpgrading}
                        className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 mt-1"
                      >
                        {isUpgrading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {isUpgrading ? '正在提交凭证至主站云端...' : '我已扫码并提交核查'}
                      </button>
                    </form>
                  </div>

                  {/* 引导扫码友情备注 */}
                  <div className="bg-slate-950/50 border border-white/5 rounded-2xl p-3 text-[10px] text-slate-400 space-y-1 text-center md:text-left">
                    <div className="flex items-center gap-1.5 text-amber-400 justify-center md:justify-start font-black">
                      <Heart className="w-3 h-3 text-rose-500 fill-rose-500 animate-[pulse_1s_infinite]" />
                      <span>资金隔离与确收承诺</span>
                    </div>
                    <p className="leading-relaxed">
                      云端账册独立审计运行。您填入的转账核对单将直接写入 D1 数据库锁存，您的邮箱 <span className="text-amber-300 font-mono underline">{user?.email}</span> 会永久打上特权标记，在管理员核对微信/支付宝后自动极速解锁过账（支持人工 1v1 客服通道支持拦截升级！）。
                    </p>
                  </div>

                  {/* 普通用户自己提交的登记历史审核进度查看 */}
                  {orders.length > 0 && (
                    <div className="bg-slate-950/30 border border-white/5 rounded-2xl p-3 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-widest">您的申领账单核查状态历史 (D1 Records)：</span>
                      <div className="space-y-1.5 text-[10px] max-h-24 overflow-y-auto pr-1">
                        {orders.map((item, idx) => (
                          <div key={`order-history-${item.id}-${idx}`} className="flex items-center justify-between py-1 border-b border-white/5 font-mono">
                            <span className="text-slate-400">单号: {item.id}</span>
                            <span className="text-slate-300">凭证: {item.voucher_name}</span>
                            <span className={`px-1 rounded-sm text-[8px] font-bold ${
                              item.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                              item.status === 'rejected' ? 'bg-slate-800 text-slate-500' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {item.status === 'success' ? 'SUCCESS 确收Pro' : item.status === 'rejected' ? 'REJECTED 驳回' : 'PENDING 审核中'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* 🚀 Sleek Centered Confirmation Modal Overlay (Iframe-safe replacement for window.confirm) */}
      <AnimatePresence>
        {activeConfirmAction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans text-slate-200"
            style={{ pointerEvents: 'auto' }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="max-w-md w-full bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-850/60 space-y-5"
            >
              <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <div className={`p-2.5 rounded-2xl ${
                  activeConfirmAction.status === 'success' 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }`}>
                  {activeConfirmAction.status === 'success' ? (
                    <Check className="w-5 h-5 shrink-0" />
                  ) : (
                    <X className="w-5 h-5 shrink-0" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-100">
                    {activeConfirmAction.status === 'success' ? '确认支付并开启 PRO 商业赋权' : '驳回/作废申请单'}
                  </h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider font-mono">FINANCIAL VERIFICATION CONSOLE</p>
                </div>
              </div>

              {/* Order Info Summary Details */}
              <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800 space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">申请人邮箱:</span>
                  <span className="font-bold text-slate-200">{activeConfirmAction.order.email}</span>
                </div>
                <div className="flex justify-between flex-wrap">
                  <span className="text-slate-400">单编号:</span>
                  <span className="text-slate-400 text-[10px] break-all">{activeConfirmAction.order.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">核对凭证姓名:</span>
                  <span className="font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">{activeConfirmAction.order.voucher_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">拟定充值金额:</span>
                  <span className="font-bold text-emerald-400">￥{activeConfirmAction.order.amount ? Number(activeConfirmAction.order.amount).toFixed(2) : '399.00'}</span>
                </div>
              </div>

              {activeConfirmAction.order.voucher_screenshot && (
                <div className="bg-slate-950/30 rounded-2xl p-2 border border-slate-800 text-center">
                  <p className="text-[10px] text-slate-400 font-bold mb-1">转账单据截图</p>
                  <img
                    src={activeConfirmAction.order.voucher_screenshot}
                    alt="Receipt preview"
                    className="max-h-24 rounded-lg mx-auto object-contain shadow-sm"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              <p className="text-xs text-slate-400 leading-relaxed font-semibold">
                {activeConfirmAction.status === 'success' 
                  ? '💡 请确认您已收到对应的微信、支付宝、网银等线下款项。确认后，系统会直接在 D1 数据库中对此账单进行过账，同时在 1 秒内为该用户邮箱升级为 PRO 会员特权、到期日自动顺延 1 年。'
                  : '⚠️ 确认驳回该申请？驳回后该申请将被标记为过期/异常驳回，对普通端用户公开，不会赋予特殊算力。'}
              </p>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => setActiveConfirmAction(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700/60 select-none cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={async () => {
                    await handleApproveOrderExecute(activeConfirmAction.order.id, activeConfirmAction.status);
                  }}
                  className={`flex-1 py-2.5 text-white text-xs font-black rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 select-none cursor-pointer ${
                    activeConfirmAction.status === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20'
                      : 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/20'
                  }`}
                >
                  {isActionLoading ? '正在提报过账...' : (activeConfirmAction.status === 'success' ? '确认支付并授权' : '确认作废此单')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
};
