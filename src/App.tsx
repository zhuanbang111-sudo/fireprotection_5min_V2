import React, { useState, useCallback, useMemo } from 'react';
import { 
  Upload, 
  Settings, 
  Play, 
  Download, 
  Map as MapIcon, 
  FileText, 
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Info
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, LayersControl, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import axios from 'axios';
import * as turf from '@turf/turf';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'motion/react';
// @ts-ignore
import shpwrite from 'shp-write';

// Fix Leaflet icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const fireIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/495/495461.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

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
  apiCalls: number;
  timestamp: string;
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  React.useEffect(() => {
    map.setView(center, 13);
  }, [center, map]);
  return null;
}

const TIANDITU_KEY = 'e97bd73ab261e619504c77adf4f61494';

export default function App() {
  const [apiKeys, setApiKeys] = useState<string>('');
  const [stations, setStations] = useState<Station[]>([]);
  const [coordSystem, setCoordSystem] = useState<'GCJ-02' | 'BD-09'>('GCJ-02');
  const [targetMin, setTargetMin] = useState<number>(5);
  const [factor, setFactor] = useState<number>(0.8);
  const [walkSpeed, setWalkSpeed] = useState<number>(4.0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'map' | 'stats'>('map');

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      const validStations = data.filter(row => row.station_name && row.lng && row.lat)
        .map(row => ({
          station_name: String(row.station_name),
          lng: Number(row.lng),
          lat: Number(row.lat)
        }));

      setStations(validStations);
      addLog(`成功加载 ${validStations.length} 个站点`);
    };
    reader.readAsBinaryString(file);
  };

  const calculateIsochrone = (trailPoints: [number, number, number][], targetSec: number) => {
    if (trailPoints.length < 10) return null;

    // 1. Define grid bounds
    const lons = trailPoints.map(p => p[0]);
    const lats = trailPoints.map(p => p[1]);
    const minLon = Math.min(...lons) - 0.01;
    const maxLon = Math.max(...lons) + 0.01;
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;

    // 2. Create grid
    const gridRes = 60; // Increased resolution for better detail
    const gridPoints: any[] = [];
    const cellWidth = (maxLon - minLon) / gridRes;
    const cellHeight = (maxLat - minLat) / gridRes;

    for (let i = 0; i <= gridRes; i++) {
      for (let j = 0; j <= gridRes; j++) {
        const lon = minLon + i * cellWidth;
        const lat = minLat + j * cellHeight;
        
        // Simple Nearest Neighbor with distance penalty
        let minTime = Infinity;
        trailPoints.forEach(tp => {
          const dist = turf.distance([lon, lat], [tp[0], tp[1]], { units: 'meters' });
          const walkTime = dist / walkSpeed;
          const penalty = 1.0 + Math.max(0, dist - 100) / 60.0;
          const totalTime = tp[2] + walkTime * (penalty * penalty);
          if (totalTime < minTime) minTime = totalTime;
        });

        gridPoints.push(turf.point([lon, lat], { time: minTime }));
      }
    }

    const featureCollection = turf.featureCollection(gridPoints) as any;
    const breaks = [0, targetSec];
    const isobands = turf.isobands(featureCollection, breaks, { zProperty: 'time' });
    
    // Filter the band that represents the area within targetSec
    const targetBand = isobands.features.find(f => f.properties?.time === '0-300' || f.properties?.time === `0-${targetSec}`);
    
    return targetBand || isobands.features[0];
  };

  const runAnalysis = async () => {
    if (!apiKeys) {
      addLog('❌ 请输入高德 API Key');
      return;
    }
    if (stations.length === 0) {
      addLog('❌ 请先上传站点数据');
      return;
    }

    setIsAnalyzing(true);
    setResults([]);
    setLogs([]);
    addLog('🚀 开始分析...');

    const keyList = apiKeys.split(',').map(k => k.trim()).filter(k => k);
    const newResults: AnalysisResult[] = [];

    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      addLog(`📍 正在分析: ${station.station_name} (${i + 1}/${stations.length})`);

      try {
        const response = await axios.post('/api/analyze', {
          apiKeys: keyList,
          origin: [station.lng, station.lat],
          targetMin,
          factor,
          coordSystem
        });

        const { trailPoints, anchorCount, apiCalls, wgsOrigin } = response.data;
        const targetSec = (targetMin * 60) / factor;
        const isoGeometry = calculateIsochrone(trailPoints, targetSec);

        if (isoGeometry) {
          const area = turf.area(isoGeometry) / 1000000;
          newResults.push({
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
          });
          addLog(`✅ ${station.station_name} 分析成功，覆盖面积: ${area.toFixed(2)} km²`);
        } else {
          addLog(`⚠️ ${station.station_name} 无法生成等时圈`);
        }
      } catch (error: any) {
        addLog(`❌ ${station.station_name} 失败: ${error.message}`);
      }
    }

    setResults(newResults);
    setIsAnalyzing(false);
    addLog(`🎉 分析完成！共 ${newResults.length} 个站点成功`);
  };

  const exportCSV = () => {
    const data = results.map(r => ({
      '站点名称': r.station.station_name,
      '覆盖面积(km²)': r.area,
      'POI锚点数': r.poiCount,
      'API消耗': r.apiCalls,
      '测算时刻': r.timestamp
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "消防站分析结果.xlsx");
  };

  const exportSHP = () => {
    const collection = turf.featureCollection(results.map(r => ({
      ...r.geometry,
      properties: {
        name: r.station.station_name,
        area: r.area,
        timestamp: r.timestamp
      }
    })));
    
    // @ts-ignore
    shpwrite.download(collection, {
      folder: 'fire_isochrones',
      filename: 'fire_isochrones'
    });
  };

  const mapCenter = useMemo(() => {
    if (results.length > 0) return [results[0].station.lat, results[0].station.lng] as [number, number];
    if (stations.length > 0) return [stations[0].lat, stations[0].lng] as [number, number];
    return [22.54, 114.05] as [number, number];
  }, [results, stations]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-lg">
            <MapIcon className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">消防站点 5 分钟等时圈分析工具</h1>
            <p className="text-xs text-slate-500 font-medium">基于高德地图 API & 实时路况模拟</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={runAnalysis}
            disabled={isAnalyzing || stations.length === 0}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-semibold transition-all ${
              isAnalyzing || stations.length === 0 
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200 active:scale-95'
            }`}
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            {isAnalyzing ? '分析中...' : '开始分析'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 overflow-y-auto flex flex-col shrink-0">
          <div className="p-6 space-y-8">
            {/* API Keys */}
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

            {/* File Upload */}
            <section className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Upload className="w-4 h-4 text-slate-400" />
                数据上传
              </label>
              <div className="relative group">
                <input 
                  type="file" 
                  onChange={handleFileUpload}
                  accept=".xlsx,.xls,.csv"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-red-400 group-hover:bg-red-50 transition-all">
                  <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2 group-hover:text-red-500 transition-colors" />
                  <p className="text-xs font-medium text-slate-500 group-hover:text-red-600">点击或拖拽上传 Excel/CSV</p>
                  <p className="text-[10px] text-slate-400 mt-1">需包含: station_name, lng, lat</p>
                </div>
              </div>
              {stations.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 p-2 rounded-lg">
                  <CheckCircle2 className="w-3 h-3" />
                  已加载 {stations.length} 个站点
                </div>
              )}
            </section>

            {/* Parameters */}
            <section className="space-y-5">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Settings className="w-4 h-4 text-slate-400" />
                参数配置
              </label>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-500">坐标系</span>
                    <span className="text-red-600">{coordSystem}</span>
                  </div>
                  <div className="flex p-1 bg-slate-100 rounded-lg">
                    {(['GCJ-02', 'BD-09'] as const).map(sys => (
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

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-500">消防车特权系数</span>
                    <span className="text-red-600 font-bold">{factor}</span>
                  </div>
                  <input 
                    type="range" min="0.5" max="1.0" step="0.05"
                    value={factor} onChange={(e) => setFactor(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Logs */}
          <div className="mt-auto border-t border-slate-200 bg-slate-50 p-4 max-h-64 overflow-y-auto">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">运行日志</h3>
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-600 break-words leading-relaxed">
                  {log}
                </div>
              ))}
              {logs.length === 0 && <p className="text-[10px] text-slate-400 italic">等待操作...</p>}
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col relative">
          {/* Tabs */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex bg-white/90 backdrop-blur-md p-1 rounded-full shadow-xl border border-white/20">
            <button 
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all ${
                activeTab === 'map' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              地图预览
            </button>
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

          {/* Map View */}
          <div className={`flex-1 relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
            <MapContainer 
              center={mapCenter} 
              zoom={13} 
              className="w-full h-full"
              zoomControl={false}
            >
              <LayersControl position="topright">
                <LayersControl.BaseLayer checked name="天地图矢量">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="http://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="天地图影像">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                    attribution='&copy; <a href="http://www.tianditu.gov.cn/">天地图</a>'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="OpenStreetMap">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                </LayersControl.BaseLayer>

                <LayersControl.Overlay checked name="标注">
                  <TileLayer
                    url={`http://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`}
                    subdomains={['0', '1', '2', '3', '4', '5', '6', '7']}
                  />
                </LayersControl.Overlay>
              </LayersControl>

              <ZoomControl position="bottomright" />
              <MapUpdater center={mapCenter} />
              
              {results.map((res, i) => (
                <React.Fragment key={i}>
                  <Marker position={[res.station.lat, res.station.lng]} icon={fireIcon}>
                    <Popup>
                      <div className="p-1">
                        <h3 className="font-bold text-sm text-red-600">{res.station.station_name}</h3>
                        <p className="text-[10px] text-slate-500 mt-1">覆盖面积: {res.area} km²</p>
                      </div>
                    </Popup>
                  </Marker>
                  <GeoJSON 
                    data={res.geometry} 
                    style={{
                      fillColor: '#ef4444',
                      fillOpacity: 0.3,
                      color: '#b91c1c',
                      weight: 2,
                      dashArray: '4'
                    }} 
                  />
                </React.Fragment>
              ))}
            </MapContainer>
          </div>

          {/* Stats View */}
          <div className={`flex-1 bg-white overflow-y-auto p-8 ${activeTab === 'stats' ? 'block' : 'hidden'}`}>
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">分析成果统计</h2>
                  <p className="text-sm text-slate-500">共完成 {results.length} 个站点的可达性评估</p>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={exportCSV}
                    disabled={results.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 Excel
                  </button>
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

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">站点名称</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">覆盖面积 (km²)</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">POI 锚点</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">API 消耗</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">测算时刻</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((res, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">{res.station.station_name}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-700">
                            {res.area}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-mono">{res.poiCount}</td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-mono">{res.apiCalls}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{res.timestamp}</td>
                      </tr>
                    ))}
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
