import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfile } from '../types';

interface AuthContextType {
  user: any | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  login: (customerNumber: string, password: string) => Promise<void>;
  register: (data: any) => Promise<any>;
  updateProfile: (data: any) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  profile: null, 
  loading: true, 
  isAdmin: false,
  login: async () => {},
  register: async () => ({}),
  updateProfile: async () => {},
  logout: () => {}
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');
    if (savedUser && savedToken) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);
        setProfile(u);
      } catch (e) {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  }, []);

  const login = async (customerNumber: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerNumber, password })
      });
      
      if (!response.ok) {
        let errorMessage = 'Login failed';
        try {
          // Attempt to parse as JSON first, regardless of headers
          const data = await response.json();
          if (data) {
            if (data.error && data.message) {
              errorMessage = `${data.error}: ${data.message}`;
            } else {
              errorMessage = data.error || data.message || errorMessage;
            }
          }
        } catch (e) {
          // If JSON parsing fails, use status-based defaults
          if (response.status === 401) {
            errorMessage = 'Invalid customer number or password.';
          } else if (response.status === 403) {
            errorMessage = 'Account Access Restricted: This account is currently closed or locked.';
          } else {
            errorMessage = `System error (${response.status})`;
          }
        }
        throw new Error(errorMessage);
      }

      const { user, token } = await response.json();
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('token', token);
      setUser(user);
      setProfile(user);
    } catch (err: any) {
      throw new Error(err.message || 'Login failed');
    }
  };

  const register = async (data: any) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Registration failed');
      }

      return await response.json();
    } catch (err: any) {
      throw new Error(err.message || 'Registration failed');
    }
  };

  const updateProfile = async (data: any) => {
    if (!user) return;
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Update failed');
      }

      const updatedUser = await response.json();
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setProfile(updatedUser);
    } catch (err: any) {
      throw new Error(err.message || 'Update failed');
    }
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, login, register, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
