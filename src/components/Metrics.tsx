import React, { useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw, BarChart3, Cpu, HardDrive, Mail } from 'lucide-react';
import { motion } from 'motion/react';

interface KafkaMetrics {
  queueSize: number;
  status: string;
}

interface JsonMetrics {
  cpu: number;
  memory: {
    used: number;
    total: number;
    percentage?: number;
  };
  requests: number;
  kafka: KafkaMetrics;
  serviceHealth?: {
    account: boolean;
    transaction: boolean;
    audit: boolean;
    instances?: number;
  };
  timestamp: string;
}

export const Metrics: React.FC = () => {
  const [rawMetrics, setRawMetrics] = useState<string>('');
  const [jsonMetrics, setJsonMetrics] = useState<JsonMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState<{ [key: number]: boolean }>({});
  const [stats, setStats] = useState({
    cpu: '0.0%',
    memory: '0 MB',
    requests: '0'
  });

  const parseMetrics = (raw: string, json: JsonMetrics | null) => {
    const lines = raw.split('\n');
    let cpu = '0.0%';
    let memory = '0 MB';
    let requests = '0';

    lines.forEach(line => {
      if (line.startsWith('process_cpu_user_seconds_total')) {
        const val = parseFloat(line.split(' ')[1]);
        cpu = (val * 100).toFixed(1) + '%';
      }
      if (line.startsWith('process_resident_memory_bytes')) {
        const val = parseFloat(line.split(' ')[1]);
        memory = (val / (1024 * 1024)).toFixed(1) + ' MB';
      }
      if (line.startsWith('http_requests_total')) {
        const val = parseFloat(line.split(' ')[1]);
        requests = (parseInt(requests) + val).toString();
      }
    });

    setStats({ 
      cpu: json?.cpu ? `${json.cpu.toFixed(1)}%` : cpu, 
      memory: json?.memory ? `${json.memory.used} MB` : memory, 
      requests 
    });
  };

  const fetchMetrics = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      const [rawRes, jsonRes] = await Promise.all([
        fetch('/metrics'),
        fetch('/api/admin/metrics', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      let json: JsonMetrics | null = null;
      if (jsonRes.ok) {
        json = await jsonRes.json();
        setJsonMetrics(json);
      }

      if (rawRes.ok) {
        const raw = await rawRes.text();
        setRawMetrics(raw);
        parseMetrics(raw, json);
      }
    } catch (err) {
      console.error('Error fetching metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000); // Polling every 2s for better responsiveness
    return () => clearInterval(interval);
  }, []);

  const simulateLoad = async (intensity: number) => {
    setSimulating(prev => ({ ...prev, [intensity]: true }));
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/admin/simulate-load', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ intensity })
      });
      
      if (response.ok) {
        const data = await response.json();
        // Immediately fetch metrics to show scaling feedback
        fetchMetrics();
      }

      // Keep button state for 5s to show it's active
      setTimeout(() => {
        setSimulating(prev => ({ ...prev, [intensity]: false }));
      }, 5000);
    } catch (err) {
      console.error('Error simulating load:', err);
      setSimulating(prev => ({ ...prev, [intensity]: false }));
    }
  };

  const Gauge = ({ value, label, color, suffix = '' }: { value: string | number, label: string, color: string, suffix?: string }) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    const percentage = Math.min(100, Math.max(0, numValue));
    const circumference = 2 * Math.PI * 38;
    const offset = circumference - (percentage / 100) * circumference;

    return (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center gap-4">
        <div className="relative w-24 h-24">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="48"
              cy="48"
              r="38"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              className="text-slate-100"
            />
            <motion.circle
              cx="48"
              cy="48"
              r="38"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              className={color}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-slate-800">{value}{suffix}</span>
          </div>
        </div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">System Observability</h1>
        </div>
        <div className="flex gap-2">
          {((jsonMetrics?.kafka as any)?.intensity > 0 || jsonMetrics?.kafka?.status === 'active') && (
            <button
              onClick={() => simulateLoad(0)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-black transition-all flex items-center gap-1 shadow-lg shadow-slate-200"
            >
              <Activity className="w-3 h-3 animate-pulse text-rose-500" />
              Stop Test
            </button>
          )}
          <button
            onClick={() => simulateLoad(5)}
            disabled={simulating[5]}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${simulating[5] ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
          >
            {simulating[5] ? 'Generating...' : 'Generate Traffic'}
          </button>
          <button
            onClick={() => simulateLoad(10)}
            disabled={simulating[10]}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${simulating[10] ? 'bg-slate-100 text-slate-400' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
          >
            {simulating[10] ? 'Stressing...' : 'Load Stress Test'}
          </button>
          <button
            onClick={() => simulateLoad(20)}
            disabled={simulating[20]}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${simulating[20] ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            {simulating[20] ? 'Provisioning...' : 'Scale Infrastructure'}
          </button>
          <button
            onClick={fetchMetrics}
            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Gauge value={parseFloat(stats.cpu)} label="CPU Usage" color="text-indigo-600" suffix="%" />
        <Gauge value={jsonMetrics?.memory.percentage || (parseFloat(stats.memory) / 16384 * 100)} label="RAM Utilization" color="text-emerald-600" suffix="%" />
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-violet-100 rounded-xl text-violet-600">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Throughput</p>
            <p className="text-xl font-bold text-slate-900">{stats.requests}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 relative overflow-hidden">
          <div className="p-3 bg-rose-100 rounded-xl text-rose-600">
            <Mail className="w-6 h-6" />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cluster Queue</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold text-slate-900">{jsonMetrics?.kafka?.queueSize || 0}</p>
              {((jsonMetrics?.kafka?.queueSize || 0) > 0) && (
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
              )}
            </div>
          </div>
          {((jsonMetrics?.kafka?.queueSize || 0) > 50) && (
             <div className="absolute top-0 right-0 p-1 bg-amber-500 text-[8px] font-bold text-white uppercase px-2 rounded-bl-lg">Congested</div>
          )}
        </div>
      </div>

      {jsonMetrics?.serviceHealth && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-400" />
              Microservice Cluster Status 
              {jsonMetrics.serviceHealth.instances && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${jsonMetrics.serviceHealth.instances > 1 ? 'bg-rose-500 text-white animate-pulse' : 'bg-indigo-100 text-indigo-600'}`}>
                   {jsonMetrics.serviceHealth.instances} Nodes Active
                </span>
              )}
            </h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Verification Mode</p>
        </div>
        
        {jsonMetrics.serviceHealth.activeContainers && (
          <div className="px-6 py-4 bg-slate-900 border-b border-slate-800">
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3">Live Scaling Fleet (Docker Containers)</p>
            <div className="flex flex-wrap gap-2">
              {jsonMetrics.serviceHealth.activeContainers.map((containerId: string) => (
                <div key={containerId} className="flex items-center gap-2 px-2 py-1 bg-slate-800 rounded border border-slate-700">
                  <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-[9px] font-mono text-slate-400">{containerId}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-slate-100">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-indigo-500" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Environment Cores</p>
                <p className="text-sm font-bold text-slate-900">{jsonMetrics.serviceHealth?.cores || 'Detecting...'} Physical Cores</p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full font-bold uppercase">Optimized</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Memory</p>
                <p className="text-sm font-bold text-slate-900">{jsonMetrics.serviceHealth?.targetMemory || '16GB/32GB'} Provisioned</p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full font-bold uppercase">Healthy</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100 italic">
            {Object.entries(jsonMetrics.serviceHealth)
              .filter(([name]) => name !== 'instances' && name !== 'cores' && name !== 'targetMemory')
              .map(([name, healthy]) => (
              <div key={name} className="px-6 py-4 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600 capitalize">{name} Service</span>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${healthy ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)] animate-pulse'}`} />
                  <span className={`text-[10px] font-bold uppercase ${healthy ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {healthy ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-900 rounded-2xl p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Raw Prometheus Metrics</h3>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded font-mono">text/plain</span>
        </div>
        <div className="bg-slate-950 rounded-xl p-4 h-96 overflow-y-auto font-mono text-xs text-emerald-400 custom-scrollbar">
          {loading && !rawMetrics ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <pre>{rawMetrics}</pre>
          )}
        </div>
      </div>
    </div>
  );
};
