import { useEffect, useState } from 'react';
import './AdminReports.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const money = (val) => `LKR ${Number(val || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminReports() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState('7days');

  async function loadReports() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/reports/sales-summary`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load reports.');
      const data = await res.json();
      setReportData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

  const summary = reportData?.summary || {};
  const payments = reportData?.paymentBreakdown || [];
  const categories = reportData?.categorySales || [];
  const dailySales = reportData?.dailySales || [];

  return (
    <div className="admin-reports-page">
      <header className="reports-header">
        <div>
          <span className="eyebrow">Financial & Operational Analytics</span>
          <h1>Restaurant Performance Reports</h1>
          <p>Comprehensive overview of gross sales, settlement methods, categories, and volumes.</p>
        </div>
        <div className="header-actions">
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            <option value="7days">Last 7 Days</option>
            <option value="month">This Month</option>
            <option value="year">All Time</option>
          </select>
          <button type="button" className="btn-export" onClick={() => window.print()}>
            Export / Print
          </button>
        </div>
      </header>

      {error && <div className="reports-alert error">{error}</div>}

      {loading ? (
        <p className="loading-state">Loading financial analytics…</p>
      ) : (
        <div className="reports-content">
          {/* TOP METRICS */}
          <div className="metrics-grid">
            <div className="metric-box box-sales">
              <span>Gross Sales</span>
              <strong>{money(summary.gross_sales)}</strong>
              <small>All registered orders</small>
            </div>
            <div className="metric-box box-paid">
              <span>Paid Revenue</span>
              <strong>{money(summary.paid_sales)}</strong>
              <small>Settled transactions</small>
            </div>
            <div className="metric-box box-orders">
              <span>Total Orders</span>
              <strong>{summary.total_orders || 0}</strong>
              <small>{summary.completed_orders || 0} completed · {summary.cancelled_orders || 0} cancelled</small>
            </div>
            <div className="metric-box box-pending">
              <span>Pending / Active</span>
              <strong>{summary.pending_orders || 0}</strong>
              <small>Open in kitchen/floor</small>
            </div>
          </div>

          <div className="reports-split-grid">
            {/* PAYMENT BREAKDOWN */}
            <div className="report-card">
              <h2>Settlement by Payment Method</h2>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Transactions</th>
                    <th>Amount Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan="3">No payment records found.</td></tr>
                  ) : (
                    payments.map((p) => (
                      <tr key={p.payment_method}>
                        <td><strong>{p.payment_method}</strong></td>
                        <td>{p.count}</td>
                        <td><b>{money(p.total)}</b></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* CATEGORY SALES */}
            <div className="report-card">
              <h2>Category Sales Volume</h2>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Units Sold</th>
                    <th>Gross Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.length === 0 ? (
                    <tr><td colSpan="3">No category data available.</td></tr>
                  ) : (
                    categories.map((c) => (
                      <tr key={c.category || 'Uncategorized'}>
                        <td><strong>{c.category || 'General'}</strong></td>
                        <td>{c.qty || 0} items</td>
                        <td><b>{money(c.total)}</b></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DAILY TIMELINE */}
          {dailySales.length > 0 && (
            <div className="report-card full-card">
              <h2>Recent Daily Sales Trend</h2>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Orders Fulfilled</th>
                    <th>Day's Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dailySales.map((d) => (
                    <tr key={d.order_date}>
                      <td><strong>{new Date(d.order_date).toLocaleDateString()}</strong></td>
                      <td>{d.orders_count} orders</td>
                      <td><b>{money(d.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

