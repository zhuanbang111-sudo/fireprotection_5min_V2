import React from 'react';
import { Crown, Gem, Zap } from 'lucide-react';

interface StatusBadgeProps {
  user: {
    vip_level?: 'free' | 'pro' | string;
    vip_expires_at?: string | null;
    isTrial?: boolean;
    remaining?: number;
  } | null;
  onUpgradeClick?: () => void;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ user, onUpgradeClick }) => {
  if (!user) return null;

  const isVip = !user.isTrial && user.vip_level === 'pro';

  if (isVip) {
    return (
      <div className="flex items-center gap-1.5">
        {/* PRO 流光流线体徽章 */}
        <div className="relative overflow-hidden flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 border border-amber-500/50 text-slate-950 font-black tracking-widest shadow-[0_0_12px_rgba(245,158,11,0.25)] select-none">
          {/* 金黄色流光修饰线 */}
          <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite_linear]" />
          
          <Crown className="w-2.5 h-2.5 text-slate-950 animate-bounce" />
          <span className="text-[8px] uppercase font-mono tracking-wider font-extrabold">PRO</span>
        </div>
      </div>
    );
  }

  if (user.isTrial) {
    const remaining = user.remaining ?? 0;
    const isWarning = remaining <= 1;

    return (
      <div 
        onClick={onUpgradeClick}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border cursor-pointer hover:scale-105 transition-all select-none ${
          isWarning 
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.1)]' 
            : 'bg-amber-500/10 border-amber-500/30 text-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.1)]'
        }`}
        title="试用状态：点击查看高阶算力详情"
      >
        <Zap className={`w-2.5 h-2.5 ${isWarning ? 'animate-pulse text-rose-500' : 'text-amber-500'}`} />
        <span className="text-[8px] font-black font-mono uppercase tracking-wider">
          {isWarning ? 'LIMIT' : 'TRIAL'}: {remaining}
        </span>
      </div>
    );
  }

  // 默认是 FREE
  return (
    <div className="flex items-center gap-1.5 select-none">
      <div className="flex items-center px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">
        <span className="text-[7px] font-black tracking-wider uppercase font-mono">FREE版</span>
      </div>
      
      {onUpgradeClick && (
        <button
          onClick={onUpgradeClick}
          className="group relative overflow-hidden text-[8px] px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black tracking-wide hover:from-amber-400 hover:to-amber-500 shadow-sm transition-all flex items-center gap-0.5 shrink-0"
        >
          {/* 金辉微光闪烁效果 */}
          <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
          <Gem className="w-2 h-2 text-slate-950" />
          <span>升级 PRO</span>
        </button>
      )}
    </div>
  );
};
