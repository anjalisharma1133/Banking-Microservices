import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Account, Transaction } from '../types';
import { Wallet, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Plus, History, Loader2, AlertCircle, User, Phone, MapPin, CheckCircle2, X, Clock, Mail, ShieldCheck, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

import { AdminDashboard } from './AdminDashboard';

interface DashboardProps {
  setActiveTab?: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ setActiveTab }) => {
  const { user, updateProfile, logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState<string | null>(null);
  const [showClosureSuccess, setShowClosureSuccess] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountTransactions, setAccountTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: user?.displayName || '',
    phoneNumber: user?.phoneNumber || '',
    address: user?.address || ''
  });

  const fetchData = async () => {
    if (!user) return;
    const token = localStorage.getItem('token');
    try {
      const [accountsRes, transactionsRes, emailsRes] = await Promise.all([
        fetch('/api/accounts', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/transactions', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/emails', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const getSafeJson = async (res: Response) => {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await res.json();
        }
        return null;
      };

      if (!accountsRes.ok || !transactionsRes.ok) {
        if (accountsRes.status === 404 || transactionsRes.status === 404) {
          setError('User profile or accounts not found. Please try logging in again.');
          setLoading(false);
          return;
        }
        if (accountsRes.status === 503 || transactionsRes.status === 503) {
          setError('Banking services are temporarily initializing. Please wait a moment.');
          setLoading(false);
          return;
        }
        throw new Error(`Connection Error: ${accountsRes.status} / ${transactionsRes.status}`);
      }

      const userAccounts = await getSafeJson(accountsRes);
      const userTransactions = await getSafeJson(transactionsRes);
      
      if (!userAccounts || !userTransactions) {
        throw new Error('Received non-JSON response from banking API');
      }

      if (emailsRes.ok) {
        const emailsData = await getSafeJson(emailsRes);
        if (emailsData) setEmails(emailsData);
      }

      setAccounts(userAccounts);
      setTransactions(userTransactions);
      console.log(`[Dashboard] Fetched ${userAccounts.length} accounts and ${userTransactions.length} transactions`);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setProfileData({
      displayName: user.displayName || '',
      phoneNumber: user.phoneNumber || '',
      address: user.address || ''
    });
    if (user.role === 'admin') {
      setLoading(false);
      return;
    }
    if (user.status === 'deleted_pending_summary') {
      const fetchSummary = async () => {
        const token = localStorage.getItem('token');
        try {
          const response = await fetch('/api/auth/summary', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            setSummaryData(data);
          }
        } catch (err) {
          console.error('Error fetching summary:', err);
        } finally {
          setLoading(false);
        }
      };
      fetchSummary();
    } else {
      fetchData();
      const interval = setInterval(fetchData, 4000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const requestAccount = async (type: 'primary' | 'secondary') => {
    if (!user) return;
    setRequestLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/accounts/request', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ type })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
      }

      setShowSuccessModal(true);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRequestLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile(profileData);
      setShowProfileModal(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchAccountTransactions = async (accountNumber: string) => {
    setTxLoading(true);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/transactions/${accountNumber}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      const txs = await response.json();
      setAccountTransactions(txs);
    } catch (err) {
      console.error('Error fetching account transactions:', err);
    } finally {
      setTxLoading(false);
    }
  };

  const handleAccountClick = (account: Account) => {
    setSelectedAccount(account);
    fetchAccountTransactions(account.accountNumber);
  };

  const handleCloseAccount = async (accountId: string) => {
    if (!user) return;
    setCloseLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/accounts/${accountId}/request-closure`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Closure request failed');
      }
      setShowCloseConfirm(null);
      // Wait a tiny bit for the confirmation modal to start closing before showing success
      // and closing the main account details modal to prevent UI flicker/white screen
      setTimeout(() => {
        setShowClosureSuccess(true);
        setSelectedAccount(null);
        fetchData();
      }, 50);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCloseLoading(false);
    }
  };

  const finalizeDeletion = async () => {
    setFinalizeLoading(true);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/auth/finalize-deletion', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Finalization failed');
      localStorage.setItem('account_closed_message', 'true');
      logout(); 
    } catch (err) {
      console.error('Error finalizing deletion:', err);
      setError('An error occurred while finalizing deletion');
    } finally {
      setFinalizeLoading(false);
    }
  };

  const downloadSummary = () => {
    if (!summaryData) return;
    const blob = new Blob([JSON.stringify(summaryData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Banking_Summary_${user?.customerNumber}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (user?.status === 'deleted_pending_summary') {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl text-center space-y-6"
        >
          <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-12 h-12" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Final Account Summary</h1>
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
          
          {summaryData ? (
            <>
              <p className="text-slate-600 max-w-lg mx-auto">
                Your account has been marked for deletion. This is your final opportunity to review and download your banking data before permanent closure.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mb-6">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Accounts Being Liquidated</p>
                  {summaryData.accounts
                    .filter((acc: any) => {
                      const status = (acc.status || '').toLowerCase().trim();
                      const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
                      return !forbidden.includes(status);
                    })
                    .map((acc: any) => (
                    <div key={acc.id} className="flex justify-between items-center py-1">
                      <span className="text-sm font-medium text-slate-700">{acc.accountNumber}</span>
                      <span className="text-sm font-bold text-slate-900">${(typeof acc.balance === 'string' ? parseFloat(acc.balance) : acc.balance).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Account Lifecycle</p>
                  <p className="text-2xl font-bold text-slate-900 capitalize">{summaryData.user.status.replace(/_/g, ' ')}</p>
                </div>
              </div>

              {summaryData.accounts.some((acc: any) => ['closed', 'permanently_closed', 'deleted_final'].includes(acc.status?.toLowerCase())) && (
                <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-left">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Historical/Closed Accounts</p>
                  <div className="space-y-2">
                    {summaryData.accounts.filter((acc: any) => ['closed', 'permanently_closed', 'deleted_final'].includes(acc.status?.toLowerCase())).map((acc: any) => (
                      <div key={acc.id} className="flex justify-between items-center text-xs text-slate-500 italic">
                        <span>{acc.accountNumber} ({acc.status})</span>
                        <span>$0.00</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button 
                  onClick={downloadSummary}
                  className="flex-1 bg-white border-2 border-indigo-600 text-indigo-600 py-4 rounded-2xl font-bold hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
                >
                  Download Data (JSON)
                </button>
                <button 
                  onClick={() => setShowFinalizeConfirm(true)}
                  className="flex-1 bg-rose-600 text-white py-4 rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                >
                  Permanently Close Access
                </button>
              </div>
            </>
          ) : (
            <div className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-slate-500">Preparing your final summary...</p>
            </div>
          )}
        </motion.div>

        <AnimatePresence>
          {showFinalizeConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl"
              >
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-10 h-10" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Final Confirmation</h2>
                {error && (
                  <div className="mb-4 p-3 bg-rose-50 border border-rose-100 text-rose-600 text-sm rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
                <p className="text-slate-600 mb-6">
                  Are you absolutely sure you want to permanently close your access? 
                  This action is irreversible and you will not be able to log in again.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowFinalizeConfirm(false)}
                    className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Go Back
                  </button>
                  <button 
                    onClick={finalizeDeletion}
                    disabled={finalizeLoading}
                    className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {finalizeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Close Permanently
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (user?.role === 'admin') {
    return <AdminDashboard />;
  }


  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financial Overview</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-slate-500 text-sm">Welcome back, {user?.displayName}</p>
            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
            <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Customer ID</span>
              <span className="text-xs font-mono font-bold text-indigo-600">{user?.customerNumber}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            <User className="w-4 h-4" />
            Edit Profile
          </button>
          <button
            onClick={() => requestAccount('secondary')}
            disabled={requestLoading}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            {requestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Request Secondary
          </button>
          <button
            onClick={() => requestAccount('primary')}
            disabled={requestLoading}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {requestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Request Primary
          </button>
        </div>
      </div>

      {user?.status !== 'active' && user?.status !== 'deleted_pending_summary' && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="bg-amber-50 border border-amber-100 p-6 rounded-3xl flex items-start gap-5 shadow-sm border-l-4 border-l-amber-400"
        >
          <div className="p-3 bg-white text-amber-600 rounded-xl shadow-sm border border-amber-100">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight">Account Restricted: {user?.status?.replace(/_/g, ' ')}</h4>
              <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-[10px] font-bold rounded uppercase tracking-widest animate-pulse">Action Required</span>
            </div>
            <p className="text-sm text-amber-800 mt-2 leading-relaxed font-medium">
              Your banking profile is currently restricted. Core features like domestic transfers and new account requests have been temporarily disabled. 
              Please reach out to our security desk at <span className="font-bold underline cursor-pointer hover:text-amber-600 transition-colors">support@bankingsystem.com</span> or visit your local branch to reactivate your access.
            </p>
          </div>
        </motion.div>
      )}

      {showSuccessModal && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Request Sent!</h2>
            <p className="text-slate-600 mb-6">
              Your account request has been successfully queued. Our admin team will review and approve it shortly.
              We are committed to providing you with the best banking experience.
            </p>
            <button 
              onClick={() => setShowSuccessModal(false)}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              Got it, thanks!
            </button>
          </div>
        </motion.div>
      )}

      {showCloseConfirm && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Confirm Closure</h2>
            <p className="text-slate-600 mb-6">
              Are you sure you want to request closure for this account? 
              Note: Secondary accounts must be closed before the primary account can be processed.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCloseConfirm(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleCloseAccount(showCloseConfirm)}
                disabled={closeLoading}
                className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center justify-center gap-2"
              >
                {closeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {showProfileModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
            <button 
              onClick={() => setShowProfileModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Edit Profile</h2>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={profileData.displayName}
                    onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    value={profileData.phoneNumber}
                    onChange={(e) => setProfileData({ ...profileData, phoneNumber: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    placeholder="+1 234 567 890"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                  <textarea
                    value={profileData.address}
                    onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none min-h-[100px]"
                    placeholder="Enter your full address"
                  />
                </div>
              </div>
              <button 
                type="submit"
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
              >
                Save Changes
              </button>
            </form>
          </div>
        </motion.div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl flex items-center gap-4 text-rose-600 mb-8">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">{error}</p>
            <p className="text-sm opacity-80">Banking services might still be starting up. Please try again in a few seconds.</p>
          </div>
          <button 
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchData();
            }}
            className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {accounts.filter(a => {
              const status = (a.status || '').toLowerCase().trim();
              const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
              return !forbidden.includes(status);
            }).length === 0 ? (
              <div className="col-span-full py-12 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-900">No active accounts</h3>
                <p className="text-slate-500 max-w-xs mx-auto mt-2">
                  You don't have any active accounts. Request a primary or secondary account to get started.
                </p>
              </div>
            ) : (
              accounts.filter(a => {
                const status = (a.status || '').toLowerCase().trim();
                const forbidden = ['closed', 'permanently_closed', 'deleted_final'];
                return !forbidden.includes(status);
              }).map((account) => (
                <motion.div
                  key={account.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleAccountClick(account)}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group cursor-pointer"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Wallet className="w-16 h-16" />
                  </div>
                  <div className="flex flex-col h-full justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{account.accountNumber}</p>
                      <h3 className="text-3xl font-bold text-slate-900 mt-1">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: account.currency }).format(account.balance)}
                      </h3>
                    </div>
                    <div className="mt-6 flex items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${account.isPrimary ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-800'}`}>
                        {account.isPrimary ? 'Primary' : 'Secondary'}
                      </span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${
                        account.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 
                        account.status === 'frozen' ? 'bg-amber-100 text-amber-800' : 
                        account.status === 'locked' ? 'bg-rose-100 text-rose-800' : 
                        account.status === 'closure_pending' ? 'bg-indigo-100 text-indigo-800 animate-pulse' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {account.status}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Messages Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Mail className="w-5 h-5 text-indigo-500" />
                Notification Inbox
              </h2>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-full uppercase">
                {emails.filter(e => !e.read).length} Unread
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {emails.length === 0 ? (
                <div className="p-12 text-center text-slate-500 italic">Your inbox is empty. Notifications about transfers and account changes will appear here.</div>
              ) : (
                emails.map((email) => (
                  <div 
                    key={email.id} 
                    onClick={async () => {
                      if (email.read) return;
                      const token = localStorage.getItem('token');
                      try {
                        await fetch('/api/emails/mark-read', {
                          method: 'POST',
                          headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({ emailId: email.id })
                        });
                        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e));
                      } catch (err) {
                        console.error('Failed to mark email as read:', err);
                      }
                    }}
                    className={`px-6 py-4 transition-colors cursor-pointer hover:bg-slate-50 ${email.read ? 'opacity-60' : 'bg-indigo-50/30'}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className={`text-sm ${email.read ? 'font-medium' : 'font-bold'} text-slate-900`}>{email.subject}</h4>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {(() => {
                          try {
                            const d = new Date(email.timestamp);
                            if (isNaN(d.getTime())) return 'Recently';
                            return d.toLocaleString('en-IN', { 
                              timeZone: 'Asia/Kolkata', 
                              day: '2-digit', 
                              month: 'short', 
                              hour: '2-digit', 
                              minute: '2-digit', 
                              hour12: false 
                            });
                          } catch (e) {
                            return 'Recently';
                          }
                        })()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{email.body}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Recent Activity Sidebar */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-500" />
                Recent History
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {transactions.length === 0 ? (
                <div className="p-12 text-center text-slate-400 italic">No activity yet.</div>
              ) : (
                   transactions.slice(0, 10).map((tx) => {
                  const userAccountNumbers = accounts.map(a => String(a.accountNumber).trim());
                  const isIncoming = userAccountNumbers.includes(String(tx.to).trim());
                  const isOutgoing = userAccountNumbers.includes(String(tx.from).trim());
                  const isInternal = isIncoming && isOutgoing;
                  
                  // Use the type from backend if available
                  const displayIncome = tx.type === 'deposit' || (isIncoming && !isOutgoing);
                  const displayExpense = tx.type === 'withdrawal' || (isOutgoing && !isIncoming);

                  return (
                    <div key={tx.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-full ${isInternal ? 'bg-indigo-100 text-indigo-600' : displayIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                          {isInternal ? <ArrowLeftRight className="w-4 h-4" /> : displayIncome ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate max-w-[120px]">
                            {tx.type === 'internal' ? 'Internal Transfer' : isInternal ? 'Self Transfer' : isIncoming ? 'Received' : 'Sent'}
                          </p>
                          <div className="flex items-center gap-1">
                            <p className="text-[9px] text-slate-400 font-mono tracking-tighter">TX-{tx.id.substring(0, 8)}</p>
                            <span className="text-slate-300">|</span>
                            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tight">{tx.status}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-bold ${isInternal ? 'text-indigo-600' : isIncoming ? 'text-emerald-600' : 'text-slate-900'}`}>
                          {isInternal ? '' : isIncoming ? '+' : '-'}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                        </p>
                        <p className="text-[9px] text-slate-400">
                          {(() => {
                            try {
                              const d = new Date(tx.timestamp);
                              if (isNaN(d.getTime())) return 'Recently';
                              return d.toLocaleString('en-IN', { 
                                timeZone: 'Asia/Kolkata', 
                                day: '2-digit', 
                                month: 'short', 
                                hour: '2-digit', 
                                minute: '2-digit', 
                                hour12: true 
                              });
                            } catch (e) {
                              return 'Recently';
                            }
                          })() || 'Just now'}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Account Details Modal */}
      <AnimatePresence>
        {selectedAccount && (
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
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]"
            >
              <button 
                onClick={() => setSelectedAccount(null)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 z-10"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-4 mb-8">
                <div className="p-4 bg-indigo-100 rounded-2xl text-indigo-600">
                  <Wallet className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedAccount?.accountNumber || 'Account'}</h2>
                  <p className="text-slate-500 uppercase tracking-widest text-xs font-bold">{selectedAccount?.isPrimary ? 'Primary Account' : 'Secondary Account'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 shrink-0">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Current Balance</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {selectedAccount ? new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedAccount.currency }).format(selectedAccount.balance) : '$0.00'}
                  </p>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Status</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${selectedAccount?.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                    <p className="text-lg font-bold text-slate-900 uppercase">{selectedAccount?.status || 'Unknown'}</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <div className="flex items-center gap-4">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <History className="w-5 h-5 text-indigo-500" />
                      Account Activity
                    </h3>
                    {setActiveTab && selectedAccount?.status === 'active' && (
                      <button
                        onClick={() => {
                          setSelectedAccount(null);
                          setActiveTab('transfer');
                        }}
                        className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-1.5 shadow-sm shadow-indigo-100"
                      >
                        <Send className="w-3 h-3" />
                        Send Funds
                      </button>
                    )}
                  </div>
                  {selectedAccount && !['closed', 'permanently_closed', 'deleted_final'].includes((selectedAccount.status || '').toLowerCase()) && (
                    <button
                      onClick={() => setShowCloseConfirm(selectedAccount.id)}
                      disabled={closeLoading}
                      className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 disabled:opacity-50"
                    >
                      {closeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      Request Closure
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {txLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                    </div>
                  ) : accountTransactions.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 italic">No transactions for this account yet.</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {accountTransactions.map((tx: any) => {
                        const targetNum = String(selectedAccount?.accountNumber || '').trim();
                        const isCredit = String(tx.to).trim() === targetNum;
                        const isDebit = String(tx.from).trim() === targetNum;
                        const isInternal = isCredit && isDebit;

                        return (
                          <div key={tx.id} className="py-4 flex items-center justify-between hover:bg-slate-50 transition-colors px-2 rounded-xl">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-full ${isCredit && !isInternal ? 'bg-emerald-100 text-emerald-600' : isInternal ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>
                                {isInternal ? <ArrowLeftRight className="w-4 h-4" /> : isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 truncate max-w-[150px]">
                                  {tx.type === 'internal' ? 'Internal Transfer' : isInternal ? 'Self Transfer' : isCredit ? 'Credit Received' : 'Debit Payment'}
                                </p>
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[10px] text-slate-500">
                                    {tx.timestamp && format(new Date(tx.timestamp), 'MMM d, yyyy • HH:mm')}
                                  </p>
                                  <span className="text-slate-200">|</span>
                                  <span className="text-[9px] font-mono text-slate-400">TX-{tx.id.substring(0, 8)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${isCredit && !isInternal ? 'text-emerald-600' : isInternal ? 'text-indigo-600' : 'text-slate-900'}`}>
                                {isInternal ? '' : isCredit ? '+' : '-'}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                              </p>
                              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{tx.status}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Account Closure Confirmation */}
      <AnimatePresence>
        {showCloseConfirm && (
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
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Close Account?</h2>
              <p className="text-slate-500 mb-8">
                This will send a request to the administration for account closure. Once approved, you cannot reopen this account.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowCloseConfirm(null)}
                  className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleCloseAccount(showCloseConfirm)}
                  disabled={closeLoading}
                  className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {closeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Closure Success Modal */}
      <AnimatePresence>
        {showClosureSuccess && (
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
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Request Submitted</h2>
              <p className="text-slate-500 mb-8">
                Your closure request has been submitted successfully and is awaiting administrative approval.
              </p>
              <button 
                onClick={() => setShowClosureSuccess(false)}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Transactions Modal */}
      <AnimatePresence>
        {showAllTransactions && (
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
              className="bg-white rounded-3xl p-8 max-w-3xl w-full shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]"
            >
              <button 
                onClick={() => setShowAllTransactions(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 z-10"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-4 mb-8">
                <div className="p-4 bg-indigo-100 rounded-2xl text-indigo-600">
                  <History className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Transaction History</h2>
                  <p className="text-slate-500 uppercase tracking-widest text-xs font-bold">Comprehensive record of all account activity</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="divide-y divide-slate-100">
                  {transactions.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 italic">No transactions found.</div>
                  ) : (
                    transactions.map((tx) => {
                      const userAccountIdentifiers = accounts.flatMap(a => [String(a.accountNumber).trim(), String(a.id).trim()]);
                      const isIncoming = userAccountIdentifiers.includes(String(tx.to).trim());
                      const isOutgoing = userAccountIdentifiers.includes(String(tx.from).trim());
                      const isInternal = isIncoming && isOutgoing;
                      
                      const displayType = tx.type || (isInternal ? 'internal' : isIncoming ? 'received' : 'transfer');
                      const displayIncome = displayType === 'deposit' || (isIncoming && !isOutgoing);

                      return (
                        <div key={tx.id} className="py-4 flex items-center justify-between hover:bg-slate-50 transition-colors px-2 rounded-xl">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-full ${isInternal ? 'bg-indigo-100 text-indigo-600' : displayIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                              {isInternal ? <ArrowLeftRight className="w-5 h-5" /> : displayIncome ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900 capitalize">
                                {isInternal ? 'Self-Transfer' : isIncoming ? 'Credit Received' : 'Debit Payment'}
                              </p>
                              <p className="text-[10px] text-slate-500 uppercase font-medium tracking-tight">
                                {tx.type || (isInternal ? 'Internal' : isIncoming ? 'Incoming' : 'Withdrawal')}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-bold ${isInternal ? 'text-indigo-600' : isIncoming ? 'text-emerald-600' : 'text-slate-900'}`}>
                              {isInternal ? '±' : isIncoming ? '+' : '-'}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                            </p>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-slate-400 font-mono">TX-{tx.id.substring(0, 5)}</span>
                              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{tx.status}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
