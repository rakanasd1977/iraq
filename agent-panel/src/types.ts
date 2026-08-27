export interface NotificationItem {
  id: number | string;
  is_read?: boolean;
  url?: string;
  icon?: string;
  title: string;
  body: string;
  created_at?: string;
}

export interface ActivityRow {
  id: number | string;
  action: string;
  entity_type: string;
  entity_id?: number | string;
  actor_name?: string;
  actor_role?: string;
  details?: Record<string, any> | null;
  created_at?: string;
}

export interface MonthlyCommission {
  month: string;
  commission: number;
}

export interface TopProvider {
  id: number | string;
  name_ar: string;
  orders_count: number;
  commission: number;
}

export interface CommissionsData {
  commission_rate: number | string;
  summary: {
    orders_count: number;
    orders_value: number;
    total_commission: number;
  };
  monthly: MonthlyCommission[];
  top_providers: TopProvider[];
}

export interface Customer {
  id?: number | string;
  name: string;
  email?: string;
  phone?: string;
  orders_count: number;
  total_value: number;
  pending_count: number;
  last_order_at?: string;
}

export interface DashboardStatusItem {
  status: string;
  count: number;
}

export interface DashboardServiceItem {
  id: number | string;
  icon: string;
  name_ar: string;
  orders_count: number;
  orders_value?: number;
  providers_count?: number;
}

export interface DashboardMonthly {
  month: string;
  orders_count: number;
  commission: number;
  agent_commission?: number;
}

export interface TopCustomer {
  name: string;
  phone?: string;
  orders_count: number;
  total_value: number;
}

export interface RecentOrder {
  id: number | string;
  order_number: string;
  provider_name: string;
  customer_name?: string;
  total_amount: number;
  status: string;
  created_at?: string;
}

export interface AttentionItem {
  key: string;
  icon: string;
  label: string;
  tone: string;
  url: string;
}

export interface LeasePayment {
  id: number | string;
  amount: number;
  period_start?: string;
  period_end?: string;
  status: string;
  paid_at?: string;
}

export interface LeaseData {
  governorate_name_ar?: string;
  district_id?: number | null;
  district_name_ar?: string | null;
  lease_status: string;
  lease_expires_at?: string;
  lease_fee?: number | string;
  commission_rate?: number | string;
  is_expired?: boolean;
  payments: LeasePayment[];
}

export interface DashboardData {
  governorate_name_ar: string;
  providers_count: number;
  active_providers_count: number;
  orders_count: number;
  orders_value: number;
  agent_revenue: number;
  platform_revenue: number;
  attention: AttentionItem[];
  orders_by_status: DashboardStatusItem[];
  providers_by_service: DashboardServiceItem[];
  orders_by_service: DashboardServiceItem[];
  monthly: DashboardMonthly[];
  top_customers: TopCustomer[];
  recent_orders: RecentOrder[];
}

export interface OrderRow {
  id: number | string;
  order_number: string;
  customer_name?: string;
  customer_name_ref?: string;
  customer_phone?: string;
  provider_name: string;
  service_name_ar?: string;
  total_amount: number;
  agent_amount: number;
  status: string;
  created_at?: string;
}

export interface ProviderOption {
  id: number | string;
  name_ar: string;
  service_name_ar?: string;
  governorate_id?: number | string;
}

export interface OrderItemJson {
  title: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface OrderHistoryEntry {
  status: string;
  at?: string;
  by?: string;
  by_name?: string;
  note?: string;
}

export interface OrderBooking {
  booking_date?: string;
  check_in?: string;
  check_out?: string;
  guests?: string;
  travel_date?: string;
  passengers?: string;
  nights?: string;
  title?: string;
}

export interface OrderDetail {
  id: number | string;
  order_number: string;
  status: string;
  provider_name: string;
  customer_name?: string;
  customer_name_ref?: string;
  customer_phone?: string;
  service_name_ar?: string;
  total_amount: number;
  agent_amount: number;
  platform_amount: number;
  created_at?: string;
  accepted_at?: string;
  reject_reason?: string;
  items_json?: string;
  booking?: OrderBooking | null;
  history: OrderHistoryEntry[];
}

export interface WalletBalance {
  available: number;
  total_earned: number;
  pending_orders_commission: number;
  approved_withdrawals: number;
  pending_withdrawals: number;
}

export interface WalletIncome {
  id: number | string;
  order_number: string;
  provider_name: string;
  agent_amount: number;
  created_at?: string;
}

export interface WalletWithdrawal {
  id: number | string;
  amount: number;
  status: string;
  notes?: string;
  created_at?: string;
}

export interface WalletData {
  balance: WalletBalance;
  income: WalletIncome[];
  withdrawals: WalletWithdrawal[];
}

export interface ProviderRow {
  id: number | string;
  name_ar: string;
  name_en?: string;
  email: string;
  user_phone?: string;
  service_id?: number | string;
  service_name_ar?: string;
  rating?: number;
  rating_count?: number;
  commission_rate: number | string;
  orders_count?: number;
  verification_status?: string;
  is_verified?: boolean;
  national_id_image?: string;
  residency_doc_image?: string;
  is_active?: boolean;
  address?: string;
  description?: string;
  website?: string;
  verification_note?: string;
  governorate_name_ar?: string;
}

export interface ProviderOverviewProvider {
  service_icon?: string;
  name_ar: string;
  email: string;
  phone?: string;
  verification_status?: string;
  service_name_ar?: string;
  is_active?: boolean;
  commission_rate: number | string;
  orders_count?: number;
  total_value?: number;
  governorate_name_ar?: string;
  created_at?: string;
}

export interface ProviderOverviewMonthly {
  month: string;
  orders_count: number;
  total_value?: number;
  commission?: number;
}

export interface ProviderOverviewOrder {
  order_number: string;
  customer_name?: string;
  customer?: string;
  total_amount: number;
  status: string;
  created_at?: string;
}

export interface ProviderOverviewTransaction {
  id: number | string;
  type: string;
  amount: number;
  balance_after: number;
  note?: string;
  order_number?: string;
}

export interface ProviderOverviewReview {
  rating: number;
  customer_name?: string;
  created_at?: string;
  comment?: string;
  reply?: string;
}

export interface ProviderOverview {
  provider: ProviderOverviewProvider;
  catalog?: Record<string, number>;
  rating?: number;
  rating_count?: number;
  wallet?: { balance?: number };
  monthly: ProviderOverviewMonthly[];
  orders_by_status: DashboardStatusItem[];
  recent_orders: ProviderOverviewOrder[];
  transactions: ProviderOverviewTransaction[];
  reviews: ProviderOverviewReview[];
}
