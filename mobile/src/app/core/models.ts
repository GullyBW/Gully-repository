/** Shared types mirroring the Tirelo backend API contracts. */

export type UserRole = 'customer' | 'provider' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  profile?: Record<string, unknown>;
  createdAt?: string;
}

export interface AuthResult {
  user: User;
  token: string;
}

export type PaymentMethod = 'orange_money' | 'myzaka' | 'card' | 'bank_transfer';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type BookingStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'declined';

export interface Booking {
  reference: string;
  customerId: string;
  providerId: string;
  serviceType: string;
  description?: string;
  scheduledFor?: string;
  location?: { address?: string; lat?: number; lng?: number };
  amount: number; // minor units (thebe)
  currency: string;
  status: BookingStatus;
  paymentReference?: string;
  paymentStatus?: PaymentStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface Payment {
  reference: string;
  bookingId?: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  description?: string;
  providerMeta?: {
    checkoutUrl?: string;
    instructions?: string;
    paymentReference?: string;
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
    branchCode?: string;
    [key: string]: unknown;
  };
}

/** Standard backend response envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}
