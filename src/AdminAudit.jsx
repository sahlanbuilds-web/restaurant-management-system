import { useEffect, useState } from 'react';
import './AdminAudit.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  async function loadLogs() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/audit-logs?limit=50`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load audit logs.');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      log.action.toLowerCase().includes(q) ||
      log.user_name.toLowerCase().includes(q) ||
      log.target_module.toLowerCase().includes(q)
    );
  });

  return (
    <div className="admin-audit-page">
      <header className="audit-header">
        <div>
          <span className="eyebrow">Security & Compliance</span>
          <h1>System Audit Logs</h1>
          <p>Track administrator actions, role modifications, table changes, and security events.</p>
        </div>
        <button type="button" className="btn-refresh" onClick={loadLogs} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh logs'}
        </button>
      </header>

      {error && <div className="audit-alert error">{error}</div>}

      <div className="audit-toolbar">
        <input
          type="search"
          placeholder="Filter by action, user, or module…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span>Showing {filteredLogs.length} events</span>
      </div>

      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Action</th>
              <th>Module</th>
              <th>Operator</th>
              <th>Role</th>
              <th>Details</th>
              <th>IP Address</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-cell">
                  {loading ? 'Loading events…' : 'No audit records match your query.'}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td><strong>#{log.id}</strong></td>
                  <td><span className="action-tag">{log.action}</span></td>
                  <td><span className="module-tag">{log.target_module}</span></td>
                  <td><b>{log.user_name}</b></td>
                  <td><span className={`role-pill role-${log.user_role.toLowerCase()}`}>{log.user_role}</span></td>
                  <td className="details-col">{log.details || '—'}</td>
                  <td><code>{log.ip_address || '127.0.0.1'}</code></td>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

