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

export interface Category {
  key: string;
  name: string;
  icon: string;
}

export interface ProviderCard {
  userId: string;
  businessName: string;
  fullName: string;
  category: string;
  profilePhoto?: string;
  rating: number;
  reviewCount: number;
  completedJobs: number;
  startingPrice?: number;
  availabilityStatus: string;
  verified: boolean;
  responseTimeMinutes: number;
  distanceKm?: number | null;
}

export interface ProviderProfile extends ProviderCard {
  bio: string;
  categories: string[];
  yearsExperience: number;
  languages: string[];
  certifications: string[];
  licenses: string[];
  portfolio: string[];
  areasServed: string[];
  operatingHours: string;
  location?: { lat?: number; lng?: number; address?: string };
  responseRate: number;
  cancellationRate: number;
  memberSince?: string;
}

export interface ProviderSearchResult {
  items: ProviderCard[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ProviderSearchParams {
  category?: string;
  q?: string;
  minRating?: number;
  maxPrice?: number;
  availableOnly?: boolean;
  verifiedOnly?: boolean;
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface Review {
  id: string;
  providerId: string;
  customerId: string;
  bookingReference: string;
  rating: number;
  title?: string;
  comment?: string;
  photos?: string[];
  customerName: string;
  status: string;
  createdAt?: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface Availability {
  providerId: string;
  workingDays: number[];
  startTime: string;
  endTime: string;
  slotMinutes: number;
  holidays: string[];
  emergencyAvailable: boolean;
  vacationMode: boolean;
  vacationUntil?: string | null;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface BookingLocation {
  lat?: number;
  lng?: number;
  address?: string;
}
