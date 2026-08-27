export type ItemKind = 'products' | 'menu' | 'rooms' | 'flights' | 'packages';

export interface ApiRecord {
  [key: string]: any;
}

export interface CartItem extends ApiRecord {
  provider_id: number | string;
  item_id: number | string;
  kind: ItemKind;
  quantity: number;
  unit_price: number;
  provider_name?: string;
  name?: string;
  image?: string;
}

export interface CartProviderGroup {
  provider_id: number | string;
  provider_name?: string;
  items: CartItem[];
}

export interface Governorate extends ApiRecord {
  id: number;
  code: string;
  name_ar: string;
  name_en?: string;
  providers_count?: number;
  lat?: number;
  lng?: number;
}

export interface User extends ApiRecord {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
}

export interface Provider extends ApiRecord {
  id: number;
  name?: string;
}

export interface Service extends ApiRecord {
  slug?: string;
}

export interface Order extends ApiRecord {
  id: number | string;
}

export interface CartContextValue {
  items: CartItem[];
  addItem: (entry: CartItem) => void;
  setQuantity: (providerId: number | string, kind: ItemKind, itemId: number | string, quantity: number) => void;
  removeItem: (providerId: number | string, kind: ItemKind, itemId: number | string) => void;
  clear: () => void;
  byProvider: () => CartProviderGroup[];
  totalCount: number;
  totalAmount: number;
}

export interface AuthContextValue {
  user: User | null;
  setUser: (u: User | null) => void;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: any) => Promise<any>;
  verifyEmail: (token: string) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<User>;
}

export interface FavoritesContextValue {
  ids: Set<number>;
  isFavorite: (providerId: number | string) => boolean;
  toggle: (providerId: number | string) => Promise<boolean>;
  isItemFavorite: (itemType: string, itemId: number | string) => boolean;
  toggleItem: (itemType: string, itemId: number | string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export interface FollowContextValue {
  ids: Set<number>;
  isFollowing: (providerId: number | string) => boolean;
  toggle: (providerId: number | string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export interface GovernorateContextValue {
  governorates: Governorate[];
  governorate: Governorate | null;
  select: (g: Governorate) => void;
  openPicker: () => void;
  closePicker: () => void;
}

export interface ThemeContextValue {
  theme: 'dark' | 'light';
  toggle: () => void;
}
