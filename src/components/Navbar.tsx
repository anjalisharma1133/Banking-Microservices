import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, LayoutDashboard, Send, ShieldCheck, TrendingUp, User as UserIcon, Activity, X, AlertCircle, Mail, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const { profile, isAdmin, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  if (!isAdmin) {
    navItems.push({ id: 'transfer', label: 'Transfer', icon: Send });
    navItems.push({ id: 'email', label: 'Emails', icon: Mail });
  }

  if (isAdmin) {
    navItems.push({ id: 'audit', label: 'Audit Logs', icon: ShieldCheck });
    navItems.push({ id: 'metrics', label: 'Metrics', icon: Activity });
    navItems.push({ id: 'kafka', label: 'Kafka', icon: Zap });
  }

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    logout();
    setShowLogoutConfirm(false);
  };

  return (
    <>
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center flex-1 min-w-0">
            <div className="flex-shrink-0 flex items-center gap-2 text-indigo-600 font-bold text-xl mr-4">
              <ShieldCheck className="w-8 h-8" />
              <span className="hidden md:inline">Banking System</span>
            </div>
            <div className="hidden sm:flex sm:space-x-4 lg:space-x-8 flex-1 overflow-hidden">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-xs lg:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === item.id
                      ? 'border-indigo-500 text-slate-900'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  <item.icon className="w-4 h-4 mr-1.5" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 lg:gap-4 ml-4 flex-shrink-0">
            <div className="flex items-center gap-2 text-xs lg:text-sm text-slate-600">
              <UserIcon className="w-4 h-4 flex-shrink-0" />
              <span className="max-w-[100px] truncate">{profile?.displayName}</span>
              {isAdmin && <span className="bg-indigo-100 text-indigo-700 text-[9px] lg:text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider hidden xs:inline">Admin</span>}
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      </nav>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Confirm Logout</h2>
              <p className="text-slate-600 mb-8 text-sm">
                Are you sure you want to logout? This will clear your session and local cache.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                >
                  Logout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
