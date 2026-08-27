import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, PageLoading, Toggle } from '@rafidain/shared/ui';

const SETTING_GROUPS = {
  general: { label: 'عام', icon: '⚙️', keys: ['app_name', 'currency', 'about_us', 'support_phone'] },
  commissions: { label: 'العمولات', icon: '💰', keys: ['agent_default_commission', 'platform_commission_default', 'provider_free_orders'] },
  promos: { label: 'الإعلانات والترويج', icon: '📢', keys: ['promo_price', 'promo_duration_days', 'promo_max_active'] },
  shipping: { label: 'الشحن والتوصيل', icon: '🚚', keys: ['free_shipping_min'] },
  loyalty: { label: 'الولاء والإحالة', icon: '🎁', keys: ['loyalty_point_value', 'loyalty_min_redeem', 'loyalty_earn_per_1000', 'referral_bonus_referrer', 'referral_bonus_referee', 'referral_min_order'] },
  coupons: { label: 'كوبونات المزودين', icon: '🎫', keys: ['provider_coupon_max_percent', 'provider_coupon_max_fixed'] },
  payments: { label: 'البنوك والدفع', icon: '🏦', keys: ['al_ahli_bank_name', 'al_ahli_bank_iban', 'first_iraqi_bank_name', 'first_iraqi_bank_iban', 'zain_cash_number', 'asia_pay_number', 'recharge_instructions'] },
  system: { label: 'النظام والأمان', icon: '🔒', keys: ['require_agent_lease', 'activity_log_retention_days'] },
};

const SETTING_META = {
  app_name: { type: 'text', label: 'اسم التطبيق', required: true },
  currency: { type: 'text', label: 'كود العملة (ISO 4217)', required: true },
  about_us: { type: 'textarea', label: 'عن المنصة', rows: 3 },
  support_phone: { type: 'tel', label: 'رقم الدعم' },
  agent_default_commission: { type: 'number', label: 'عمولة الوكيل الافتراضية (%)', min: 0, max: 100, step: 0.1 },
  platform_commission_default: { type: 'number', label: 'عمولة المنصة الافتراضية (%)', min: 0, max: 100, step: 0.1 },
  provider_free_orders: { type: 'number', label: 'عدد الطلبات المجانية للمزود الجديد (بدون عمولة)', min: 0, max: 1000, step: 1 },
  promo_price: { type: 'number', label: 'سعر الترويج (دينار)', min: 0, step: 1000 },
  promo_duration_days: { type: 'number', label: 'مدة الترويج (أيام)', min: 1, max: 365 },
  promo_max_active: { type: 'number', label: 'الحد الأقصى للترويجات النشطة لكل مزود', min: 1, max: 100 },
  free_shipping_min: { type: 'number', label: 'الحد الأدنى للشحن المجاني (دينار)', min: 0, step: 1000 },
  loyalty_point_value: { type: 'number', label: 'قيمة النقطة (دينار)', min: 1, step: 1 },
  loyalty_min_redeem: { type: 'number', label: 'الحد الأدنى للنقاط للاستبدال', min: 1, step: 1 },
  loyalty_earn_per_1000: { type: 'number', label: 'نقاط الولاء لكل 1000 دينار', min: 0, step: 1 },
  referral_bonus_referrer: { type: 'number', label: 'مكافأة الداعي (نقطة ولاء)', min: 0, step: 1 },
  referral_bonus_referee: { type: 'number', label: 'مكافأة المدعو (نقطة ولاء)', min: 0, step: 1 },
  referral_min_order: { type: 'number', label: 'الحد الأدنى للطلب الأول (دينار)', min: 0, step: 1000 },
  provider_coupon_max_percent: { type: 'number', label: 'الحد الأقصى لنسبة خصم كوبونات المزودين (%)', min: 0, max: 100, step: 1 },
  provider_coupon_max_fixed: { type: 'number', label: 'الحد الأقصى للخصم الثابت للمزودين (دينار)', min: 0, step: 1000 },
  al_ahli_bank_name: { type: 'text', label: 'اسم المستفيد - المصرف الأهلي' },
  al_ahli_bank_iban: { type: 'text', label: 'رقم الآيبان - المصرف الأهلي' },
  first_iraqi_bank_name: { type: 'text', label: 'اسم المستفيد - مصرف العراق الأول' },
  first_iraqi_bank_iban: { type: 'text', label: 'رقم الآيبان - مصرف العراق الأول' },
  zain_cash_number: { type: 'textarea', label: 'أرقام زين كاش (رقم في كل سطر)', rows: 2 },
  asia_pay_number: { type: 'textarea', label: 'أرقام آسيا باي (رقم في كل سطر)', rows: 2 },
  recharge_instructions: { type: 'textarea', label: 'تعليمات شحن الرصيد (تظهر للمزودين)', rows: 3 },
  require_agent_lease: { type: 'boolean', label: 'تفعيل تجديد إجارة الوكالة السنوية' },
  activity_log_retention_days: { type: 'number', label: 'الاحتفاظ بسجلات النشاط (أيام)', min: 1, max: 3650 },
};

