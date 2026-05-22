import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Crown, ShieldAlert, Sparkles, Database, FileDown, Zap, ArrowRight, CheckCircle2, QrCode, ArrowLeft, Heart, Check, Smartphone, Loader2 } from 'lucide-react';
import axios from 'axios';

// ==========================================
// PRO 商业版定价配置（可在代码中随时修改）
// ==========================================
const PRO_PRICE = 0.00; // 默认 0.00 元，支持随时更改，例如 299.00

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
  const [showPayment, setShowPayment] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');

  const handleSimulatedPay = async () => {
    const token = localStorage.getItem('fire_isochrone_auth_token');
    if (!token) {
      setUpgradeError('抱歉，激活服务需要您先“注册”或“登录”账号后，才能将 VIP 权限永久绑定至该账号！请先关闭此弹窗并于系统顶部注册或登录账号。');
      return;
    }

    setIsUpgrading(true);
    setUpgradeError('');
    try {
      const res = await axios.post('/api/auth/upgrade', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.data.success) {
        setPaySuccess(true);
        if (onUpgradeSuccess && res.data.user) {
          onUpgradeSuccess(res.data.user);
        }
        // 延迟 3 秒自动关闭并通知
        setTimeout(() => {
          setPaySuccess(false);
          setShowPayment(false);
          onClose();
        }, 3000);
      } else {
        throw new Error(res.data.message || '激活失败');
      }
    } catch (e: any) {
      console.error('[VIP Activation Error]:', e);
      const errMsg = e.response?.data?.message || e.message || '网络通讯异常，请稍后再试';
      setUpgradeError(`激活服务发生错误: ${errMsg}`);
    } finally {
      setIsUpgrading(false);
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
          className="absolute inset-0 bg-slate-900/65 backdrop-blur-md"
        />

        {/* 升级卡片主容器 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-lg my-auto bg-gradient-to-b from-slate-900 to-slate-950 text-slate-100 rounded-3xl border border-amber-500/30 shadow-[0_25px_50px_-12px_rgba(245,158,11,0.15)] max-h-[90vh] overflow-y-auto z-10 p-6 sm:p-8"
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

          {!showPayment ? (
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
                      批量计算超高能效
                      <span className="text-[9px] bg-red-505/10 text-rose-400 font-mono font-bold">免除单点限制</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      免费版单次仅允许生成 1 个消防站等时圈。而专业版无多点限制，支持几百个车库地址、上万站点一键批量全自动并发测算。
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
                      标准 GIS 矢量数据导出 (WGS84 Shapefile) 🔒
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold">高价值</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      一键导出完全标准的 GIS 面要素成果，直接对接 ArcGIS、QGIS、Mapbox、SuperMap 进行深度制图规划。
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
                      物理隔离企业级高带宽算力专线
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      享用专属边缘加速计算节点，避开公共信道拥堵，支持极速多点投放并提供更稳定的 AMap WebService 查询保障。
                    </p>
                  </div>
                </div>
              </div>

              {/* 开通指南配文 */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 my-4">
                <h5 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 animate-bounce" /> 
                  运维与授权一触即达
                </h5>
                <p className="text-[10px] text-slate-300 mt-1 leading-normal">
                  本系统采用轻量化企业授权。如您所在设计院、规划院或项目处需要常态化计算等时圈：
                </p>
                <div className="mt-2 space-y-1.5 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>联系负责专家提供特定邮箱：<span className="text-amber-200 underline font-mono select-all ml-1">{user?.email || '您的注册邮箱'}</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>通过 D1 付费登记开通，随时支持在下方激活服务。</span>
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
                  一键申请 / 极速审批
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
                    安全收单支付中心
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
                  <h4 className="text-base font-black text-emerald-300">账单及提请发送成功！</h4>
                  <p className="text-xs text-slate-400 text-center max-w-sm leading-relaxed">
                    种子用户免付通道激活。云数据库正向代理将自动对您的邮箱 <span className="text-amber-300 font-mono underline">{user?.email}</span> 映射开通全能权限，即将自动返回地图。
                  </p>
                </div>
              ) : (
                /* ============= 收单二维码主页面 ============= */
                <div className="space-y-5">
                  {/* 金额展示区域 */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center relative overflow-hidden">
                    <p className="text-slate-400 text-[10px] uppercase font-bold tracking-widest mb-1">PRO 专业版终身开通服务</p>
                    <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 font-sans tracking-tight">
                      ￥{PRO_PRICE.toFixed(2)} 元
                    </div>
                    {PRO_PRICE === 0 && (
                      <span className="inline-block mt-1.5 text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/35 px-2 py-0.5 rounded-full font-bold">
                        🎁 种子用户 0 元极速审批，直接扫码登记
                      </span>
                    )}
                  </div>

                  {/* 收费二维码 (微信+支付宝 双通道极简几何 SVG 模拟) */}
                  <div className="flex flex-col items-center space-y-3">
                    <div className="relative p-3 bg-white rounded-3xl shadow-[0_0_30px_rgba(245,158,11,0.1)] border-2 border-amber-550/30">
                      {/* 二维码外边框炫彩边 */}
                      <div className="absolute inset-x-0 -top-1 mx-auto w-24 h-1 bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full" />
                      
                      {/* 纯 SVG 大气二维码图形 */}
                      <svg
                        className="w-40 h-40 text-slate-900"
                        viewBox="0 0 100 100"
                        shapeRendering="crispEdges"
                      >
                        {/* 四角定位图案 (Finder patterns) */}
                        <path d="M0 0h25v25H0zm3 3v19h19V3zm3 3h13v13H6z" fill="currentColor" />
                        <path d="M75 0h25v25H75zm3 3v19h19V3zm3 3h13v13H81z" fill="currentColor" />
                        <path d="M0 75h25v25H0zm3 78v19h19V78zm3 3h13v13H6z" fill="currentColor" />
                        
                        {/* 三处定位点（内角） */}
                        <rect x="9" y="9" width="7" height="7" fill="currentColor" />
                        <rect x="84" y="9" width="7" height="7" fill="currentColor" />
                        <rect x="9" y="84" width="7" height="7" fill="currentColor" />

                        {/* 几何风格的 QR 像素颗粒线条（表示包含用户信息） */}
                        <path d="M30 4h5v5h-5zm0 10h10v5H30zm15-10h15v5H45zm5 10h5v8h-5zm10-5h5v5h-5zm-35 25h10v5H20zm15 5h5v5h-5zm5-5h10v5H40zm15 0h5v8h-5zm10-5h15v5H65zm-25 15h12v5H40zm20 5h5v5h-5zm10-5h5v10H70zm-45 15h15v5H25zm20 0h5v5h-5zm10-10h10v5H55zm15 5h10v5H70z" fill="currentColor" />
                        <path d="M30 60h5v10h-5zm10 5h12v5H40zm15-5h5v5h-5zm5 10h10v5H60zm15-10h15v5H75zm0 15h5v5h-5z" fill="currentColor" />
                        
                        {/* 中间嵌入一个精致的 VIP 聚焦点 */}
                        <rect x="42" y="42" width="16" height="16" rx="4" fill="#f59e0b" />
                        <path d="M47 52l1.5-3 1.5 3h-3zm4 0l1.5-3 1.5 3h-3z" fill="#0f172a" />
                      </svg>

                      {/* 二维码中心金色 LOGO 文字 */}
                      <div className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-slate-900 border border-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <Crown className="w-4 h-4 text-amber-400" />
                      </div>
                    </div>
                    
                    <div className="flex gap-4 text-slate-300 text-xs">
                      <span className="flex items-center gap-1 font-bold">
                        <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                        微信支付
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="flex items-center gap-1 font-bold">
                        <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                        支付宝扫码
                      </span>
                    </div>
                  </div>

                  {/* 引导扫码友情备注 */}
                  <div className="bg-slate-950/50 border border-white/5 rounded-2xl p-3 text-[10px] text-slate-400 space-y-1 text-center md:text-left">
                    <div className="flex items-center gap-1.5 text-amber-400 justify-center md:justify-start">
                      <Heart className="w-3 h-3 text-rose-500 fill-rose-500 animate-[pulse_1s_infinite]" />
                      <span>温馨提示</span>
                    </div>
                    <p className="leading-relaxed">
                      请使用手机扫描双渠道收单二维码。在进行登记或支付后，云服务器将锁定由于 [ {user?.email || '当前账号'} ] 产生的数据，极速通过审核并开放双端数据下载权限。如金额为 0
                      元，可直接点击下方 <span className="text-amber-300 font-bold">我已扫码并提请开通</span> 按钮直达审批网络。
                    </p>
                  </div>

                  {/* 错误信息展示 */}
                  {upgradeError && (
                    <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-3 text-[11px] text-red-400 font-medium">
                      {upgradeError}
                    </div>
                  )}

                  {/* 扫码支付后按钮 */}
                  <div className="pt-2">
                    <button
                      onClick={handleSimulatedPay}
                      disabled={isUpgrading}
                      className={`w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-900/30 tracking-wider transition-all transform hover:scale-[1.01] flex items-center justify-center gap-2 ${
                        isUpgrading ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                    >
                      {isUpgrading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isUpgrading ? '正在联系边缘网络云端授权...' : '我已扫码，立即激活高级服务'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
