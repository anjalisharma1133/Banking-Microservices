import React, { useState, useEffect } from 'react';
import { Activity, MessageSquare, Database, Server, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface KafkaMessage {
  id: string;
  topic: string;
  payload: any;
  timestamp: string;
}

export const KafkaVisualizer: React.FC = () => {
  const [messages, setMessages] = useState<KafkaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'feed' | 'schema'>('feed');
  const [replicas, setReplicas] = useState(1);

  const fetchEvents = async () => {
    try {
      const token = localStorage.getItem('token');
      // Using the audit logs which consume from Kafka as our "Monitor"
      const [response, metricsRes] = await Promise.all([
        fetch('/api/audit/logs', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/admin/metrics', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      
      let logs = [];
      const contentType = response.headers.get('content-type');
      
      if (response.ok && contentType && contentType.includes('application/json')) {
        logs = await response.json();
      } else {
        // Fallback to legacy mock endpoint if real service is down
        console.warn('[KAFKA] Real audit service down, falling back to gateway mock logs');
        const fallback = await fetch('/api/admin/audit-logs', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (fallback.ok) {
          logs = await fallback.json();
        }
      }

      if (metricsRes.ok) {
        const metrics = await metricsRes.json();
        setReplicas(metrics.serviceHealth?.instances || 1);
      }

      if (logs.length > 0 || messages.length > 0) {
        const kafkaEvents = logs.map((l: any) => ({
          id: l.id,
          topic: 'transaction-events',
          event: l.event,
          payload: typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata, null, 2),
          timestamp: l.timestamp
        }));
        setMessages(kafkaEvents);
      }
    } catch (err) {
      console.error('Kafka monitor error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
            <Zap className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Kafka Live Monitor</h1>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveView('feed')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeView === 'feed' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Real-time Feed
          </button>
          <button
            onClick={() => setActiveView('schema')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeView === 'schema' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Event Schema
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Graph Animation (Simplified) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 rounded-3xl p-8 relative overflow-hidden h-[300px] flex items-center justify-center">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500 via-transparent to-transparent"></div>
            
            <div className="relative flex items-center justify-between w-full max-w-md">
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap items-center justify-center gap-2 max-w-[200px]">
                  {[...Array(replicas)].map((_, i) => (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="relative"
                    >
                      <div className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-900/20">
                        <Server className="w-6 h-6" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
                      <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[7px] font-mono text-slate-500">N-0{i+1}</span>
                    </motion.div>
                  ))}
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-4">Broker Cluster</span>
              </div>

              <div className="flex-1 px-4 relative">
                <div className="h-0.5 bg-slate-800 w-full"></div>
                <motion.div
                  animate={{ left: ['0%', '100%'] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="absolute top-0 w-3 h-3 bg-indigo-500 rounded-full blur-sm -mt-[5px]"
                />
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center text-emerald-400">
                  <Database className="w-8 h-8" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Consumer</span>
              </div>
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8">
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                 <span className="text-[10px] font-mono text-indigo-200 uppercase tracking-wider">KRaft Active</span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)] animate-pulse"></div>
                 <span className="text-[10px] font-mono text-indigo-300 uppercase tracking-wider">Cluster Scaling: Active</span>
               </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[400px]">
             <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
               <h3 className="font-bold text-slate-800 flex items-center gap-2">
                 <Activity className="w-4 h-4 text-indigo-500" />
                 {activeView === 'feed' ? 'Live Event Stream' : 'Event Data Schema'}
               </h3>
               <span className="text-[10px] font-mono text-slate-400">TOPIC: transaction-events</span>
             </div>
              <div className="flex-1 overflow-auto">
                {activeView === 'feed' ? (
                  <div className="min-w-full inline-block align-middle">
                    <div className="overflow-hidden">
                      <table className="min-w-full divide-y divide-slate-100">
                        <thead className="bg-slate-50/50">
                          <tr>
                            <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Timestamp</th>
                            <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Event Type</th>
                            <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Payload</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-50">
                          <AnimatePresence initial={false}>
                            {messages.map((msg: any) => {
                              const payloadObj = typeof msg.rawMetadata === 'object' ? msg.rawMetadata : {};
                              const eventType = msg.event || 'DATA_EVENT';
                              
                              return (
                                <motion.tr
                                  key={msg.id}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className="hover:bg-slate-50/50 transition-colors"
                                >
                                  <td className="px-6 py-4 whitespace-nowrap text-[10px] font-mono text-slate-400">
                                    {new Date(msg.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 py-1 text-[9px] font-bold rounded uppercase tracking-tighter ${
                                      eventType.includes('HEARTBEAT') ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600'
                                    }`}>
                                      {eventType}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <pre className="text-[10px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 max-w-md overflow-hidden text-ellipsis whitespace-pre-wrap">
                                      {msg.payload.length > 150 ? msg.payload.substring(0, 150) + '...' : msg.payload}
                                    </pre>
                                  </td>
                                </motion.tr>
                              );
                            })}
                          </AnimatePresence>
                        </tbody>
                      </table>
                      {messages.length === 0 && !loading && (
                        <div className="py-20 flex flex-col items-center justify-center text-slate-400 space-y-2">
                          <MessageSquare className="w-12 h-12 opacity-20" />
                          <p className="text-sm">Waiting for Kafka events...</p>
                          <p className="text-[10px] uppercase tracking-wider">Perform a transfer to see it appear here</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 space-y-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Transaction Event Schema</h4>
                      </div>
                      <table className="min-w-full border border-slate-100 rounded-xl overflow-hidden">
                        <thead className="bg-slate-50">
                          <tr className="text-[10px] text-slate-400 uppercase font-bold text-left">
                            <th className="px-4 py-2 border-b border-slate-100">Field</th>
                            <th className="px-4 py-2 border-b border-slate-100">Type</th>
                            <th className="px-4 py-2 border-b border-slate-100">Description</th>
                          </tr>
                        </thead>
                        <tbody className="text-[11px] text-slate-600">
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-indigo-600">id</td><td className="px-4 py-2 border-b border-slate-50 font-mono">string</td><td className="px-4 py-2 border-b border-slate-50">Unique Transaction ID (TX-xxxx)</td></tr>
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-indigo-600">from</td><td className="px-4 py-2 border-b border-slate-50 font-mono">string</td><td className="px-4 py-2 border-b border-slate-50">Source Account UUID</td></tr>
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-indigo-600">to</td><td className="px-4 py-2 border-b border-slate-50 font-mono">string</td><td className="px-4 py-2 border-b border-slate-50">Recipient Account Number</td></tr>
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-indigo-600">amount</td><td className="px-4 py-2 border-b border-slate-50 font-mono">number</td><td className="px-4 py-2 border-b border-slate-50">Transfer amount in base currency</td></tr>
                          <tr><td className="px-4 py-2 font-mono text-indigo-600">status</td><td className="px-4 py-2 font-mono">string</td><td className="px-4 py-2">Terminal state (Completed/Failed)</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
                          <Database className="w-4 h-4" />
                        </div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Audit Wrapper Schema</h4>
                      </div>
                      <table className="min-w-full border border-slate-100 rounded-xl overflow-hidden">
                        <thead className="bg-slate-50">
                          <tr className="text-[10px] text-slate-400 uppercase font-bold text-left">
                            <th className="px-4 py-2 border-b border-slate-100">Field</th>
                            <th className="px-4 py-2 border-b border-slate-100">Type</th>
                            <th className="px-4 py-2 border-b border-slate-100">Description</th>
                          </tr>
                        </thead>
                        <tbody className="text-[11px] text-slate-600">
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-emerald-600">event</td><td className="px-4 py-2 border-b border-slate-50 font-mono">string</td><td className="px-4 py-2 border-b border-slate-50">High-level event identifier</td></tr>
                          <tr><td className="px-4 py-2 border-b border-slate-50 font-mono text-emerald-600">userId</td><td className="px-4 py-2 border-b border-slate-50 font-mono">string</td><td className="px-4 py-2 border-b border-slate-50">The actor performing the change</td></tr>
                          <tr><td className="px-4 py-2 font-mono text-emerald-600">metadata</td><td className="px-4 py-2 font-mono">JSON</td><td className="px-4 py-2">Nested payload from origin service</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
          </div>
        </div>

        <div className="space-y-6">
           <div className="bg-indigo-600 rounded-3xl p-6 text-white overflow-hidden relative shadow-lg shadow-indigo-100">
             <div className="absolute -right-4 -top-4 opacity-10">
               <Zap className="w-32 h-32" />
             </div>
             <h3 className="text-lg font-bold mb-2">Kafka Architecture</h3>
             <p className="text-sm text-indigo-100 mb-4 leading-relaxed">
               In this environment, Kafka operates with **KRaft consensus**, eliminating the need for Zookeeper coordination while dramatically reducing CPU overhead.
             </p>
             <ul className="space-y-3 text-xs">
                <li className="flex items-start gap-2">
                  <div className="mt-1 p-0.5 bg-white/20 rounded">
                    <CheckCircle2 className="w-2 h-2" />
                  </div>
                  <span>Transactions trigger **async** messages to the <code>transaction-events</code> topic.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1 p-0.5 bg-white/20 rounded">
                    <CheckCircle2 className="w-2 h-2" />
                  </div>
                  <span>**Audit Service** acts as a consumer group to capture all financial activity.</span>
                </li>
             </ul>
           </div>

           <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
              <h3 className="font-bold text-slate-800">System Information</h3>
              <div className="space-y-3">
                 <div className="flex justify-between items-center text-xs">
                   <span className="text-slate-500 font-medium tracking-tight">Status</span>
                   <span className="text-emerald-500 font-bold flex items-center gap-1">
                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                     Online
                   </span>
                 </div>
                 <div className="flex justify-between items-center text-xs">
                   <span className="text-slate-500 font-medium tracking-tight">Version</span>
                   <span className="text-slate-800 font-mono">3.5.0</span>
                 </div>
                 <div className="flex justify-between items-center text-xs">
                   <span className="text-slate-500 font-medium tracking-tight">Heap Usage</span>
                   <span className="text-slate-800 font-mono">128MB Limit</span>
                 </div>
                 <div className="flex justify-between items-center text-xs">
                   <span className="text-slate-500 font-medium tracking-tight">Broker Sync</span>
                   <span className="text-slate-800 font-mono">Quorum-based</span>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const CheckCircle2 = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
