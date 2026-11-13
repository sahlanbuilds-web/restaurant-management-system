import { useEffect, useState } from 'react';
import './AdminUsers.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const blankUser = { name: '', email: '', phone: '', role: 'Cashier', status: 'active', password: '' };

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setError('');
    setLoading(true);
    try {
      setUsers(await request('/users'));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveUser(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const editing = Boolean(form.id);
    if (!editing && form.password.length < 10) {
      setError('New passwords must contain at least 10 characters.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (editing && !payload.password) delete payload.password;
      await request(editing ? `/users/${form.id}` : '/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setForm(null);
      setMessage(editing ? 'Staff account updated.' : 'Staff account created.');
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-users">
      <header className="admin-users-heading">
        <div><h1>Staff management</h1><p>Create accounts, assign staff roles, deactivate access, or set a new password.</p></div>
        <button type="button" className="admin-users-primary" onClick={() => { setError(''); setForm({ ...blankUser }); }}>Add staff account</button>
      </header>
      {error && <div className="admin-users-alert error" role="alert">{error}</div>}
      {message && <div className="admin-users-alert success" role="status">{message}</div>}
      {loading ? <p className="admin-users-empty">Loading staff accounts…</p> : users.length === 0 ? <p className="admin-users-empty">No staff accounts found.</p> : (
        <div className="admin-users-list">
          {users.map((user) => (
            <article className="admin-users-row" key={user.id}>
              <div className="admin-users-details">
                <strong>{user.name}</strong>
                <span>{user.email}{user.phone ? ` · ${user.phone}` : ''}</span>
              </div>
              <span className={`admin-users-role role-${user.role.toLowerCase()}`}>{user.role}</span>
              <span className={`admin-users-status ${user.status === 'active' ? 'is-active' : ''}`}>{user.status}</span>
              <button type="button" onClick={() => { setError(''); setForm({ ...user, password: '' }); }}>Edit</button>
            </article>
          ))}
        </div>
      )}
      {form && <div className="admin-users-backdrop" onMouseDown={() => !saving && setForm(null)}>
        <form className="admin-users-dialog" onSubmit={saveUser} onMouseDown={(event) => event.stopPropagation()}>
          <div className="admin-users-dialog-heading"><h3>{form.id ? 'Edit staff account' : 'Add staff account'}</h3><button type="button" aria-label="Close" disabled={saving} onClick={() => setForm(null)}>×</button></div>
          <div className="admin-users-fields">
            <label>Full name<input required maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label>Email address<input required type="email" maxLength={150} autoComplete="email" value={form.email} onChange={(event) => setField('email', event.target.value)} /></label>
            <label>Phone number<input maxLength={30} autoComplete="tel" value={form.phone || ''} onChange={(event) => setField('phone', event.target.value)} /></label>
            <label>Role<select value={form.role} onChange={(event) => setField('role', event.target.value)}><option>Admin</option><option>Cashier</option><option>Waiter</option><option>Kitchen</option></select></label>
            <label>Account status<select value={form.status} onChange={(event) => setField('status', event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label>{form.id ? 'Set new password (optional)' : 'Initial password'}<input type="password" required={!form.id} minLength={10} maxLength={1024} autoComplete="new-password" value={form.password} onChange={(event) => setField('password', event.target.value)} /><small>Use at least 10 characters. Changing role, status, or password signs the account out of existing sessions.</small></label>
          </div>
          <div className="admin-users-actions"><button type="button" onClick={() => setForm(null)} disabled={saving}>Cancel</button><button type="submit" className="admin-users-primary" disabled={saving}>{saving ? 'Saving…' : 'Save account'}</button></div>
        </form>
      </div>}
    </section>
  );
}
