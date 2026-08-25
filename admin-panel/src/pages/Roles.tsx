import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, Modal, Confirm, Badge, Field } from '@rafidain/shared/ui';
import { useAuthPermissions } from '../auth';

const ACTION_LABELS: Record<string, string> = {
  view: 'عرض', create: 'إنشاء', edit: 'تعديل', delete: 'حذف', export: 'تصدير',
};

function groupPerms(perms: any[]) {
  const map: Record<string, Set<string>> = {};
  (perms || []).forEach((p) => {
    if (!p.resource || !p.action) return;
    if (!map[p.resource]) map[p.resource] = new Set();
    map[p.resource].add(p.action);
  });
  return map;
}

export default function Roles() {
  const [tab, setTab] = useState<'roles' | 'users'>('roles');
  const [roles, setRoles] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const { can } = useAuthPermissions();

  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [form, setForm] = useState({ name: '', name_ar: '', description: '' });
  const [permMatrix, setPermMatrix] = useState<any>({});
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const [assignModal, setAssignModal] = useState<any>(null);
  const [newRoleId, setNewRoleId] = useState('');
  const [deleteAssign, setDeleteAssign] = useState<any>(null);

  const resMap: Record<string, string> = {};
  resources.forEach((r) => { resMap[r.key] = r.label; });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/rbac/roles'),
      api.get('/rbac/resources'),
    ]).then(([rolesRes, resRes]) => {
      setRoles(rolesRes.data);
      setResources(resRes.data);
      setLoading(false);
    }).catch((e: any) => { toast.error(e.message); setLoading(false); });
  };

  const loadUsers = () => {
    if (!can('users', 'view')) return;
    api.get('/rbac/users').then((r) => setUsers(r.data)).catch((e: any) => toast.error(e.message));
  };

  useEffect(() => { load(); }, []);

  const buildMatrix = (perms: any[], editableResList: any[]) => {
    const matrix: any = {};
    editableResList.forEach((r) => {
      matrix[r.key] = {};
      r.actions.forEach((a: string) => { matrix[r.key][a] = false; });
    });
    (perms || []).forEach((p: any) => {
      if (matrix[p.resource]) matrix[p.resource][p.action] = true;
    });
    return matrix;
  };

  const openCreate = () => {
    setEditingRole(null);
    setForm({ name: '', name_ar: '', description: '' });
    setPermMatrix(buildMatrix([], resources));
    setShowModal(true);
  };

  const openEdit = (role: any) => {
    setEditingRole(role);
    setForm({ name: role.name, name_ar: role.name_ar, description: role.description || '' });
    setPermMatrix(buildMatrix(role.permissions, resources));
    setShowModal(true);
  };

  const toggleAction = (resource: string, action: string, value: boolean) => {
    setPermMatrix((prev: any) => ({ ...prev, [resource]: { ...prev[resource], [action]: value } }));
  };

  const toggleResource = (resource: string, actions: string[], value: boolean) => {
    setPermMatrix((prev: any) => {
      const next = { ...prev, [resource]: { ...prev[resource] } };
      actions.forEach((a) => { next[resource][a] = value; });
      return next;
    });
  };

  const selectAll = (value: boolean) => {
    setPermMatrix((prev: any) => {
      const next: any = {};
      Object.keys(prev).forEach((res) => {
        next[res] = {};
        Object.keys(prev[res]).forEach((a) => { next[res][a] = value; });
      });
      return next;
    });
  };

  const isSuperAdmin = (role: any) => role?.name === 'super_admin';
  const matrixEditable = (role: any) => !isSuperAdmin(role);

  const collectPerms = () => Object.entries(permMatrix).flatMap(([resource, actions]: [string, any]) =>
    Object.entries(actions).filter(([_, v]) => v).map(([action]) => ({ resource, action }))
  );

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    try {
      let roleId: number;
      if (editingRole) {
        await api.put(`/rbac/roles/${editingRole.id}`, { name_ar: form.name_ar, description: form.description });
        roleId = editingRole.id;
        if (matrixEditable(editingRole)) {
          await api.put(`/rbac/roles/${roleId}/permissions`, { permissions: collectPerms() });
        }
        toast.success('تم تحديث الدور');
      } else {
        const res = await api.post('/rbac/roles', { name: form.name, name_ar: form.name_ar, description: form.description });
        roleId = res.data.id;
        await api.put(`/rbac/roles/${roleId}/permissions`, { permissions: collectPerms() });
        toast.success('تم إنشاء الدور');
      }
      setShowModal(false);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.del(`/rbac/roles/${deleteConfirm.id}`);
      toast.success('تم حذف الدور');
      setDeleteConfirm(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

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

  if (loading) return <PageLoading />;

  const roleSummary = (role: any) => {
    if (isSuperAdmin(role)) return { full: true, count: 0 };
    const grouped = groupPerms(role.permissions);
    let count = 0;
    Object.values(grouped).forEach((s) => { count += s.size; });
    return { full: false, count };
  };

  return (
    <div>
      <div className="page-head flex-between">
        <div>
          <h2>الأدوار والصلاحيات</h2>
          <p>إدارة صلاحيات المسؤولين بدقة: عرض/إنشاء/تعديل/حذف/تصدير لكل مورد، وتعيين الأدوار للمستخدمين</p>
        </div>
        <div className="flex gap-sm">
          <div className="filters" style={{ gap: 4 }}>
            <button className={`tab ${tab === 'roles' ? 'tab--active' : ''}`} onClick={() => setTab('roles')}>الأدوار</button>
            {can('users', 'view') && (
              <button className={`tab ${tab === 'users' ? 'tab--active' : ''}`} onClick={() => { setTab('users'); loadUsers(); }}>تعيين الأدوار للمسؤولين</button>
            )}
          </div>
          {tab === 'roles' && can('roles', 'create') && (
            <button className="btn btn-primary" onClick={openCreate}>➕ دور جديد</button>
          )}
        </div>
      </div>

      {tab === 'roles' && (
        roles.length === 0 ? (
          <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}>لا توجد أدوار معرفة</div></div>
        ) : (
          <div className="grid grid-2">
            {roles.map((role) => {
              const sum = roleSummary(role);
              const grouped = groupPerms(role.permissions);
              return (
                <div className="card" key={role.id}>
                  <div className="card-body">
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <div>
                        <strong style={{ fontSize: 16 }}>{role.name_ar}</strong>
                        <span className="muted mono" style={{ marginInlineStart: 8, fontSize: 12 }}>{role.name}</span>
                      </div>
                      {role.is_system
                        ? <Badge status="system" map={{ system: { label: 'نظامي', cls: 'badge-teal' } }} />
                        : <span className="badge badge-gray">مخصص</span>}
                    </div>
                    <div className="muted mb-2" style={{ fontSize: 13 }}>{role.description || '—'}</div>

                    <div className="flex gap-sm mb-2" style={{ fontSize: 12 }}>
                      <span className="badge badge-blue">المستخدمون: {fmt(role.users_count || 0)}</span>
                      {sum.full
                        ? <span className="badge badge-green">وصول كامل لكل الموارد</span>
                        : <span className="badge badge-amber">صلاحيات: {fmt(sum.count)}</span>}
                    </div>

                    {!sum.full && (
                      <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                        {Object.entries(grouped).map(([res, actions]: [string, any]) => (
                          <div key={res} style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{resMap[res] || res}</div>
                            <div className="flex gap-xs flex-wrap" style={{ marginTop: 2 }}>
                              {[...actions].map((a) => (
                                <span key={a} className="badge badge-gray" style={{ fontSize: 11 }}>{ACTION_LABELS[a] || a}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-sm mt-3">
                      {can('roles', 'edit') && role.name !== 'super_admin' && (
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(role)}>تعديل الصلاحيات</button>
                      )}
                      {!role.is_system && can('roles', 'delete') && (
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(role)}>حذف</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'users' && (
        users.length === 0 ? (
          <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}>لا يوجد مستخدمون بدور admin</div></div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المسؤول</th>
                    <th>البريد</th>
                    <th>الحالة</th>
                    <th>الأدوار المعينة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.name_ar}</strong></td>
                      <td className="muted mono">{user.email}</td>
                      <td><span className={`badge ${user.is_active ? 'badge-green' : 'badge-red'}`}>{user.is_active ? 'نشط' : 'موقوف'}</span></td>
                      <td>
                        <div className="flex gap-xs flex-wrap">
                          {(user.assigned_roles || []).map((r: any) => (
                            <span key={r.id} className="badge badge-teal" style={{ fontSize: 12 }}>
                              {r.name_ar}
                              {can('users', 'edit') && (
                                <button className="btn btn-ghost btn-xs" style={{ marginInlineStart: 4, padding: 0, lineHeight: 1 }} onClick={() => setDeleteAssign({ userId: user.id, roleId: r.id })}>×</button>
                              )}
                            </span>
                          ))}
                          {(user.assigned_roles || []).length === 0 && <span className="muted">لا يوجد</span>}
                        </div>
                      </td>
                      <td>
                        {can('users', 'edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => openAssign(user)}>تعيين دور</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <Confirm open={!!deleteConfirm} title="حذف الدور" message={`هل أنت متأكد من حذف دور "${deleteConfirm?.name_ar}"؟ هذا الإجراء لا يمكن التراجع عنه.`} onConfirm={handleDelete} onCancel={() => setDeleteConfirm(null)} danger />

      <Confirm open={!!deleteAssign} title="إزالة الدور" message="هل أنت متأكد من إزالة هذا الدور من المسؤول؟" onConfirm={handleUnassign} onCancel={() => setDeleteAssign(null)} danger />

      <Modal open={showModal} title={editingRole ? `تعديل صلاحيات: ${editingRole.name_ar}` : 'دور جديد'} onClose={() => setShowModal(false)} size="lg">
        <form onSubmit={handleSubmit}>
          <div className="grid grid-2 mb-3">
            {!editingRole && (
              <Field label="الاسم (إنجليزي)" required>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: content_manager" />
              </Field>
            )}
            <Field label="الاسم بالعربي" required>
              <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} placeholder="مثال: مدير محتوى" />
            </Field>
          </div>
          <Field label="الوصف" full>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="وصف مختصر للدور..." />
          </Field>

          {editingRole && editingRole.is_system && !isSuperAdmin(editingRole) && (
            <div className="alert-info mb-3" style={{ fontSize: 13 }}>⚠️ دور نظامي: لا يمكن تعديل الاسم أو الوصف، لكن يمكنك تعديل صلاحياته.</div>
          )}
          {isSuperAdmin(editingRole) && (
            <div className="alert-success mb-3" style={{ fontSize: 13 }}>✅ دور المدير الكامل (super_admin): يملك كل الصلاحيات ولا يمكن تعديلها.</div>
          )}

          <div className="card mb-3">
            <div className="card-header flex-between">
              <h3>مصفوفة الصلاحيات</h3>
              {matrixEditable(editingRole) && (
                <div className="flex gap-xs">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectAll(true)}>تحديد الكل</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectAll(false)}>إلغاء الكل</button>
                </div>
              )}
            </div>
            <div className="card-body">
              {!matrixEditable(editingRole) ? (
                <div className="alert-success" style={{ fontSize: 13 }}>يملك هذا الدور صلاحيات كاملة لكل الموارد والإجراءات.</div>
              ) : (
                <div style={{ maxHeight: 360, overflow: 'auto' }}>
                  {resources.map((r) => (
                    <div key={r.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div className="flex-between mb-1">
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                        <label className="flex items-center gap-xs" style={{ fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={r.actions.every((a: string) => permMatrix[r.key]?.[a])}
                            onChange={(e) => toggleResource(r.key, r.actions, e.target.checked)}
                          />
                          <span className="muted">الكل</span>
                        </label>
                      </div>
                      <div className="flex gap-sm flex-wrap">
                        {r.actions.map((a: string) => (
                          <label key={a} className="flex items-center gap-xs" style={{ fontSize: 13, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!permMatrix[r.key]?.[a]}
                              onChange={(e) => toggleAction(r.key, a, e.target.checked)}
                            />
                            <span>{ACTION_LABELS[a] || a}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-sm justify-end">
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>إلغاء</button>
            {(editingRole ? can('roles', 'edit') : can('roles', 'create')) && (
              <button type="submit" className="btn btn-primary">{editingRole ? 'حفظ التغييرات' : 'إنشاء الدور'}</button>
            )}
          </div>
        </form>
      </Modal>

      <Modal open={!!assignModal} title={`تعيين دور لـ ${assignModal?.name_ar}`} onClose={() => setAssignModal(null)} size="sm">
        <div className="mb-3">
          <label className="block mb-1">اختر دوراً</label>
          <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)} className="input" style={{ width: '100%' }}>
            <option value="">— اختر دور —</option>
            {roles.filter((r) => !assignModal?.assigned_roles?.some((ar: any) => ar.id === r.id)).map((r) => (
              <option key={r.id} value={r.id}>{r.name_ar} ({r.name})</option>
            ))}
          </select>
        </div>
        <div className="flex gap-sm justify-end">
          <button className="btn btn-outline" onClick={() => setAssignModal(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={handleAssign} disabled={!newRoleId}>تعيين</button>
        </div>
      </Modal>
    </div>
  );
}
