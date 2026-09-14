import type { ColorMap, TechnicalData, ZoneData } from '../features/technical/types';
/** Public RPC contract. Money is positive integer COP; null means pending. */
export type UUID = string;
export type Role = 'owner' | 'worker';
export type FormType = 'general' | 'color' | 'keratin';
export type PriceMode = 'fixed' | 'custom';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };
export interface Versioned {
  id: UUID;
  version: number;
}
export interface Profile extends Versioned {
  display_name: string;
  role: Role;
  active: boolean;
}
export interface Client extends Versioned {
  name: string;
  phone: string | null;
  birth_day: number | null;
  birth_month: number | null;
  birth_year: number | null;
  notes: string;
  active: boolean;
  consent: string;
  created_at: string;
}
export interface Category extends Versioned {
  kind: 'service' | 'product';
  parent_id: UUID | null;
  name: string;
  active: boolean;
  sort_order: number;
  default_price_mode: PriceMode | null;
}
export interface Service extends Versioned {
  category_id: UUID;
  name: string;
  path: string;
  form_type: FormType;
  price_mode: PriceMode;
  fixed_price: number | null;
  duration_minutes: number;
  active: boolean;
  sort_order: number;
}
export interface Product extends Versioned {
  category_id: UUID;
  name: string;
  path: string;
  brand: string;
  presentation: string;
  code: string;
  usage: 'sale' | 'internal' | 'both';
  cost?: number | null;
  sale_price: number | null;
  minimum_stock: number;
  stock: number;
  active: boolean;
}
export interface PaymentMethod extends Versioned {
  name: string;
  is_cash: boolean;
  active: boolean;
}
export interface Appointment extends Versioned {
  client_id: UUID;
  client_name: string;
  professional_id: UUID;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  notes: string;
  service_ids: UUID[];
  visit_id: UUID | null;
  created_by: UUID;
}
export type HairZone = ZoneData;
export type HairMap = ColorMap;
export type TechnicalForm = TechnicalData;
export interface VisitService extends Versioned {
  visit_id: UUID;
  service_id: UUID;
  group_id: UUID | null;
  name: string;
  path: string;
  form_type: FormType;
  form_version: number;
  price_mode: PriceMode;
  reference_price: number | null;
  price: number | null;
  status: 'draft' | 'completed' | 'void';
  technical: TechnicalForm;
  completed_at: string | null;
}
export interface SaleLine extends Versioned {
  account_id: UUID;
  product_id: UUID;
  service_record_id: UUID | null;
  name: string;
  path: string;
  quantity: number;
  unit_price: number;
  status: 'draft' | 'confirmed' | 'discarded';
  confirmed_at: string | null;
}
export interface Payment {
  id: UUID;
  account_id: UUID;
  amount: number;
  paid_at: string;
  method_id: UUID;
  method_name: string;
  is_cash: boolean;
  reference: string;
  created_by: UUID;
  corrected_by: UUID | null;
  correction_of: UUID | null;
  reason: string | null;
}
export interface Account {
  id: UUID;
  visit_id: UUID | null;
  professional_id: UUID;
  subtotal_known: number;
  pending_prices: number;
  total: number | null;
  paid: number;
  balance: number | null;
  payment_status: 'pending_prices' | 'unpaid' | 'partial' | 'paid';
  ready_for_payment: boolean;
}
export interface Visit extends Versioned {
  client_id: UUID;
  client_name: string;
  professional_id: UUID;
  appointment_id: UUID | null;
  starts_at: string;
  status: 'draft' | 'in_progress' | 'completed' | 'void';
  notes: string;
  created_by: UUID;
}
export interface VisitDetail {
  visit: Visit;
  services: VisitService[];
  sales: SaleLine[];
  payments: Payment[];
  account: Account;
}
export interface StockMovement {
  id: UUID;
  product_id: UUID;
  name: string;
  path: string;
  quantity: number;
  kind: 'initial' | 'purchase' | 'consumption' | 'adjustment' | 'sale' | 'correction';
  reason: string;
  visit_id: UUID | null;
  sale_id: UUID | null;
  correction_of: UUID | null;
  created_at: string;
  created_by: UUID;
}
export interface Expense {
  id: UUID;
  concept: string;
  category: string;
  amount: number;
  paid_at: string;
  method_id: UUID;
  method_name: string;
  is_cash: boolean;
  stock_movement_id: UUID | null;
  created_by: UUID;
  correction_of: UUID | null;
  corrected_by: UUID | null;
}
export interface CashSession extends Versioned {
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  counted_amount: number | null;
  expected_amount: number;
  difference: number | null;
  notes: string;
}
export interface CashMovement {
  id: UUID;
  session_id: UUID;
  kind: 'contribution' | 'withdrawal';
  amount: number;
  reason: string;
  created_at: string;
}
export interface Birthday {
  id: UUID;
  name: string;
  birth_day: number;
  birth_month: number;
  date: string;
}
export interface BirthdayResult {
  server_date: string;
  events: Birthday[];
  notice: { target_month: string; seen: boolean; clients: Birthday[] } | null;
}
export interface BackupStatus {
  id: UUID;
  run_key: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'failed';
  message: string;
  bytes: number | null;
  artifact_name: string | null;
}
export type ExportScope = 'global' | 'client';
export interface ExportRequest {
  scope: ExportScope;
  id?: UUID;
  revision?: Json;
  table?: string;
  offset?: number;
  limit?: number;
}
export interface ExportManifest {
  format_version: 1;
  scope: ExportScope;
  client_id: UUID | null;
  revision: Json;
  tables: { name: string; count: number }[];
}
export interface ExportPage {
  format_version: 1;
  scope: ExportScope;
  client_id: UUID | null;
  revision: Json;
  table: string;
  items: Json[];
  total: number;
  next_offset: number | null;
}
export interface ExportResponse<T = Json> {
  generated_at: string;
  currency: 'COP';
  timezone: 'America/Bogota';
  data: T;
}
export interface Settings {
  prevent_overlap: boolean;
  privacy_text: string;
  responsible_name: string;
  responsible_contact: string;
  version: number;
}
export interface FinanceResult {
  from: string;
  to: string;
  currency: 'COP';
  generated_at: string;
  charges: {
    id: UUID;
    account_id: UUID;
    kind: string;
    name: string;
    path: string;
    amount: number;
    confirmed_at: string;
  }[];
  payments: Payment[];
  expenses: Expense[];
  accounts: Account[];
  totals: {
    charges: number;
    collected: number;
    expenses: number;
    operating_flow: number;
    balance: number;
    pending_prices: number;
  };
  cash_sessions: CashSession[];
  cash_movements: CashMovement[];
}
export interface QueryResults {
  bootstrap: {
    profile: Profile;
    profiles: Profile[];
    settings: Settings;
    server_date: string;
    backup: BackupStatus | null;
  };
  clients: { items: Client[]; total: number };
  client: {
    client: Client;
    history: {
      visit_id: UUID;
      starts_at: string;
      professional_id: UUID;
      professional_name: string;
      status: string;
      services: Omit<VisitService, 'price' | 'reference_price'>[];
    }[];
    duplicates: Client[];
  };
  catalog: { categories: Category[]; services: Service[] };
  inventory: { categories: Category[]; products: Product[]; movements: StockMovement[] };
  appointments: { items: Appointment[] };
  visits: { items: Visit[]; total: number };
  visit: VisitDetail;
  account: { account: Account; sales: SaleLine[]; payments: Payment[] };
  finance: FinanceResult;
  settings: {
    settings: Settings;
    profiles: Profile[];
    payment_methods: PaymentMethod[];
    backup: BackupStatus | null;
  };
  birthdays: BirthdayResult;
  audit: {
    items: {
      id: number;
      actor_id: UUID;
      action: string;
      entity_id: string;
      before_data: Json;
      after_data: Json;
      reason: string | null;
      created_at: string;
    }[];
  };
  export: ExportResponse;
  operation: { result: Json } | null;
}
/** IDs omitted on creation; updates require the latest version. Dates are ISO timestamps except date/month fields. */
export interface CommandPayloads {
  'client.save': Partial<Client> & { name: string };
  'category.save': Partial<Category> & { name: string; kind: Category['kind'] };
  'category.archive': Versioned;
  'category.delete': Versioned;
  'service.save': Partial<Service> & {
    name: string;
    category_id: UUID;
    form_type: FormType;
    price_mode: PriceMode;
  };
  'service.archive': Versioned;
  'product.save': Partial<Product> & { name: string; category_id: UUID; usage: Product['usage'] };
  'product.archive': Versioned;
  'appointment.save': Partial<Appointment> & {
    client_id: UUID;
    professional_id: UUID;
    starts_at: string;
    ends_at: string;
    service_ids: UUID[];
  };
  'appointment.start': Versioned;
  'visit.create': {
    client_id: UUID;
    professional_id?: UUID;
    starts_at?: string;
    service_ids?: UUID[];
  };
  'visit.save': Versioned & {
    professional_id?: UUID;
    notes?: string;
    starts_at?: string;
    status?: 'draft' | 'in_progress';
    reason?: string;
  };
  'visit.close': Versioned;
  'visit.void': Versioned & { reason: string };
  'service.add': {
    visit_id: UUID;
    version: number;
    service_ids: UUID[];
    group_id?: UUID;
    technical?: TechnicalForm;
  };
  'service_record.save': Versioned & {
    technical: TechnicalForm;
    price?: number | null;
    status?: 'draft' | 'completed';
    reason?: string;
  };
  'service.remove': Versioned;
  'service.copy': { source_id: UUID; visit_id: UUID; version: number };
  'service.refresh_price': Versioned;
  'sale.save': Partial<SaleLine> & { account_id: UUID; product_id: UUID; quantity: number };
  'sale.confirm': Versioned;
  'sale.discard': Versioned;
  'account.create': { client_id?: UUID };
  'payment.record': {
    account_id: UUID;
    amount: number;
    method_id: UUID;
    paid_at: string;
    reference?: string;
  };
  'payment.correct': {
    id: UUID;
    amount: number;
    method_id: UUID;
    paid_at: string;
    reference?: string;
    reason: string;
  };
  'charge.correct': Versioned & { price: number; reason: string };
  'inventory.move': {
    product_id: UUID;
    quantity: number;
    kind: 'initial' | 'purchase' | 'consumption' | 'adjustment';
    reason: string;
    visit_id?: UUID;
  };
  'inventory.correct': { id: UUID; quantity: number; reason: string };
  'payment_method.save': Partial<PaymentMethod> & { name: string; is_cash: boolean };
  'expense.save': {
    concept: string;
    category: string;
    amount: number;
    method_id: UUID;
    paid_at: string;
    stock_movement_id?: UUID;
  };
  'expense.correct': {
    id: UUID;
    concept: string;
    category: string;
    amount: number;
    method_id: UUID;
    paid_at: string;
    reason: string;
  };
  'cash.open': { opening_amount: number; notes?: string };
  'cash.move': {
    session_id: UUID;
    kind: 'contribution' | 'withdrawal';
    amount: number;
    reason: string;
  };
  'cash.close': Versioned & { counted_amount: number; notes?: string };
  'birthday.seen': { target_month: string };
  'profile.save': Versioned & { display_name: string; active: boolean; role: Role };
  'settings.save': Settings;
}
export type QueryAction = keyof QueryResults;
export type CommandAction = keyof CommandPayloads;
export interface CommandResult {
  id: UUID;
  version?: number;
  visit_id?: UUID;
  account_id?: UUID;
  [key: string]: Json | undefined;
}
