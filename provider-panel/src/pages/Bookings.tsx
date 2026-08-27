import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Badge, ORDER_STATUS, Pagination } from '@rafidain/shared/ui';
import { RoomRow, BookingRow } from '../types';

function parseBooking(row: any) {
  if (row.check_in && row.check_out) return `من ${fmtDate(row.check_in)} إلى ${fmtDate(row.check_out)}`;
  if (row.booking_date) return fmtDate(row.booking_date);
  if (row.booking_details) {
    try {
      const d = JSON.parse(row.booking_details);
      if (d.date) return fmtDate(d.date);
      if (d.check_in) return `من ${fmtDate(d.check_in)}${d.check_out ? ' إلى ' + fmtDate(d.check_out) : ''}`;
    } catch (e: any) { /* ignore */ }
  }
  return '-';
}

function RoomAvailability() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const toast = useToast();

  const load = (f = from, t = to) => {
    const p = new URLSearchParams();
    if (f) p.set('from', f);
    if (t) p.set('to', t);
    api.get(`/provider/rooms/availability?${p.toString()}`).then((r) => setRooms(r.data)).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load('', ''); }, []);

  const check = () => {
    if (!from || !to) { toast.error('اختر تاريخي الوصول والمغادرة أولاً'); return; }
    if (new Date(to) <= new Date(from)) { toast.error('تاريخ المغادرة يجب أن يكون بعد الوصول'); return; }
    load(from, to);
  };

  return (
    <div className="card mb-4">
      <div className="card-header"><h3>🛏️ توفر الغرف حسب التاريخ</h3></div>
      <div className="card-body">
        <div className="filters">
          <label className="muted" style={{ fontSize: 12 }}>الوصول</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="muted" style={{ fontSize: 12 }}>المغادرة</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={check}>تحقق من التوفر</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setFrom(''); setTo(''); load('', ''); }}>مسح</button>
        </div>
        {rooms === null ? <PageLoading /> : rooms.length === 0 ? (
          <EmptyState text="لا توجد غرف مفعّلة" icon="🛏️" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>الغرفة</th><th>النوع</th><th>السعر/ليلة</th><th>الحالة</th><th>حجوزات هذه الغرفة</th></tr></thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td className="bold">{r.name_ar}</td>
                    <td>{r.room_type || '-'}</td>
                    <td>{fmt(r.price_per_night)} د.ع</td>
                    <td>
                      {r.is_available === null ? <span className="muted">اختر تاريخين</span> : (
                        r.is_available
                          ? <Badge status="free" map={{ free: { label: 'متاحة ✓', cls: 'badge-green' } }} />
                          : <Badge status="busy" map={{ busy: { label: 'محجوزة في الفترة', cls: 'badge-red' } }} />
                      )}
                    </td>
                    <td>
                      {r.booked_ranges.length === 0 ? <span className="muted">لا توجد حجوزات</span> : (
                        <div className="flex wrap" style={{ gap: 4 }}>
                          {r.booked_ranges.map((b, i) => (
                            <span key={i} className="badge badge-amber" title={`الطلب ${b.order_number}`}>
                              {fmtDate(b.check_in).split('،')[0]} ← {fmtDate(b.check_out).split('،')[0]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Bookings() {
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const { user } = useAuth();

  const load = (pg = page) => {
    api.get(`/provider/bookings?page=${pg}&limit=20`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page]);

  const view = async (o: any) => {
    try {
      const res = await api.get(`/orders/${o.id}`);
      setSelected(res.data);
    } catch (e: any) { toast.error(e.message); }
  };

  const changeStatus = async (next: any) => {
    setSaving(true);
    try {
      await api.put(`/orders/${selected.id}/status`, { status: next });
      toast.success('تم تحديث حالة الحجز');
      setSelected((s: any) => ({ ...s, status: next }));
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الحجوزات</h2>
          <p>الحجوزات الواردة من الزبائن — تُحتسب كطلبات ضمن حساب عمولاتك</p>
        </div>
      </div>

      {user?.service_type === 'hotels' && <RoomAvailability />}

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد حجوزات بعد" icon="📅" /> : (
            <table>
              <thead>
                <tr>
                  <th>رقم الحجز</th><th>الزبون</th><th>التاريخ</th><th>النزلاء/المقاعد</th>
                  <th>المبلغ (دينار)</th><th>الحالة</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><span className="mono bold">{o.order_number}</span></td>
                    <td>{o.customer_name || o.customer_name_ref || '-'}<div className="muted" style={{ fontSize: 11 }}>{o.customer_phone}</div></td>
                    <td>{parseBooking(o)}</td>
                    <td>{o.guests ? `${o.guests} ضيف` : '-'}</td>
                    <td className="bold">{fmt(o.total_amount)}</td>
                    <td><Badge status={o.status} map={ORDER_STATUS} /></td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => view(o)}>التفاصيل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={!!selected} title={`الحجز ${selected?.order_number || ''}`} onClose={() => setSelected(null)} size="lg">
        {selected && (
          <>
            <div className="detail-grid mb-4">
              <div className="detail-item"><div className="k">الحالة</div><div className="v"><Badge status={selected.status} map={ORDER_STATUS} /></div></div>
              <div className="detail-item"><div className="k">الزبون</div><div className="v">{selected.customer_name || '-'}<div className="muted">{selected.customer_phone}</div></div></div>
              <div className="detail-item"><div className="k">المبلغ (دينار)</div><div className="v">{fmt(selected.total_amount)}</div></div>
              <div className="detail-item"><div className="k">صافي إيرادك (دينار)</div><div className="v" style={{ color: 'var(--success)' }}>{fmt(selected.provider_amount)}</div></div>
            </div>
            {selected.booking && (
              <div className="card mb-4">
                <div className="card-header"><h3>بيانات الحجز</h3></div>
                <div className="detail-grid">
                  <div className="detail-item"><div className="k">تاريخ الحجز</div><div className="v">{selected.booking.booking_date ? fmtDate(selected.booking.booking_date) : '-'}</div></div>
                  <div className="detail-item"><div className="k">تاريخ الوصول</div><div className="v">{selected.booking.check_in ? fmtDate(selected.booking.check_in) : '-'}</div></div>
                  <div className="detail-item"><div className="k">تاريخ المغادرة</div><div className="v">{selected.booking.check_out ? fmtDate(selected.booking.check_out) : '-'}</div></div>
                  <div className="detail-item"><div className="k">النزلاء/المقاعد</div><div className="v">{selected.booking.guests || '-'}</div></div>
                  {selected.booking.travel_date && <div className="detail-item"><div className="k">تاريخ السفر</div><div className="v">{fmtDate(selected.booking.travel_date)}</div></div>}
                  {selected.booking.passengers && <div className="detail-item"><div className="k">المسافرون</div><div className="v">{selected.booking.passengers}</div></div>}
                  {selected.booking.nights && <div className="detail-item"><div className="k">عدد الليالي</div><div className="v">{selected.booking.nights}</div></div>}
                  {selected.booking.title && <div className="detail-item"><div className="k">العنوان/الرحلة</div><div className="v">{selected.booking.title}</div></div>}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-header"><h3>تغيير حالة الحجز</h3></div>
              <div className="card-body flex wrap">
                {(NEXT_STATUS[selected.status] || []).map((s) => (
                  <button key={s} className="btn btn-outline" disabled={saving} onClick={() => changeStatus(s)}>تحويل إلى: {(ORDER_STATUS as Record<string, any>)[s].label}</button>
                ))}
                {(NEXT_STATUS[selected.status] || []).length === 0 && <span className="muted">لا توجد انتقالات مسموحة من هذه الحالة</span>}
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['cancelled'],
};
