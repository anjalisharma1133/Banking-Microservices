import React, { useEffect, useState } from 'react';
import { Mail, Clock, CheckCircle, AlertCircle, Loader2, Inbox, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

interface Email {
  id: string;
  toUid: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
}

export const EmailPage: React.FC = () => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  const fetchEmails = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/emails', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch emails');
      const data = await response.json();
      setEmails(data);
    } catch (err) {
      console.error('Email fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
    const interval = setInterval(fetchEmails, 20000);
    return () => clearInterval(interval);
  }, []);

  const markAsRead = async (emailId: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch('/api/emails/mark-read', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ emailId })
      });
      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, read: true } : e));
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const handleEmailClick = (email: Email) => {
    setSelectedEmail(email);
    if (!email.read) {
      markAsRead(email.id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-xl text-indigo-600">
            <Mail className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
        </div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          {emails.filter(e => !e.read).length} Unread
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Email List */}
        <div className="md:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Inbox className="w-4 h-4" />
              Inbox
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {emails.length === 0 ? (
              <div className="p-8 text-center text-slate-400 italic text-sm">
                No notifications yet.
              </div>
            ) : (
              emails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => handleEmailClick(email)}
                  className={`w-full p-4 text-left hover:bg-slate-50 transition-colors relative ${
                    selectedEmail?.id === email.id ? 'bg-indigo-50/50' : ''
                  }`}
                >
                  {!email.read && (
                    <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-indigo-500 rounded-full" />
                  )}
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-xs font-bold truncate ${email.read ? 'text-slate-500' : 'text-indigo-600'}`}>
                      {email.subject}
                    </span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">
                      {(() => {
                        try {
                          const d = new Date(email.timestamp);
                          if (isNaN(d.getTime())) return 'Recently';
                          return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
                        } catch (e) {
                          return 'Recently';
                        }
                      })()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {email.body}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Email Content */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
          <AnimatePresence mode="wait">
            {selectedEmail ? (
              <motion.div
                key={selectedEmail.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col h-full"
              >
                <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-1">{selectedEmail.subject}</h2>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      {(() => {
                        try {
                          const d = new Date(selectedEmail.timestamp);
                          if (isNaN(d.getTime())) return 'Recently';
                          return d.toLocaleString('en-IN', { 
                            timeZone: 'Asia/Kolkata', 
                            day: '2-digit', 
                            month: 'long', 
                            year: 'numeric', 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            hour12: true 
                          });
                        } catch (e) {
                          return 'Recently';
                        }
                      })()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="p-8 flex-1 overflow-y-auto">
                  <div className="flex items-start gap-4 mb-8">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {selectedEmail.body}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-8 pt-8 border-t border-slate-50 text-center">
                    <p className="text-xs text-slate-400 italic">
                      This is an automated notification from Banking System. Please do not reply.
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <Inbox className="w-8 h-8 text-slate-200" />
                </div>
                <p className="text-sm">Select a notification to read its content</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
