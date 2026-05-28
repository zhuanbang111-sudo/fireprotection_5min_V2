import React, { useMemo } from 'react';
import { 
  FileText, 
  TrendingUp, 
  MapPin, 
  Layers, 
  Percent, 
  Activity, 
  ShieldAlert, 
  Cpu, 
  Download, 
  FileDown,
  ChevronRight,
  TrendingDown
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface Station {
  station_name: string;
  lng: number;
  lat: number;
}

interface AnalysisResult {
  station: Station;
  geometry: any;
  area: number;
  poiCount: number;
  poiStats?: Record<string, number>;
  apiCalls: number;
  timestamp: string;
}

interface SummaryReportProps {
  results: AnalysisResult[];
  user: any;
}

export const SummaryReport: React.FC<SummaryReportProps> = ({ results, user }) => {
  // 1. 核心指标聚合计算
  const stats = useMemo(() => {
    if (results.length === 0) return null;

    const totalStations = results.length;
    const totalArea = parseFloat(results.reduce((acc, r) => acc + r.area, 0).toFixed(2));
    const avgArea = parseFloat((totalArea / totalStations).toFixed(2));
    const totalPoi = results.reduce((acc, r) => acc + r.poiCount, 0);
    const avgPoi = parseFloat((totalPoi / totalStations).toFixed(1));
    const totalCalls = results.reduce((acc, r) => acc + r.apiCalls, 0);

    // 计算最值
    let maxAreaResult = results[0];
    let minAreaResult = results[0];
    let maxPoiResult = results[0];

    results.forEach(r => {
      if (r.area > maxAreaResult.area) maxAreaResult = r;
      if (r.area < minAreaResult.area) minAreaResult = r;
      if (r.poiCount > maxPoiResult.poiCount) maxPoiResult = r;
    });

    // 计算均方差（评估覆盖均匀度）
    const variance = results.reduce((acc, r) => acc + Math.pow(r.area - avgArea, 2), 0) / totalStations;
    const stdDev = parseFloat(Math.sqrt(variance).toFixed(2));
    
    // 空间均匀度评级 (变异系数 = 标准差 / 平均值)
    const cv = avgArea > 0 ? stdDev / avgArea : 0;
    let uniformityText = '未知';
    let uniformityColor = 'text-slate-500';
    if (cv < 0.2) {
      uniformityText = '极高 (站点配属均衡)';
      uniformityColor = 'text-emerald-500 bg-emerald-500/10';
    } else if (cv < 0.4) {
      uniformityText = '中等 (符合常规带状/面状分布)';
      uniformityColor = 'text-amber-500 bg-amber-500/10';
    } else {
      uniformityText = '较低 (存在显著的空间服务盲区或单极核心站)';
      uniformityColor = 'text-red-500 bg-red-500/10';
    }

    return {
      totalStations,
      totalArea,
      avgArea,
      totalPoi,
      avgPoi,
      totalCalls,
      maxAreaName: maxAreaResult.station.station_name,
      maxArea: maxAreaResult.area,
      minAreaName: minAreaResult.station.station_name,
      minArea: minAreaResult.area,
      maxPoiName: maxPoiResult.station.station_name,
      maxPoi: maxPoiResult.poiCount,
      stdDev,
      cv,
      uniformityText,
      uniformityColor
    };
  }, [results]);

  // 计算本次分析所覆盖的各类重要 POI 累计总数
  const poiCategoryTotals = useMemo(() => {
    const totals = {
      '学校': 0,
      '医院': 0,
      '加油站': 0,
      '公共服务设施': 0,
      '居民区': 0,
      '商场': 0,
      '其他': 0
    };
    results.forEach(r => {
      if (r.poiStats) {
        Object.keys(totals).forEach(key => {
          const k = key as keyof typeof totals;
          totals[k] += r.poiStats[k] || 0;
        });
      } else {
        totals['其他'] += r.poiCount || 0;
      }
    });
    return totals;
  }, [results]);

  // 2. 导出 PDF 报表 (专业 bilingual 结构，规避中文乱码的同时确保极高的视觉规格)
  const downloadPdfReport = () => {
    if (!stats || results.length === 0) return;

    // 初始化 jsPDF，默认为 A4 纸张尺寸
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const timestamp = new Date().toLocaleString();
    const userEmail = user?.email || 'Guest User (Offline Account)';

    // ---【第 1 部分：精致页眉饰条】---
    doc.setFillColor(30, 41, 59); // 深蓝灰 Slate-900 装饰带
    doc.rect(0, 0, 210, 8, 'F');
    doc.setFillColor(239, 68, 68); // 消防红 Red-500 accent 饰条
    doc.rect(0, 8, 210, 1.5, 'F');

    // ---【第 2 部分：报表大标题】---
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42); // Slate-900
    doc.text('FIRE ISOCHRONE & COVERAGE REPORT', 15, 23);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text('Computational Fire Safety & Spatial Reach Assessment Summary', 15, 28);

    // 绘制灰色细分割线
    doc.setDrawColor(226, 232, 240); // Slate-200
    doc.setLineWidth(0.4);
    doc.line(15, 32, 195, 32);

    // ---【第 3 部分：报表元数据元组】---
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105); // Slate-600
    doc.text('REPORT METADATA:', 15, 39);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    
    // 打印元数据
    doc.text(`* Generated On: ${timestamp}`, 15, 44);
    doc.text(`* Analyst Account: ${userEmail}`, 15, 48);
    doc.text(`* Analysis System: Fireisochrone PRO V2 (Cloudflare Edge Engine)`, 15, 52);
    doc.text('* Data Target: GIS Professional Standard Shapes', 15, 56);

    // ---【第 4 部分：聚合统计核心面板 Grid】---
    doc.setDrawColor(241, 245, 249);
    doc.setFillColor(248, 250, 252); // Soft light background
    doc.rect(15, 62, 180, 48, 'FD'); // 绘制大面板背景

    // 面板内大字标核心指标
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('KEY CUMULATIVE METRICS', 20, 68);

    // 第一列
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Total Stations Analyzed:', 20, 75);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(239, 68, 68); // 消防红
    doc.text(`${stats.totalStations} Stations`, 20, 81);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Total Covered Area (sq km):', 20, 90);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`${stats.totalArea} km2`, 20, 96);

    // 第二列
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Average Coverage (sq km):', 90, 75);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`${stats.avgArea} km2 / station`, 90, 81);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Total POI Anchors Load:', 90, 90);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`${stats.totalPoi} Points`, 90, 96);

    // 第三列 (最值)
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Max Reach Station:', 150, 75);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`${stats.maxArea} km2`, 150, 81);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Variance Deviation Index:', 150, 90);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${stats.stdDev}`, 150, 96);

    // ---【第 5 部分：等时圈明细表格】---
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('DETAILED COGNITIVE ANALYSIS PER STATION', 15, 118);

    // 格式化表格数据
    const tableRows = results.map((r, i) => [
      `Station #${i + 1}`,
      r.station.station_name, 
      `${r.area} sq km`, 
      `${r.poiCount} Points`, 
      `${r.apiCalls} Calls`,
      r.timestamp.split(' ')[1] || r.timestamp
    ]);

    // 使用 autoTable 插件快速排版精密表格
    // @ts-ignore
    doc.autoTable({
      startY: 122,
      margin: { left: 15, right: 15 },
      head: [['ID', 'STATION IDENTIFIER', 'COVERAGE AREA', 'POI ANCHORS', 'API OVERHEAT', 'TIME']],
      body: tableRows,
      theme: 'striped',
      headStyles: {
        fillColor: [30, 41, 59], // Dark Slate
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left'
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [51, 65, 85]
      },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 55, fontStyle: 'bold' },
        2: { cellWidth: 35 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25 },
        5: { cellWidth: 25 }
      }
    });

    // ---【第 6 部分：系统智能规划建议 (INSIGHTS)】---
    // 获取 autoTable 结束后的 Y 坐标
    // @ts-ignore
    const finalY = doc.lastAutoTable.finalY || 180;
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('SYSTEM ANALYSIS & REGULATION INSIGHTS', 15, finalY + 10);

    doc.setFillColor(254, 242, 242); // Soft warm red border-left card for safety alerts
    doc.rect(15, finalY + 14, 180, 31, 'F');
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(1);
    doc.line(15, finalY + 14, 15, finalY + 45);

    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(153, 27, 27); // Dark red
    doc.text('Key Recommendation & Spatial Balancing:', 20, finalY + 19);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(127, 29, 29);
    doc.text(`* Standard coverage variance: ${stats.stdDev} (${stats.cv < 0.3 ? 'Balanced Reach' : 'High Deviation Detected'}).`, 20, finalY + 24);
    
    doc.text(`* Priority Intervention: The min coverage station "${stats.minAreaName}" has an active area of only ${stats.minArea} km2.`, 20, finalY + 29);
    doc.text(`  Consider optimizing road connectivity or re-aligning dispatch zones to expand its physical reach boundaries.`, 20, finalY + 33);
    doc.text(`* High Load Balancing: "${stats.maxPoiName}" monitors ${stats.maxPoi} critical POI anchors. Allocate higher contingency backup.`, 20, finalY + 37);
    
    // 增加各类型重要 POI 汇总数据行的 PDF 输出
    const breakdownStr = `Schools: ${poiCategoryTotals['学校']} | Hospitals: ${poiCategoryTotals['医院']} | Gas Station: ${poiCategoryTotals['加油站']} | Public Serv: ${poiCategoryTotals['公共服务设施']} | Residentials: ${poiCategoryTotals['居民区']} | Malls: ${poiCategoryTotals['商场']} | Others: ${poiCategoryTotals['其他']}`;
    doc.setFont('Helvetica', 'bold');
    doc.text(`* POI Category Demographics Breakdown: ` + breakdownStr, 20, finalY + 41);

    // ---【第 7 部分：精致页脚】---
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.4);
    doc.line(15, 280, 195, 280);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184); // Slate-400
    doc.text('Generated via Fireisochrone PRO V2 - Computational Fire Response Engine.', 15, 285);
    doc.text('Page 1 of 1', 195, 285, { align: 'right' });

    // 触发 PDF 下载
    doc.save(`fire_reach_report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (results.length === 0 || !stats) {
    return (
      <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-8 text-center max-w-lg mx-auto" id="no-report-placeholder">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-bold text-slate-700 mb-1">暂无空间聚合分析成果</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          请在左侧“分析”控制面板载入消防站点数据，并运行等时圈计算。引擎将全自动聚合面积覆盖与 POI 荷载，自动生成全景评估报表。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="structured-summary-report">
      {/* 核心指标仪表卡组 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 卡片1: 评估总站数 */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
            <MapPin className="w-16 h-16 text-slate-900" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">分析站点规模</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800 tracking-tight">{stats.totalStations}</span>
            <span className="text-xs text-slate-400 font-medium">个消防站</span>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 border-t border-slate-50 pt-2.5">
            <Cpu className="w-3 h-3 text-red-500 animate-pulse" />
            <span>边缘测算网自动并行分析</span>
          </div>
        </div>

        {/* 卡片2: 覆盖面积之和 */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
            <Layers className="w-16 h-16 text-slate-900" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">辐射极径总面积</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-red-600 tracking-tight">{stats.totalArea}</span>
            <span className="text-xs text-red-500 font-medium font-mono">km²</span>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 border-t border-slate-50 pt-2.5">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span className="text-slate-500">平均单站覆盖 <strong className="font-bold text-slate-700">{stats.avgArea}</strong> km²</span>
          </div>
        </div>

        {/* 卡片3: POI感知总数 */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
            <Activity className="w-16 h-16 text-slate-900" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">POI 锚点感知总量</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800 tracking-tight">{stats.totalPoi}</span>
            <span className="text-xs text-slate-400 font-medium">个敏感点</span>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 border-t border-slate-50 pt-2.5">
            <Percent className="w-3 h-3 text-emerald-500" />
            <span>平均单站荷载 <strong className="font-bold text-slate-700">{stats.avgPoi}</strong> 个</span>
          </div>
        </div>

        {/* 卡片4: 空间均匀度 */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
            <TrendingUp className="w-16 h-16 text-slate-900" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">空间规划均衡性</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${stats.uniformityColor}`}>
              cv = {stats.stdDev}
            </span>
            <span className="text-[11px] font-bold text-slate-700 truncate max-w-[130px]">
              {stats.uniformityText.split(' ')[0]}
            </span>
          </div>
          <div className="mt-3 text-[10px] text-slate-400 border-t border-slate-50 pt-2.5 truncate" title={stats.uniformityText}>
            {stats.uniformityText}
          </div>
        </div>
      </div>

      {/* 核心关注类别 POI 覆盖率及荷载分析区块 */}
      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 bg-red-500 rounded" />
            <h3 className="font-extrabold text-[#0f172a] text-xs uppercase tracking-wider">空间核心 POI 类别比重统计 (Critical POI Category Analysis)</h3>
          </div>
          <span className="text-[10px] text-slate-400 font-mono font-bold">ALL COVERED ANCHORS COUNT</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-red-50/30 hover:border-red-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="school">🏫</span>
            <span className="text-[10px] font-bold text-slate-400">学校 (Schools)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['学校']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-orange-50/30 hover:border-orange-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="hospital">🏥</span>
            <span className="text-[10px] font-bold text-slate-400">医院 (Hospitals)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['医院']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-amber-50/30 hover:border-amber-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="gas">⛽</span>
            <span className="text-[10px] font-bold text-slate-400">加油站 (Gas)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['加油站']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-blue-50/30 hover:border-blue-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="public">🏛️</span>
            <span className="text-[10px] font-bold text-slate-400">公共设施 (Public)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['公共服务设施']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-emerald-50/30 hover:border-emerald-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="residential">🏘️</span>
            <span className="text-[10px] font-bold text-slate-400">居民区 (Resident)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['居民区']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-purple-50/30 hover:border-purple-100 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="mall">🛍️</span>
            <span className="text-[10px] font-bold text-slate-400">商场 (Malls)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['商场']}</span>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center justify-center text-center group hover:bg-slate-100 hover:border-slate-200 transition-all duration-300">
            <span className="text-2xl mb-1.5" role="img" aria-label="other">🧩</span>
            <span className="text-[10px] font-bold text-slate-400">其他 (Others)</span>
            <span className="text-xl font-black text-slate-800 mt-1 font-mono">{poiCategoryTotals['其他']}</span>
          </div>
        </div>
      </div>

      {/* 智能整合研判报告面板 */}
      <div className="bg-linear-to-br from-slate-900 to-slate-950 border border-slate-850 rounded-2xl p-6 shadow-xl text-white relative overflow-hidden">
        {/* 精美星光网格背景 */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        {/* 顶部标题及下载按钮 */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/10 pb-5 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center text-red-400">
              <FileText className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">消防等时圈空间覆盖综合评估报告</h3>
              <p className="text-[10px] text-slate-400 font-mono">AUTOMATED SPATIAL REACHABILITY & CRITICAL POI LOAD ANALYSIS REPORT</p>
            </div>
          </div>
          
          <button
            onClick={downloadPdfReport}
            className="group relative overflow-hidden bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-red-950/30 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98]"
          >
            <span className="absolute inset-0 w-full h-full bg-linear-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
            <Download className="w-3.5 h-3.5" />
            <span>下载 PDF 成果报告</span>
          </button>
        </div>

        {/* 报告内容研判明细 (Grid 划分) */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-300">
          <div className="space-y-4">
            <h4 className="font-extrabold text-white text-[11px] uppercase tracking-widest text-red-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-ping" />
              等时圈覆盖极性研判 (Spatial Extremes)
            </h4>
            
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5 bg-white/5 p-3 rounded-xl border border-white/5">
                <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white text-[11px]">最大应急辐射站点 (Maximum Reach Endpoint)</p>
                  <p className="mt-1">
                    消防站 <strong className="text-emerald-400 font-black">【{stats.maxAreaName}】</strong> 以 
                    <strong className="text-white font-extrabold font-mono ml-1">{stats.maxArea} km²</strong> 的可达覆盖范围居首，具备极高强度的空间物理机动优势，服务边际宽广。
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-2.5 bg-white/5 p-3 rounded-xl border border-white/5">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white text-[11px]">最狭窄辐射覆盖响应点 (Minimum Reach Endpoint)</p>
                  <p className="mt-1">
                    消防站 <strong className="text-rose-400 font-black">【{stats.minAreaName}】</strong> 计算得出的覆盖范围仅 
                    <strong className="text-white font-extrabold font-mono ml-1">{stats.minArea} km²</strong>，空间流动通道高度受限。
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="font-extrabold text-white text-[11px] uppercase tracking-widest text-red-400 flex items-center gap-1.5">
              <ChevronRight className="w-1.5 h-1.5 bg-red-400 rounded-full" />
              锚点荷载及规划优化建议 (Strategic Recommendations)
            </h4>

            <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3 leading-relaxed">
              <div className="flex items-center gap-2 text-white font-bold text-[11px] mb-2">
                <div className="w-1.5 h-3 bg-red-500 rounded" />
                <span>系统自动生成规划建议</span>
              </div>
              <p>
                1. <strong className="text-white font-bold">高荷载防备警示：</strong>
                站点 <strong className="text-white">【{stats.maxPoiName}】</strong> 在预定车速等时圈中包络了 <strong className="text-amber-400 font-extrabold">{stats.maxPoi}</strong> 个重点关注 POI，其出警应急遭遇几率极高，建议增配备勤载具与专职水泵班组。
              </p>
              <p>
                2. <strong className="text-white font-bold">路网与空间扩展：</strong>
                针对覆盖表现偏低的 <strong className="text-white">【{stats.minAreaName}】</strong> 站点周边路阻情况，建议在规划图层中排查阻堵节点，或对边界线实行动态多站协同派警补漏。
              </p>
              <div className="text-[10px] text-slate-400/80 mt-1 italic flex items-center gap-1">
                <span>* PDF报表采用行业标准双语导出，确保导入GIS文档等时格式与报告无缝对齐。</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
