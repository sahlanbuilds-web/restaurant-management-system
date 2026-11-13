import { useEffect, useState } from 'react';
import './AdminPermissions.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;

const modulesList = [
  { key: 'dashboard', label: 'Dashboard & Metrics' },
  { key: 'pos', label: 'POS & Billing Workspace' },
  { key: 'orders', label: 'Order History & Refunds' },
  { key: 'tables', label: 'Table Management' },
  { key: 'kitchen', label: 'Kitchen & Bar Tickets' },
  { key: 'menu', label: 'Menu & Categories' },
  { key: 'inventory', label: 'Inventory & Stock' },
  { key: 'users', label: 'Staff & User Management' },
  { key: 'printers', label: 'Billing Printer Config' },
  { key: 'reports', label: 'Sales & Financial Reports' },
  { key: 'settings', label: 'Restaurant Settings' },
  { key: 'audit', label: 'System Audit Logs' }
];

export default function AdminPermissions() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRole, setSelectedRole] = useState('Admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/roles`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load roles and permissions.');
      const data = await res.json();
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function getPerm(roleName, modKey, action) {
    if (roleName === 'Admin') return true; // Admin has super-access always
    const found = permissions.find((p) => p.role_name === roleName && p.module_name === modKey);
    return found ? Boolean(found[action]) : false;
  }

  async function togglePerm(roleName, modKey, action) {
    if (roleName === 'Admin') return; // Cannot downgrade super-admin
    setError('');
    setSuccess('');
    setSaving(true);

    const currentVal = getPerm(roleName, modKey, action);
    const existing = permissions.find((p) => p.role_name === roleName && p.module_name === modKey) || {};

    const payload = {
      module_name: modKey,
      can_view: action === 'can_view' ? !currentVal : Boolean(existing.can_view),
      can_create: action === 'can_create' ? !currentVal : Boolean(existing.can_create),
      can_edit: action === 'can_edit' ? !currentVal : Boolean(existing.can_edit),
      can_delete: action === 'can_delete' ? !currentVal : Boolean(existing.can_delete)
    };

    try {
      const res = await fetch(`${API}/roles/${roleName}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to update permission.');
      setSuccess(`Updated ${action} for ${roleName} on ${modKey}.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-perms-page">
      <header className="perms-header">
        <div>
          <span className="eyebrow">Access Control</span>
          <h1>Role & Permission Management</h1>
          <p>
            Configure granular module permissions per role. The <strong>Admin</strong> role retains
            unrestricted super-access across all current and future modules.
          </p>
        </div>
      </header>

      {error && <div className="perms-alert error">{error}</div>}
      {success && <div className="perms-alert success">{success}</div>}

      <div className="role-tabs">
        {roles.map((r) => (
          <button
            key={r.role_name}
            className={`role-tab ${selectedRole === r.role_name ? 'active' : ''}`}
            onClick={() => setSelectedRole(r.role_name)}
          >
            <strong>{r.role_name}</strong>
            <small>{r.role_name === 'Admin' ? 'Super Admin' : 'Staff Role'}</small>
          </button>
        ))}
      </div>

      <div className="perms-card">
        <div className="perms-card-head">
          <div>
            <h2>Permissions for {selectedRole}</h2>
            <p>
              {selectedRole === 'Admin'
                ? 'Admin permissions are permanently unlocked with full bypass.'
                : 'Configure Read, Create, Update, and Delete access for this role.'}
            </p>
          </div>
          {selectedRole === 'Admin' && (
            <span className="badge-super">UNRESTRICTED SUPER ACCESS</span>
          )}
        </div>

        <div className="table-wrap">
          <table className="perms-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>View / Read</th>
                <th>Create / Add</th>
                <th>Edit / Update</th>
                <th>Delete / Remove</th>
              </tr>
            </thead>
            <tbody>
              {modulesList.map((mod) => {
                const canView = getPerm(selectedRole, mod.key, 'can_view');
                const canCreate = getPerm(selectedRole, mod.key, 'can_create');
                const canEdit = getPerm(selectedRole, mod.key, 'can_edit');
                const canDelete = getPerm(selectedRole, mod.key, 'can_delete');
                const isAdmin = selectedRole === 'Admin';

                return (
                  <tr key={mod.key}>
                    <td>
                      <strong>{mod.label}</strong>
                      <code>{mod.key}</code>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={canView}
                        disabled={isAdmin || saving}
                        onChange={() => togglePerm(selectedRole, mod.key, 'can_view')}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={canCreate}
                        disabled={isAdmin || saving}
                        onChange={() => togglePerm(selectedRole, mod.key, 'can_create')}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={canEdit}
                        disabled={isAdmin || saving}
                        onChange={() => togglePerm(selectedRole, mod.key, 'can_edit')}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={canDelete}
                        disabled={isAdmin || saving}
                        onChange={() => togglePerm(selectedRole, mod.key, 'can_delete')}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

