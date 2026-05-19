import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Account } from '../types';
import { Send, Loader2, AlertCircle, CheckCircle2, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const Transfer: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchAccounts = async () => {
    if (!user) return;
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/accounts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch accounts');
      const userAccounts = await response.json();
      setAccounts(userAccounts);
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [user]);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !fromAccount || !toAccount || !amount) return;
    
    // Strict numeric validation
    if (!/^\d*\.?\d+$/.test(amount)) {
      setError('Please enter a valid numeric amount (e.g. 10.50)');
      return;
    }

    if (user.status === 'locked' || user.status === 'dormant') {
      setError(`Your account status is ${user.status}. Transfers are disabled. Please contact support.`);
      return;
    }

    const selectedAccount = accounts.find(a => a.id === fromAccount || a.accountNumber === fromAccount);
    if (selectedAccount && selectedAccount.status !== 'active') {
      setError(`The selected account is ${selectedAccount.status}. Transfers are not permitted.`);
      return;
    }

    if (toAccount.length !== 10) {
      setError('Please enter a valid 10-digit account number.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    const token = localStorage.getItem('token');
    try {
      const amountNum = Number(amount);
      if (isNaN(amountNum) || amountNum <= 0) throw new Error('Invalid amount');

      // Find the account object to get the account number
      const selectedAcc = accounts.find(a => a.id === fromAccount);
      if (!selectedAcc) throw new Error('Source account not found');

      const response = await fetch('/api/transactions/transfer', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          from: selectedAcc.accountNumber, 
          to: toAccount, 
          amount: amountNum,
          description: `Transfer to ${toAccount}`
        })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorJson = await response.json();
          const msg = errorJson.message || errorJson.error || 'Transfer failed';
          throw new Error(msg);
        } else {
          const errorText = await response.text();
          console.error('Non-JSON Error Response:', errorText);
          if (errorText.includes('<html') || errorText.includes('<!DOCTYPE')) {
            if (errorText.includes('403 Forbidden')) {
              throw new Error('Access to the banking service was denied. This may be due to account restrictions or a temporary security block.');
            }
            throw new Error(`The banking service returned an unexpected page. This might indicate the service is currently under maintenance or configuration.`);
          }
          throw new Error(`Server Error (${response.status}): ${response.statusText}`);
        }
      }

      // Safe JSON parsing for the success case
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned an invalid response format. Please try again.');
      }
      
      const result = await response.json();
      console.log('Transfer Result:', result);

      setSuccess(true);
      setAmount('');
      setToAccount('');
      
      // Refresh accounts
      fetchAccounts();

    } catch (err: any) {
      console.error('Transfer error:', err);
      setError(err.message || 'Transfer failed. Check account details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
      >
        <div className="bg-indigo-600 px-8 py-6 text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Send className="w-6 h-6" />
            Send Money
          </h2>
          <p className="text-indigo-100 text-sm mt-1">Transfer funds instantly to any account.</p>
        </div>

        <form onSubmit={handleTransfer} className="p-8 space-y-6">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3 overflow-hidden"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </motion.div>
            )}

            {success && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-3 overflow-hidden"
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">Transfer successful! Your balance has been updated.</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Account</label>
              <select
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
              >
                <option value="">Select an account</option>
                {accounts.filter(acc => acc.status === 'active').map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountNumber} - {new Intl.NumberFormat('en-US', { style: 'currency', currency: acc.currency }).format(acc.balance)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Recipient Account Number</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={toAccount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setToAccount(val);
                    }
                  }}
                  placeholder="Enter 10-digit account number"
                  maxLength={10}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1 italic">Enter the 10-digit numeric account number of the recipient.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setAmount(val);
                    }
                  }}
                  placeholder="0.00"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-bold text-lg"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Confirm Transfer
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};
