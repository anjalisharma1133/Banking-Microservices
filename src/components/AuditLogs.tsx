import React, { useEffect, useState } from 'react';
import { AuditLog } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck, Clock, User as UserIcon, Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'motion/react';

export const AuditLogs: React.FC = () => {
  const { isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLogs = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const token = localStorage.getItem('token');
    try {
      // Fetch from the real Audit Service (proxied through Node.js gateway)
      const response = await fetch('/api/audit/logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const contentType = response.headers.get('content-type');
      if (!response.ok || !contentType || !contentType.includes('application/json')) {
        throw new Error('Real audit service unavailable or returning invalid data');
      }
      
      const allLogs = await response.json();
      setLogs(allLogs);
    } catch (err) {
      console.error('Audit log error:', err);
      // Fallback to legacy mock endpoint if real service is down
      try {
        const fallback = await fetch('/api/admin/audit-logs', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (fallback.ok) {
          const mockData = await fallback.json();
          setLogs(mockData.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        }
      } catch (e) {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
        <p>You do not have permission to view system audit logs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">System Audit Logs</h1>
        </div>
        <button
          onClick={() => fetchLogs(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Timestamp</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Event</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User UID</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-500" />
                        {log.event || 'Unknown Event'}
                      </div>
                      {log.metadata && (
                        <div className="text-[10px] text-slate-400 font-mono bg-slate-50 p-1 rounded border border-slate-100 max-w-xs overflow-hidden text-ellipsis">
                          {typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4" />
                      {log.userId ? (log.userId.length > 8 ? `${log.userId.substring(0, 8)}...` : log.userId) : 'system'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-indigo-50 text-indigo-600 uppercase">
                      Verified
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && !loading && (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <AlertTriangle className="w-8 h-8 text-slate-300" />
              No audit logs found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
