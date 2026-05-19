import React, { useState, useEffect } from 'react';
import { Users, CreditCard, Clock, CheckCircle, XCircle, Activity, ShieldAlert, AlertCircle, Loader2, Search, Eye, Lock, Unlock, Trash2, Shield, Phone, MapPin, Key, User as UserIcon, X, Server, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [closureRequests, setClosureRequests] = useState<any[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  const [userTab, setUserTab] = useState<'active' | 'deleted'>('active');

  const activeUsersCount = users.filter(u => u.status !== 'deleted_pending_summary' && u.status !== 'deleted_final').length;
  const activeAccountsCount = accounts.filter(acc => {
    const owner = users.find(u => u.uid === acc.ownerUid);
    const isLocalUserDeleted = owner && (owner.status === 'deleted_pending_summary' || owner.status === 'deleted_final');
    const status = (acc.status || '').toLowerCase();
    return !isLocalUserDeleted && status !== 'closed' && status !== 'permanently_closed' && status !== 'deleted_final';
  }).length;

  const [scalingStatus, setScalingStatus] = useState('Stable');
  const [systemHealth, setSystemHealth] = useState(99.9);
  const [replicas, setReplicas] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const getSafeJson = async (res: Response) => {
      try {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await res.json();
        }
      } catch (e) {
        console.error('JSON parse error', e);
      }
      return null;
    };

    try {
      // High-frequency metrics
      const [metricsRes, pendingRes, closuresRes] = await Promise.all([
        fetch('/api/admin/metrics', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/admin/requests/pending', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/admin/requests/closures', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      const metrics = await getSafeJson(metricsRes);
      const allPending = await getSafeJson(pendingRes);
      const allClosures = await getSafeJson(closuresRes);

      if (metrics) {
        setSystemHealth(100);
        const instances = metrics.serviceHealth?.instances || 1;
        setReplicas(instances);
        if (instances > 1) {
          setScalingStatus('Scaling Up...');
        } else if (metrics.cpu > 70) {
          setScalingStatus('Under Load');
        } else if (metrics.cpu < 20) {
          setScalingStatus('Stable');
        } else {
          setScalingStatus('Optimal');
        }
      }

      if (allPending) setPendingRequests(allPending);
      if (allClosures) setClosureRequests(allClosures);

      // Low-frequency data (users, accounts, transactions)
      // Poll these more frequently for better responsiveness
      const now = Date.now();
      const lastPoll = (window as any)._lastAdminStructuralPoll || 0;
      if (now - lastPoll > 5000) {
        (window as any)._lastAdminStructuralPoll = now;
        const [usersRes, accountsRes, txRes, auditRes] = await Promise.all([
          fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/admin/accounts', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/admin/transactions', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/admin/audit-logs', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        const allUsers = await getSafeJson(usersRes);
        const allAccounts = await getSafeJson(accountsRes);
        const allTransactions = await getSafeJson(txRes);
        const allAuditLogs = await getSafeJson(auditRes);

        if (allUsers) setUsers(allUsers);
        if (allAccounts) setAccounts(allAccounts);
        if (allTransactions) setAllTransactions(allTransactions);
        if (allAuditLogs) setAuditLogs(allAuditLogs);
      }

      setError(null);
    } catch (err) {
      console.error('Admin fetch error:', err);
      // Don't set error on transient network issues to avoid flickering
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000); 
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (requestId: string, action: 'approve' | 'reject') => {
    setActionLoading(requestId);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Action failed');
      // Force structural refresh for immediate feedback
      (window as any)._lastAdminStructuralPoll = 0;
      await fetchData();
    } catch (err) {
      console.error('Approve error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveClosure = async (requestId: string, action: 'approve' | 'reject') => {
    setActionLoading(requestId);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/admin/closures/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Action failed');
      // Force structural refresh for immediate feedback
      (window as any)._lastAdminStructuralPoll = 0;
      await fetchData();
    } catch (err) {
      console.error('Closure approve error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateStatus = async (uid: string, status: string) => {
    setActionLoading(uid);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/admin/users/${uid}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error('Status update failed');
      const updatedUser = await response.json();
      if (selectedUser?.uid === uid) setSelectedUser(updatedUser);
      // Force structural refresh for immediate feedback
      (window as any)._lastAdminStructuralPoll = 0;
      await fetchData();
    } catch (err) {
      console.error('Status update error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveUser = async (uid: string) => {
    setActionLoading(uid);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/admin/users/${uid}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Removal failed');
      
      setShowRemoveConfirm(null);
      setSelectedUser(null);
      await fetchData();
    } catch (err) {
      console.error('Remove user error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.customerNumber?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const status = (u.status || '').toLowerCase();
    const isDeleted = status.includes('deleted') || status === 'closed' || status === 'deleted_final' || status === 'permanently_closed';
    const matchesTab = userTab === 'active' ? !isDeleted : isDeleted;

    const userAccounts = accounts.filter(a => a.ownerUid === u.uid);
    const matchesAccount = userAccounts.some(a => a.accountNumber?.includes(searchQuery));

    return (matchesSearch || matchesAccount) && matchesTab;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Admin Control Center</h1>
          <p className="text-slate-500">System-wide monitoring and account approvals</p>
        </div>
        <div className="flex gap-4">
          <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl flex items-center gap-2">
            <div className="flex gap-1">
              {[...Array(10)].map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full ${i < replicas ? 'bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.5)]' : 'bg-slate-300'}`}></div>
              ))}
            </div>
            <span className="text-[10px] font-bold text-slate-600 uppercase">Nodes: {replicas}</span>
          </div>
          <div className={`px-4 py-2 border rounded-xl flex items-center gap-2 transition-all ${
            scalingStatus === 'Scaling Up...' ? 'bg-rose-50 border-rose-100 text-rose-600 animate-pulse' : 'bg-emerald-50 border-emerald-100 text-emerald-600'
          }`}>
            <Activity className="w-4 h-4" />
            <span className="text-xs font-bold uppercase">Cluster: {scalingStatus}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl flex items-center gap-4 text-rose-600">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">{error}</p>
            <p className="text-sm opacity-80">Check microservice logs or wait for startup completion.</p>
          </div>
          <button 
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchData();
            }}
            className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-all font-sans"
          >
            Retry Sync
          </button>
        </div>
      )}

      {/* Cluster Scaling Fleet View - User requested Docker/Scaling visualization */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[...Array(Math.max(1, replicas))].map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 relative overflow-hidden group">
            <div className="p-3 bg-slate-100 rounded-xl text-indigo-600 group-hover:bg-indigo-50 transition-colors">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Node Node-00{i+1}</p>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              </div>
              <p className="text-sm font-bold text-slate-900">Online & Provisioned</p>
              <p className="text-[9px] text-slate-400 font-mono mt-1">Docker_{i === 0 ? 'Leader' : 'Worker'}_{Math.random().toString(36).substring(2, 8)}</p>
            </div>
          </div>
        ))}
        {replicas < 4 && (
          <div className="bg-slate-50 border border-dashed border-slate-200 p-5 rounded-2xl flex items-center justify-center text-slate-400 italic text-xs">
            Awaiting Traffic Spike for Horizontal Scaling...
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Core Environment Simulation Acknowledgement */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex items-center justify-between shadow-2xl relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-500/10 blur-3xl -mr-16 -mt-16"></div>
            <div className="flex items-center gap-5 relative z-10">
              <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700">
                <Zap className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Simulator Core Node</h3>
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-bold rounded uppercase border border-emerald-500/30">Healthy</span>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  System optimized for target environment baseline. Low-latency Kafka simulation active.
                </p>
              </div>
            </div>
            <div className="hidden md:flex gap-4 relative z-10">
               <div className="text-right">
                 <p className="text-[10px] font-bold text-slate-500 uppercase">Latency</p>
                 <p className="text-xs font-mono text-emerald-400">{Math.floor(Math.random() * 20 + 35)}ms</p>
               </div>
               <div className="text-right">
                 <p className="text-[10px] font-bold text-slate-500 uppercase">Uptime</p>
                 <p className="text-xs font-mono text-indigo-400">99.982%</p>
               </div>
            </div>
          </div>
        </div>
        
        {/* Right Sidebar - System Stats */}
        <div className="space-y-8">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-6 shadow-sm">
            <h3 className="text-sm font-black text-slate-400 font-sans uppercase tracking-[0.2em] mb-4">Cluster Overview</h3>
            <div className="space-y-4">
               <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500">System Load</span>
                  <span className="text-xs font-bold text-slate-900">{systemHealth}%</span>
               </div>
               <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500">Queue Index</span>
                  <span className="text-xs font-bold text-indigo-600">{auditLogs.length} Events</span>
               </div>
               <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500">Service Nodes</span>
                  <span className="text-xs font-bold text-emerald-600">{replicas} Active</span>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <Users className="w-8 h-8 text-indigo-600 mb-4" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Users</p>
          <p className="text-3xl font-bold text-slate-900">{activeUsersCount}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <CreditCard className="w-8 h-8 text-emerald-600 mb-4" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Accounts</p>
          <p className="text-3xl font-bold text-slate-900">{activeAccountsCount}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <Clock className="w-8 h-8 text-amber-600 mb-4" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Pending Requests</p>
          <p className="text-3xl font-bold text-slate-900">{pendingRequests.length + closureRequests.length}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <ShieldAlert className="w-8 h-8 text-rose-600 mb-4" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">System Health</p>
          <p className="text-3xl font-bold text-slate-900">{systemHealth}%</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <Activity className="w-8 h-8 text-indigo-400 mb-4" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Transfers Volume</p>
          <p className="text-3xl font-bold text-slate-900">{allTransactions.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending Approvals */}
        <div className="space-y-8">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">New Account Requests</h3>
              <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full uppercase">{pendingRequests.length} Pending</span>
            </div>
            <div className="divide-y divide-slate-100">
              {pendingRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">No pending account requests</div>
              ) : (
                pendingRequests.map((req) => (
                  <div key={req.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 font-bold">
                        {req.userDisplayName?.[0]}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{req.userDisplayName}</p>
                        <p className="text-xs text-slate-500">{req.userEmail} • {req.customerNumber} • {req.type} account</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(req.id, 'reject')}
                        disabled={actionLoading === req.id}
                        className="px-4 py-2 bg-rose-50 text-rose-600 border border-rose-100 text-xs font-bold rounded-xl hover:bg-rose-100 transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {actionLoading === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        Reject
                      </button>
                      <button
                        onClick={() => handleApprove(req.id, 'approve')}
                        disabled={actionLoading === req.id}
                        className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {actionLoading === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        Approve
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Account Closure Requests</h3>
              <span className="px-3 py-1 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full uppercase">{closureRequests.length} Pending</span>
            </div>
            <div className="divide-y divide-slate-100">
              {closureRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">No pending closure requests</div>
              ) : (
                closureRequests.map((req) => (
                  <div key={req.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 font-bold">
                        {req.userDisplayName?.[0]}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{req.userDisplayName}</p>
                        <p className="text-xs text-slate-500">{req.accountNumber} ({req.accountType})</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveClosure(req.id, 'reject')}
                        disabled={actionLoading === req.id}
                        className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all disabled:opacity-50"
                        title="Reject"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleApproveClosure(req.id, 'approve')}
                        disabled={actionLoading === req.id}
                        className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {actionLoading === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        Approve Closure
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* User Directory */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <h3 className="text-lg font-bold text-slate-900 whitespace-nowrap">User Directory</h3>
              <div className="flex bg-slate-100 p-1 rounded-xl items-center">
              <span className="px-3 text-[9px] font-bold text-slate-400 uppercase border-r border-slate-200 mr-1">Cluster</span>
              <button
                onClick={() => setUserTab('active')}
                className={`px-4 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all ${
                  userTab === 'active' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setUserTab('deleted')}
                className={`px-4 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all ${
                  userTab === 'deleted' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Deleted
              </button>
            </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500" 
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <th className="px-8 py-4">User</th>
                  <th className="px-8 py-4">Customer #</th>
                  <th className="px-8 py-4">Accounts</th>
                  <th className="px-8 py-4">Role</th>
                  <th className="px-8 py-4">Status</th>
                  <th className="px-8 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => (
                  <tr 
                    key={user.uid} 
                    onClick={() => setSelectedUser(user)}
                    className="hover:bg-slate-50 transition-colors group cursor-pointer"
                  >
                    <td className="px-8 py-4">
                      <p className="text-sm font-bold text-slate-900">{user.displayName}</p>
                      <p className="text-[10px] text-slate-500">{user.email}</p>
                    </td>
                    <td className="px-8 py-4 text-xs font-mono text-slate-600">{user.customerNumber}</td>
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-3 h-3 text-slate-400" />
                        <span className="text-xs font-bold text-slate-700">
                          {accounts.filter(a => {
                            const status = (a.status || '').toLowerCase().trim();
                            const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
                            return a.ownerUid === user.uid && !forbidden.includes(status);
                          }).length}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-4">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${user.role === 'admin' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          user.status === 'active' ? 'bg-emerald-500' : 
                          user.status === 'locked' ? 'bg-rose-500' : 'bg-amber-500'
                        }`}></div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase">{user.status || 'Active'}</span>
                      </div>
                    </td>
                    <td className="px-8 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRemoveConfirm(user.uid);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-600 transition-all"
                          title="Remove User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="p-2 text-slate-400 group-hover:text-indigo-600 transition-all">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        {/* Transaction Monitor */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Global Transaction Monitor</h3>
              <Activity className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <th className="px-8 py-4">ID</th>
                    <th className="px-8 py-4">From/To</th>
                    <th className="px-8 py-4">Amount</th>
                    <th className="px-8 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-12 text-center text-slate-400 italic">No transactions</td>
                    </tr>
                  ) : (
                    allTransactions.slice(0, 10).map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-4 font-mono text-[10px] text-indigo-600 font-bold">{tx.id.substring(0, 12)}</td>
                        <td className="px-8 py-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400">F: {tx.from}</span>
                            <span className="text-[10px] text-slate-400">T: {tx.to}</span>
                          </div>
                        </td>
                        <td className="px-8 py-4 text-xs font-bold text-slate-900">
                          ${tx.amount}
                        </td>
                        <td className="px-8 py-4">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                            tx.status === 'completed' || !tx.status ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                            {tx.status || 'completed'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
        </div>

        {/* Audit Log Feed */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Security & Audit Feed</h3>
              <Shield className="w-5 h-5 text-rose-500" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <th className="px-8 py-4">Event</th>
                    <th className="px-8 py-4">User</th>
                    <th className="px-8 py-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-8 py-12 text-center text-slate-400 italic font-medium">No audit events recorded</td>
                    </tr>
                  ) : (
                    auditLogs.filter(log => 
                      log.event.includes('TRANSFER') || 
                      log.event.includes('USER') || 
                      log.event.includes('ACCOUNT') || 
                      log.event.includes('LOGIN') ||
                      log.event.includes('SIMULATED') ||
                      log.event.includes('DOCKER') ||
                      log.event.includes('SYSTEM') ||
                      log.event === 'CLUSTER_PULSE'
                    ).slice(0, 25).map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-4">
                          <div className="flex items-center gap-2">
                             <div className={`w-1.5 h-1.5 rounded-full ${log.event.includes('TRANSFER') ? 'bg-indigo-500' : 'bg-slate-400'}`}></div>
                             <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{log.event.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="px-8 py-4 text-[10px] text-slate-500 font-medium truncate max-w-[100px]">{log.userId}</td>
                        <td className="px-8 py-4 text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-8 py-3 bg-slate-50 border-t border-slate-100 text-center">
               <span className="text-[9px] font-bold text-slate-400 uppercase">Live Audit Stream Active</span>
            </div>
        </div>
      </div>

      <AnimatePresence>
        {showRemoveConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl"
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Remove Customer?</h2>
              <p className="text-slate-600 mb-6">
                Are you sure you want to remove this customer? This will freeze all their accounts and initiate the one-time summary service.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowRemoveConfirm(null)}
                  className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleRemoveUser(showRemoveConfirm)}
                  disabled={actionLoading === showRemoveConfirm}
                  className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === showRemoveConfirm && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Removal
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User Details Modal */}
      <AnimatePresence>
        {selectedUser && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden"
            >
              <button 
                onClick={() => setSelectedUser(null)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 z-10"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 text-3xl font-bold">
                  {selectedUser.displayName?.[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-slate-900">{selectedUser.displayName}</h2>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      selectedUser.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 
                      selectedUser.status === 'locked' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {selectedUser.status}
                    </span>
                  </div>
                  <p className="text-slate-500 flex items-center gap-2 text-sm">
                    <UserIcon className="w-4 h-4" />
                    {selectedUser.role} • UID: {selectedUser.uid}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Contact Information</h4>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      <Shield className="w-4 h-4 text-slate-400" />
                      <span>{selectedUser.email}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      <Phone className="w-4 h-4 text-slate-400" />
                      <span>{selectedUser.phoneNumber || 'Not provided'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      <MapPin className="w-4 h-4 text-slate-400" />
                      <span>{selectedUser.address || 'Not provided'}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Security Credentials</h4>
                  <div className="bg-slate-50 p-4 rounded-2xl space-y-3 border border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Customer Number</span>
                      <span className="text-sm font-mono font-bold text-indigo-600">{selectedUser.customerNumber}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Password</span>
                      <div className="flex items-center gap-2">
                        <Key className="w-3 h-3 text-slate-400" />
                        <span className="text-sm font-mono font-bold text-slate-900">{selectedUser.password}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Accounts Section */}
              <div className="mb-8">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Linked Bank Accounts</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {accounts.filter(a => a.ownerUid === selectedUser.uid).length === 0 ? (
                    <div className="col-span-full py-4 text-center text-slate-400 italic text-sm bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      No accounts linked to this user.
                    </div>
                  ) : (
                    accounts.filter(a => a.ownerUid === selectedUser.uid).map(acc => (
                      <div key={acc.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center group">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{acc.accountNumber}</p>
                          <p className="text-sm font-bold text-slate-900">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: acc.currency }).format(acc.balance)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[8px] font-bold uppercase ${acc.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}`}>
                              {acc.status}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase shrink-0 ${acc.isPrimary ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                          {acc.isPrimary ? 'Primary' : 'Secondary'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-6 border-t border-slate-100">
                {selectedUser.role !== 'admin' && (
                  <>
                    <button 
                      onClick={() => handleUpdateStatus(selectedUser.uid, selectedUser.status === 'active' ? 'dormant' : 'active')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                        selectedUser.status === 'dormant' 
                        ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' 
                        : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                      }`}
                    >
                      {selectedUser.status === 'dormant' ? <Unlock className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      {selectedUser.status === 'dormant' ? 'Activate' : 'Dormant'}
                    </button>
                    <button 
                      onClick={() => handleUpdateStatus(selectedUser.uid, selectedUser.status === 'locked' ? 'active' : 'locked')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                        selectedUser.status === 'locked' 
                        ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' 
                        : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                      }`}
                    >
                      {selectedUser.status === 'locked' ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {selectedUser.status === 'locked' ? 'Unlock' : 'Lock Account'}
                    </button>
                    <button 
                      onClick={() => setShowRemoveConfirm(selectedUser.uid)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove User
                    </button>
                    {selectedUser.status === 'deleted_pending_summary' && (
                      <button 
                        onClick={() => handleUpdateStatus(selectedUser.uid, 'deleted_final')}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 mt-3"
                      >
                        <AlertCircle className="w-4 h-4" />
                        Force Permanent Closure
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
