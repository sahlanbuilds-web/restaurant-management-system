import { useContext, useEffect, useState } from 'react';
import { AuthContext } from './AuthGate.jsx';
import './RestaurantDashboard.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const money = (amount) => `LKR ${Number(amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function RestaurantDashboard({ navigate }) {
  const user = useContext(AuthContext);
  const [data, setData] = useState({ orders: [], tickets: [], menu: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const paths = user?.role === 'Kitchen' ? ['kot'] : ['orders', 'kot', 'menu'];
      const results = await Promise.all(paths.map(async (path) => {
        const response = await fetch(`${API}/${path}`, { credentials: 'include' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Could not load ${path}.`);
        return result;
      }));
      setData(user?.role === 'Kitchen'
        ? { orders: [], tickets: results[0], menu: [] }
        : { orders: results[0], tickets: results[1], menu: results[2] });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [user?.role]);

  const openOrders = data.orders.filter((order) => !['Completed', 'Cancelled'].includes(order.status));
  const pendingTickets = data.tickets.filter((ticket) => ['Pending', 'Preparing', 'Delayed'].includes(ticket.status));
  const readyOrders = data.orders.filter((order) => order.status === 'Ready');
  const lowStock = data.menu.filter((item) => Number(item.stock_quantity) <= Number(item.reorder_level ?? 5));
  const serviceTrend = [42, 58, 66, 76, 72, 88, 94];
  const popularItems = (data.menu || []).slice(0, 5);
  const totalSales = (data.orders || []).reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const completedCount = (data.orders || []).filter((order) => order.status === 'Completed').length;

  const summaryCards = user?.role === 'Kitchen'
    ? [
        { label: 'Active tickets', value: loading || error ? '—' : pendingTickets.length, hint: 'Open prep queue', action: () => navigate('Kitchen tickets') },
        { label: 'Ready for service', value: loading || error ? '—' : data.tickets.filter((ticket) => ticket.status === 'Ready').length, hint: 'Handled and waiting', action: () => navigate('Kitchen tickets') }
      ]
    : [
        { label: 'Open orders', value: loading || error ? '—' : openOrders.length, hint: 'Needing attention', action: () => navigate('Pending orders') },
        { label: 'Hot tickets', value: loading || error ? '—' : pendingTickets.length, hint: 'Kitchen and bar', action: () => navigate('Kitchen tickets') },
        { label: 'Active Tables', value: '18 / 24', hint: '75% Full', action: () => navigate('Pending orders') },
        { label: 'Pending Orders', value: '6', hint: 'Needs Attention', action: () => navigate('Pending orders') }
      ];

  return (
    <section className="restaurant-dashboard">
      <header className="restaurant-dashboard-topbar">
        <div>
          <p className="restaurant-dashboard-eyebrow">Proxima Technologies</p>
          <h1>Operations overview</h1>
        </div>
        <div className="dashboard-actions">
          <button type="button" className="dashboard-secondary" onClick={load} disabled={loading}>Refresh</button>
          {user?.role !== 'Kitchen' && (
            <button type="button" className="dashboard-primary" onClick={() => navigate('POS')}>New order</button>
          )}
        </div>
      </header>

      {error && <div className="restaurant-dashboard-alert" role="alert">{error}</div>}

      <div className="dashboard-summary-grid">
        {summaryCards.map((card, index) => (
          <article key={card.label} className="dashboard-summary-card" style={{ '--accent': index % 2 === 0 ? '#f08a36' : '#2a7f62' }}>
            <div className="summary-card-top">
              <span>{card.label}</span>
              <span className="summary-pill">Live</span>
            </div>
            <strong>{card.value}</strong>
            <small>{card.hint}</small>
            <button type="button" onClick={card.action}>{user?.role === 'Kitchen' ? 'Open queue' : 'View details'}</button>
          </article>
        ))}
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel dashboard-panel-large">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Performance</p>
              <h2>Service flow</h2>
            </div>
            <span className="panel-tag">Today</span>
          </div>

          <div className="sales-bars" aria-label="Service flow trend">
            {serviceTrend.map((value, index) => (
              <div key={index} className="sales-bar-wrap">
                <span className="sales-bar" style={{ height: `${value}%` }} />
              </div>
            ))}
          </div>

          <div className="panel-footer-metrics">
            <div>
              <span>Sales</span>
              <strong>{money(totalSales)}</strong>
            </div>
            <div>
              <span>Completed</span>
              <strong>{completedCount}</strong>
            </div>
            <div>
              <span>Avg order</span>
              <strong>{openOrders.length ? money(totalSales / openOrders.length) : money(0)}</strong>
            </div>
          </div>
        </section>

        <aside className="dashboard-panel dashboard-panel-side">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Menu</p>
              <h2>Top sellers</h2>
            </div>
            <button type="button" className="panel-link" onClick={() => navigate('Menu')}>View menu</button>
          </div>

          <ul className="top-items-list">
            {(popularItems.length ? popularItems : [{ item_name: 'House grill', stock_quantity: 12 }, { item_name: 'Fresh juice', stock_quantity: 9 }, { item_name: 'Mango curry', stock_quantity: 7 }]).map((item, index) => (
              <li key={`${item.item_name || 'item'}-${index}`}>
                <div className="item-rank">0{index + 1}</div>
                <div className="item-copy">
                  <strong>{item.item_name || item.name || 'Menu item'}</strong>
                  <span>{item.category_name || 'Popular dish'}</span>
                </div>
                <span className="item-stock">{Number(item.stock_quantity || 0)} left</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="dashboard-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Orders</p>
              <h2>{user?.role === 'Kitchen' ? 'Preparation queue' : 'Current orders'}</h2>
            </div>
            <button type="button" className="panel-link" onClick={() => navigate(user?.role === 'Kitchen' ? 'Kitchen tickets' : 'Pending orders')}>{user?.role === 'Kitchen' ? 'Open tickets' : 'All orders'}</button>
          </div>

          {loading ? (
            <p className="dashboard-empty">Loading…</p>
          ) : error ? (
            <p className="dashboard-empty">No live data available.</p>
          ) : (user?.role === 'Kitchen' ? pendingTickets : openOrders).length ? (
            <div className="order-list">
              {(user?.role === 'Kitchen' ? pendingTickets : openOrders).slice(0, 5).map((item) => (
                <article key={item.id || item.ticket_code || item.order_code} className="order-row">
                  <div>
                    <strong>{item.ticket_code || item.order_code}</strong>
                    <span>{item.station || item.table_number || item.order_type || 'Active'} · {item.customer_name || item.order_code || 'Guest'}</span>
                  </div>
                  <div className="order-meta">
                    <span className={`restaurant-status status-${String(item.status || 'Pending').toLowerCase()}`}>{item.status || 'Pending'}</span>
                    <b>{item.total_amount !== undefined ? money(item.total_amount) : `${item.items?.length || 0} items`}</b>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="dashboard-empty">No active items to show.</p>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Alerts</p>
              <h2>Operational notes</h2>
            </div>
          </div>

          <div className="alert-stack">
            {pendingTickets.some((ticket) => ticket.status === 'Delayed') ? (
              pendingTickets.filter((ticket) => ticket.status === 'Delayed').slice(0, 3).map((ticket) => (
                <div className="alert-item delayed" key={ticket.id}>
                  <strong>{ticket.ticket_code}</strong>
                  <span>{ticket.delay_reason || 'Delayed preparation'}</span>
                </div>
              ))
            ) : (
              <div className="alert-item neutral">
                <strong>Everything is on schedule</strong>
                <span>No preparation delays currently recorded.</span>
              </div>
            )}

            <div className="alert-item info">
              <strong>{lowStock.length} low-stock items</strong>
              <span>Review menu inventory before the next service rush.</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
