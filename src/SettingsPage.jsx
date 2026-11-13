import { useEffect, useState } from 'react';
import './SettingsPage.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const defaultSettings = {
  restaurant_name: 'Proxima Technologies',
  business_email: 'admin@proxima.com',
  phone: '+94 77 234 5677',
  address: '123 Main Street, Colombo, Sri Lanka',
  timezone: 'Asia/Colombo',
  currency: 'LKR',
  receipt_header: 'Proxima Technologies',
  receipt_footer: 'Thank you for dining with us.',
  bill_printing_mode: 'ASK_LOCATION'
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(defaultSettings);
  const [printers, setPrinters] = useState([]);
  const [printJobs, setPrintJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        const [settingsRes, printersRes, jobsRes] = await Promise.all([
          request('/settings'),
          request('/printers'),
          request('/billing/print-jobs?limit=10')
        ]);
        if (!active) return;
        setSettings({ ...defaultSettings, ...settingsRes });
        setPrinters(printersRes || []);
        setPrintJobs(jobsRes || []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadData();
    return () => { active = false; };
  }, []);

  function updateField(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  function updatePrinterField(id, field, value) {
    setPrinters((current) =>
      current.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  async function savePrinter(printer) {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const payload = {
        printer_name: printer.printer_name,
        connection_type: printer.connection_type,
        printer_address: printer.printer_address,
        printer_port: printer.printer_port,
        paper_width: printer.paper_width,
        is_active: printer.is_active
      };
      await request(`/printers/${printer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setSuccess(`Printer "${printer.printer_name}" updated successfully.`);
      // Refresh status
      const updatedPrinters = await request('/printers');
      setPrinters(updatedPrinters);
    } catch (err) {
      setError(`Failed to save printer: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function testPrinter(printer) {
    setError('');
    setSuccess('');
    setTestingId(printer.id);
    try {
      const result = await request(`/printers/${printer.id}/test`, {
        method: 'POST'
      });
      const note = result.simulated ? ' (Simulated Mode)' : '';
      setSuccess(`Test print sent to ${printer.printer_name} successfully!${note}`);
      // Refresh recent jobs
      const jobsRes = await request('/billing/print-jobs?limit=10');
      setPrintJobs(jobsRes || []);
    } catch (err) {
      setError(`Test print failed: ${err.message}`);
    } finally {
      setTestingId(null);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const payload = {
        restaurant_name: settings.restaurant_name,
        business_email: settings.business_email,
        phone: settings.phone,
        address: settings.address,
        timezone: settings.timezone,
        currency: settings.currency,
        receipt_header: settings.receipt_header,
        receipt_footer: settings.receipt_footer,
        bill_printing_mode: settings.bill_printing_mode
      };
      const result = await request('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setSettings({ ...defaultSettings, ...result.settings });
      setSuccess('Restaurant settings saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <p className="eyebrow">Restaurant settings</p>
          <h1>Business & Printer Setup</h1>
        </div>
        <button type="button" className="primary-button" onClick={saveSettings} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save general settings'}
        </button>
      </header>

      {error && <div className="settings-alert error" role="alert">{error}</div>}
      {success && <div className="settings-alert success" role="status">{success}</div>}

      {loading ? (
        <p className="settings-empty">Loading configuration & printers…</p>
      ) : (
        <div className="settings-container">
          {/* PRINTER SETTINGS SECTION */}
          <div className="settings-card printer-section-card">
            <div className="card-header-row">
              <div>
                <h2>3-Location Thermal Billing Printers</h2>
                <p>Configure dedicated physical thermal receipt printers for Kitchen, Cashier, and Bar.</p>
              </div>
              <span className="badge-highlight">BILLING MODE: ASK LOCATION</span>
            </div>

            <div className="printers-config-grid">
              {printers.map((printer) => (
                <div key={printer.id} className={`printer-config-card ${!printer.is_active ? 'card-inactive' : ''}`}>
                  <div className="printer-config-header">
                    <div>
                      <span className={`location-tag ${printer.location_key}`}>
                        {printer.location_key.toUpperCase()}
                      </span>
                      <h3>{printer.printer_name}</h3>
                    </div>
                    <div className="printer-status-tags">
                      <span className={`tag ${printer.is_active ? 'tag-active' : 'tag-disabled'}`}>
                        {printer.is_active ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className={`tag ${printer.is_connected ? 'tag-online' : 'tag-offline'}`}>
                        {printer.is_connected ? 'Connected' : 'Offline'}
                      </span>
                    </div>
                  </div>

                  <div className="printer-fields-grid">
                    <label>
                      Printer name
                      <input
                        value={printer.printer_name}
                        onChange={(e) => updatePrinterField(printer.id, 'printer_name', e.target.value)}
                        placeholder="Printer name"
                        required
                      />
                    </label>

                    <label>
                      Connection type
                      <select
                        value={printer.connection_type}
                        onChange={(e) => updatePrinterField(printer.id, 'connection_type', e.target.value)}
                      >
                        <option value="Network">Network (TCP/IP)</option>
                        <option value="USB">USB / Virtual COM</option>
                        <option value="Windows">Windows Direct</option>
                      </select>
                    </label>

                    <label>
                      IP / Device Path
                      <input
                        value={printer.printer_address}
                        onChange={(e) => updatePrinterField(printer.id, 'printer_address', e.target.value)}
                        placeholder={printer.connection_type === 'Network' ? '192.168.1.200' : 'COM3 or USB001'}
                        required
                      />
                    </label>

                    {printer.connection_type === 'Network' && (
                      <label>
                        Port (Default 9100)
                        <input
                          type="number"
                          value={printer.printer_port}
                          onChange={(e) => updatePrinterField(printer.id, 'printer_port', e.target.value)}
                          placeholder="9100"
                        />
                      </label>
                    )}

                    <label>
                      Paper size
                      <select
                        value={printer.paper_width}
                        onChange={(e) => updatePrinterField(printer.id, 'paper_width', e.target.value)}
                      >
                        <option value="80mm">80mm (Standard)</option>
                        <option value="58mm">58mm (Compact)</option>
                      </select>
                    </label>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={Boolean(printer.is_active)}
                        onChange={(e) => updatePrinterField(printer.id, 'is_active', e.target.checked ? 1 : 0)}
                      />
                      Active for billing
                    </label>
                  </div>

                  <div className="printer-card-actions">
                    <button
                      type="button"
                      className="btn-test-print"
                      onClick={() => testPrinter(printer)}
                      disabled={testingId === printer.id || !printer.is_active || saving}
                    >
                      {testingId === printer.id ? 'Testing…' : 'Test print'}
                    </button>
                    <button
                      type="button"
                      className="btn-save-printer"
                      onClick={() => savePrinter(printer)}
                      disabled={saving}
                    >
                      Save config
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* PRINT JOBS HISTORY */}
            {printJobs.length > 0 && (
              <div className="print-jobs-subpanel">
                <h3>Recent Billing Print History</h3>
                <div className="jobs-table-wrap">
                  <table className="jobs-table">
                    <thead>
                      <tr>
                        <th>Job ID</th>
                        <th>Order</th>
                        <th>Printer</th>
                        <th>Type</th>
                        <th>Requested By</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printJobs.map((job) => (
                        <tr key={job.id}>
                          <td><strong>#{job.id}</strong></td>
                          <td>{job.order_id ? `#${job.order_id}` : '—'}</td>
                          <td>{job.printer_name}</td>
                          <td><span className="job-type-pill">{job.job_type}</span></td>
                          <td>{job.requested_by}</td>
                          <td>
                            <span className={`status-badge status-${job.status.toLowerCase()}`}>
                              {job.status}
                            </span>
                            {job.error_message && <small className="job-err"> {job.error_message}</small>}
                          </td>
                          <td>{new Date(job.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* GENERAL RESTAURANT DETAILS */}
          <form className="settings-form" onSubmit={saveSettings}>
            <div className="settings-card">
              <h2>Profile</h2>
              <div className="settings-grid">
                <label>
                  Restaurant name
                  <input value={settings.restaurant_name} onChange={(event) => updateField('restaurant_name', event.target.value)} maxLength={150} required />
                </label>
                <label>
                  Business email
                  <input type="email" value={settings.business_email} onChange={(event) => updateField('business_email', event.target.value)} maxLength={150} required />
                </label>
                <label>
                  Phone number
                  <input value={settings.phone} onChange={(event) => updateField('phone', event.target.value)} maxLength={30} required />
                </label>
                <label>
                  Timezone
                  <select value={settings.timezone} onChange={(event) => updateField('timezone', event.target.value)}>
                    <option value="Asia/Colombo">Asia/Colombo (GMT+5:30)</option>
                    <option value="UTC">UTC</option>
                    <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                    <option value="Europe/London">Europe/London (GMT+0)</option>
                  </select>
                </label>
                <label className="span-2">
                  Address
                  <input value={settings.address} onChange={(event) => updateField('address', event.target.value)} maxLength={255} required />
                </label>
              </div>
            </div>

            <div className="settings-card">
              <h2>Receipt defaults</h2>
              <div className="settings-grid">
                <label>
                  Currency
                  <select value={settings.currency} onChange={(event) => updateField('currency', event.target.value)}>
                    <option value="LKR">LKR — Sri Lankan Rupee</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                  </select>
                </label>
                <label>
                  Receipt header
                  <input value={settings.receipt_header} onChange={(event) => updateField('receipt_header', event.target.value)} maxLength={255} required />
                </label>
                <label className="span-2">
                  Receipt footer
                  <input value={settings.receipt_footer} onChange={(event) => updateField('receipt_footer', event.target.value)} maxLength={255} required />
                </label>
              </div>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
