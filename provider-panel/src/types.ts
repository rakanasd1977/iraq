export interface BookedRange {
  order_number: string;
  check_in: string;
  check_out: string;
}

export interface RoomRow {
  id: number | string;
  name_ar: string;
  room_type: string | null;
  price_per_night: number;
  is_available: boolean | null;
  booked_ranges: BookedRange[];
}

export interface BookingRow {
  id: number | string;
  order_number?: string;
  customer_name?: string;
  customer_name_ref?: string;
  customer_phone?: string;
  guests?: number;
  total_amount?: number;
  status: string;
  booking_details?: string;
  check_in?: string;
  check_out?: string;
  booking_date?: string;
}

export interface CatalogColumn {
  key: string;
  label: string;
  money?: boolean;
  roomType?: boolean;
  route?: boolean;
  datetime?: boolean;
}

export interface CatalogField {
  key: string;
  label: string;
  required?: boolean;
  type?: string;
  hint?: string;
  fromCategories?: boolean;
  options?: Record<string, string>;
}

export interface CatalogConfig {
  api: string;
  itemType: string;
  categoriesApi?: string;
  title: string;
  item: string;
  itemF: string;
  icon: string;
  subtitle: string;
  columns: CatalogColumn[];
  fields: CatalogField[];
}

export interface PromoteModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  config: CatalogConfig;
  preset: any;
}

export interface PromotionPreviewProps {
  open: boolean;
  row: any;
  onClose: () => void;
}