const TYPE_LABELS = {
  text: 'نص', number: 'رقم', boolean: 'تفعيل/تعطيل', textarea: 'نص طويل', tel: 'هاتف',
};

export default function Settings() {
  const [settings, setSettings] = useState<any>({});
  const [saving, setSaving] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    try {
      const res = await api.get('/settings');
      setSettings(res.data || {});
      setLoading(false);
    } catch (e: any) { toast.error(e.message); setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleChange = (key: any, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: { ...(prev[key] || {}), value } }));
  };

  const handleSave = async (key: any) => {
    const entry = settings[key];
    const value = entry && entry.value !== undefined ? entry.value : entry;
    const meta = (SETTING_META as any)[key];
    const label = meta?.label || key;
    setSaving((prev: any) => ({ ...prev, [key]: true }));
    try {
      await api.put(`/settings/${key}`, { value, label });
      toast.success(`تم حفظ "${label}"`);
      setSaving((prev: any) => ({ ...prev, [key]: false }));
    } catch (e: any) {
      toast.error(e.message);
      setSaving((prev: any) => ({ ...prev, [key]: false }));
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إدارة الإعدادات المركزية</h2>
          <p>جميع إعدادات المنصة في مكان واحد — تعديل فوري مع تحقق من الصحة، لا حاجة لإعادة النشر</p>
        </div>
      </div>

      <div className="grid grid-2 gap-md">
        {Object.entries(SETTING_GROUPS).map(([groupKey, group]) => (
          <div key={groupKey} className="card">
            <div className="card-header flex-between">
              <h3>{group.icon} {group.label}</h3>
              <span className="badge badge-gray">{group.keys.length} إعداد</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {group.keys.map(key => {
                const meta = (SETTING_META as any)[key];
                const current = settings[key];
                if (!meta || !current) return null;
                const isSaving = saving[key];

                return (
                  <div key={key} className="field" style={{ margin: 0 }}>
                    <label>{meta.label} {meta.required && <span className="req">*</span>}</label>
                    {meta.type === 'boolean' ? (
                      <Toggle
                        checked={current?.value === '1' || current?.value === 'true'}
                        onChange={v => handleChange(key, v ? '1' : '0')}
                      />
                    ) : meta.type === 'textarea' ? (
                      <textarea
                        value={current?.value || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        rows={meta.rows || 3}
                        className="input"
                        style={{ width: '100%', fontFamily: 'inherit' }}
                      />
                    ) : meta.type === 'number' ? (
                      <input
                        type="number"
                        value={current?.value || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        min={meta.min}
                        max={meta.max}
                        step={meta.step || 1}
                        className="input"
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <input
                        type={meta.type}
                        value={current?.value || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        className="input"
                        style={{ width: '100%' }}
                      />
                    )}
                    <div className="flex gap-sm items-center" style={{ marginTop: 8 }}>
                      <button
                        className={`btn btn-primary ${isSaving ? 'btn-disabled' : ''}`}
                        onClick={() => handleSave(key)}
                        disabled={isSaving}
                      >
                        {isSaving ? 'جاري الحفظ...' : '💾 حفظ'}
                      </button>
                      <span className="muted mono" style={{ fontSize: 11 }}>المفتاح: {key}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}