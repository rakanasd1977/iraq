import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast, PageLoading, Modal, Confirm } from '@rafidain/shared/ui';
import { useAuth } from '../auth';

const ACT_LABEL: any = { view: 'عرض', create: 'إنشاء', edit: 'تعديل', delete: 'حذف', export: 'تصدير' };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const toast = useToast();

  const [assignModal, setAssignModal] = useState<any>(null);
  const [newRoleId, setNewRoleId] = useState('');
  const [deleteAssign, setDeleteAssign] = useState<any>(null);

  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ name_ar: '', email: '', password: '', is_active: true });
  const [creating, setCreating] = useState(false);
  const [delUser, setDelUser] = useState<any>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/rbac/users'),
      api.get('/rbac/roles'),
      api.get('/rbac/resources'),
    ]).then(([u, r, res]) => {
      setUsers(u.data);
      setRoles(r.data.filter((x: any) => x.name !== 'super_admin'));
      setResources(res.data);
      setLoading(false);
    }).catch((e: any) => { toast.error(e.message); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const rolesById = useMemo(() => {
    const m: any = {};
    for (const r of roles) m[r.id] = r;
    return m;
  }, [roles]);

  const resLabel = (key: string) => {
    const f = resources.find((x: any) => x.key === key);
    return f ? f.label : key;
  };

  const effective = (user: any) => {
    const map: any = {};
    let full = false;
    for (const ar of (user.assigned_roles || [])) {
      if (ar.name === 'super_admin') full = true;
      const role = rolesById[ar.id];
      if (!role) continue;
      for (const p of (role.permissions || [])) {
        map[p.resource] = map[p.resource] || new Set();
        map[p.resource].add(p.action);
      }
    }
    return { map, full };
  };

  const permCount = (user: any) => {
    const { map, full } = effective(user);
    if (full) return 'وصول كامل';
    let n = 0;
    for (const k of Object.keys(map)) n += map[k].size;
    return `${n} صلاحية`;
  };

  const myPerms = useMemo(() => {
    const meUser = users.find((u: any) => u.id === me?.id);
    if (!meUser) return { full: true, set: new Set<string>() };
    const { map, full } = effective(meUser);
    const set = new Set<string>();
    for (const r of Object.keys(map)) for (const a of map[r]) set.add(`${r}:${a}`);
    return { full, set };
  }, [users, me, rolesById]);

  const can = (res: string, act: string) => myPerms.full || myPerms.set.has(`${res}:${act}`);

  const filtered = users.filter((u: any) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.name_ar || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s);
  });

  const availableRoles = assignModal
    ? roles.filter((r: any) => !(assignModal.assigned_roles || []).some((ar: any) => ar.id === r.id))
    : [];

  const openAssign = (user: any) => { setAssignModal(user); setNewRoleId(''); };

  const handleAssign = async () => {
    if (!newRoleId || !assignModal) return;
    try {
      await api.post(`/rbac/users/${assignModal.id}/roles`, { role_id: newRoleId });
      toast.success('تم تعيين الدور');
      setAssignModal(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleUnassign = async () => {
    if (!deleteAssign) return;
    try {
      await api.del(`/rbac/users/${deleteAssign.userId}/roles/${deleteAssign.roleId}`);
      toast.success('تم إزالة الدور');
      setDeleteAssign(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleCreate = async () => {
    if (!form.name_ar || !form.email || !form.password) { toast.error('الاسم والبريد وكلمة المرور مطلوبة'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) { toast.error('صيغة البريد الإلكتروني غير صالحة'); return; }
    if (form.password.length < 6) { toast.error('كلمة المرور 6 أحرف على الأقل'); return; }
    setCreating(true);
    try {
      await api.post('/rbac/users', { ...form, is_active: form.is_active ? 1 : 0 });
      toast.success('تم إنشاء المسؤول');
      setCreateModal(false);
      setForm({ name_ar: '', email: '', password: '', is_active: true });
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  const toggleActive = async (user: any) => {
    setToggling(user.id);
    try {
      await api.patch(`/rbac/users/${user.id}`, { is_active: user.is_active ? 0 : 1 });
      toast.success('تم تحديث الحالة');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setToggling(null); }
  };

  const confirmDelete = async () => {
    if (!delUser) return;
    try {
      await api.del(`/rbac/users/${delUser.id}`);
      toast.success('تم حذف المسؤول');
      setDelUser(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const activeCount = users.filter((u: any) => u.is_active).length;

  if (loading) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إدارة صلاحيات المسؤولين</h2>
          <p>هنا تدير حسابات المسؤولين وأدوارهم وصلاحياتهم الفعلية — كل مسؤول قد يحمل أكثر من دور، وصلاحياته هي اتحاد كل أدواره.</p>
        </div>
        {can('users', 'create') && (
          <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ مسؤول جديد</button>
        )}
      </div>

      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-value">{users.length}</div><div className="stat-label">إجمالي المسؤولين</div></div>
        <div className="card stat-card"><div className="stat-value">{activeCount}</div><div className="stat-label">نشطون</div></div>
        <div className="card stat-card"><div className="stat-value">{users.length - activeCount}</div><div className="stat-label">موقوفون</div></div>
        <div className="card stat-card"><div className="stat-value">{roles.length}</div><div className="stat-label">الأدوار المتاحة</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="section-title">قائمة المسؤولين</div>
          <input
            className="input input-sm"
            style={{ maxWidth: 240 }}
            placeholder="بحث بالاسم أو البريد…"
            value={q}
            onChange={(e: any) => setQ(e.target.value)}
          />
        </div>
        <div className="card-body">
          {filtered.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: 30 }}>لا يوجد مسؤولون مطابقون</div>
          ) : (
            <div className="admin-list">
              {filtered.map((user: any) => {
                const { map, full } = effective(user);
                const resourcesList = Object.keys(map);
                const isSelf = me && me.id === user.id;
                return (
                  <div className="admin-item" key={user.id}>
                    <div className="admin-main">
                      <div className="avatar">{((user.name_ar || '؟').trim()[0] || '؟')}</div>
                      <div className="admin-info">
                        <div className="admin-name">
                          <strong>{user.name_ar}</strong>
                          <span className={`badge ${user.is_active ? 'badge-green' : 'badge-red'}`}>{user.is_active ? 'نشط' : 'موقوف'}</span>
                          <span className="badge badge-teal">{permCount(user)}</span>
                        </div>
                        <div className="muted mono" style={{ fontSize: 13 }}>{user.email}</div>
                        <div className="flex flex-wrap gap-xs mt-1">
                          {(user.assigned_roles || []).map((r: any) => (
                            <span key={r.id} className={`badge ${r.name === 'super_admin' ? 'badge-purple' : 'badge-blue'}`} style={{ fontSize: 12 }}>
                              {r.name_ar}
                              {can('users', 'edit') && (
                                <button className="btn btn-ghost btn-xs" style={{ marginInlineStart: 4, padding: 0, lineHeight: 1 }} onClick={() => setDeleteAssign({ userId: user.id, roleId: r.id })}>×</button>
                              )}
                            </span>
                          ))}
                          {(user.assigned_roles || []).length === 0 && <span className="muted">بدون أدوار</span>}
                        </div>
                      </div>
                      <div className="admin-actions">
                        {can('users', 'edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => openAssign(user)}>تعيين دور</button>
                        )}
                        {can('users', 'edit') && (
                          <button className="btn btn-outline btn-sm" disabled={toggling === user.id} onClick={() => toggleActive(user)}>
                            {user.is_active ? 'إيقاف' : 'تفعيل'}
                          </button>
                        )}
                        {can('users', 'delete') && !isSelf && (
                          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setDelUser(user)}>حذف</button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === user.id ? null : user.id)}>
                          {expanded === user.id ? 'إخفاء الصلاحيات' : 'عرض الصلاحيات'}
                        </button>
                      </div>
                    </div>

                    {expanded === user.id && (
                      <div className="admin-perms">
                        {full ? (
                          <div className="perm-full">هذا المسؤول يمتلك <strong>وصولاً كاملاً</strong> لكل الموارد والصلاحيات (دور super_admin).</div>
                        ) : resourcesList.length === 0 ? (
                          <div className="muted">لا توجد صلاحيات معينة — عيّن دوراً أولاً.</div>
                        ) : (
                          <div className="perm-groups">
                            {resourcesList.map((res) => (
                              <div className="perm-group" key={res}>
                                <div className="perm-group-title">{resLabel(res)}</div>
                                <div className="flex flex-wrap gap-xs">
                                  {[...map[res]].map((a: any) => (
                                    <span key={a} className="badge badge-gray" style={{ fontSize: 12 }}>{ACT_LABEL[a] || a}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!assignModal} title={`تعيين دور لـ ${assignModal?.name_ar}`} onClose={() => setAssignModal(null)} size="sm">
        <div className="mb-3">
          <label className="block mb-1">اختر دوراً</label>
          {availableRoles.length === 0 ? (
            <div className="muted">لا توجد أدوار إضافية متاحة للتعيين لهذا المسؤول.</div>
          ) : (
            <select value={newRoleId} onChange={(e: any) => setNewRoleId(e.target.value)} className="input" style={{ width: '100%' }}>
              <option value="">— اختر دور —</option>
              {availableRoles.map((r: any) => (
                <option key={r.id} value={r.id}>{r.name_ar} ({r.name})</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-sm justify-end">
          <button className="btn btn-outline" onClick={() => setAssignModal(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={handleAssign} disabled={!newRoleId}>تعيين</button>
        </div>
      </Modal>

      <Modal open={createModal} title="مسؤول جديد" onClose={() => setCreateModal(false)} size="sm">
        <div className="stack">
          <div>
            <label className="block mb-1">الاسم</label>
            <input className="input" style={{ width: '100%' }} value={form.name_ar} onChange={(e: any) => setForm({ ...form, name_ar: e.target.value })} placeholder="مثال: موظف الدعم" />
          </div>
          <div>
            <label className="block mb-1">البريد الإلكتروني</label>
            <input className="input" style={{ width: '100%' }} value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} placeholder="admin2@rafidain.iq" dir="ltr" />
          </div>
          <div>
            <label className="block mb-1">كلمة المرور</label>
            <input className="input" type="password" style={{ width: '100%' }} value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} placeholder="******" dir="ltr" />
          </div>
          <label className="flex gap-xs items-center">
            <input type="checkbox" checked={form.is_active} onChange={(e: any) => setForm({ ...form, is_active: e.target.checked })} />
            <span>حساب نشط (يمكنه تسجيل الدخول)</span>
          </label>
        </div>
        <div className="flex gap-sm justify-end mt-3">
          <button className="btn btn-outline" onClick={() => setCreateModal(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'جارٍ الإنشاء…' : 'إنشاء'}</button>
        </div>
      </Modal>

      <Confirm open={!!deleteAssign} title="إزالة الدور" message="هل أنت متأكد من إزالة هذا الدور من المسؤول؟" onConfirm={handleUnassign} onCancel={() => setDeleteAssign(null)} danger />
      <Confirm open={!!delUser} title="حذف المسؤول" message={`هل أنت متأكد من حذف ${delUser?.name_ar}؟ لا يمكن التراجع.`} onConfirm={confirmDelete} onCancel={() => setDelUser(null)} danger />
    </div>
  );
}
