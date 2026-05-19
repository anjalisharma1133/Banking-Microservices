export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'client' | 'admin';
  status?: 'active' | 'locked' | 'dormant' | 'deleted_pending_summary' | 'deleted_final';
  createdAt: any;
}

export interface Account {
  id: string;
  ownerUid: string;
  accountNumber: string;
  balance: number;
  currency: string;
  status: 'active' | 'frozen' | 'closed';
  isPrimary: boolean;
  closureRequested?: boolean;
}

export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: any;
  type?: 'transfer' | 'deposit' | 'withdrawal' | 'internal' | 'received';
  status: 'pending' | 'completed' | 'failed';
  initiatorUid: string;
}

export interface AuditLog {
  id: string;
  event: string;
  timestamp: any;
  userId: string;
  metadata?: any;
}
