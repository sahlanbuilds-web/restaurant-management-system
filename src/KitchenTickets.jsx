import { useEffect, useState } from 'react';
import './KitchenTickets.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;

async function request(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function KitchenTickets({ station }) {
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [delayTicket, setDelayTicket] = useState(null);
  const [delayReason, setDelayReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setError('');
    setLoading(true);
    try {
      setTickets(await request(`/kot?station=${encodeURIComponent(station)}`));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [station]);

  const visibleTickets = tickets.filter((ticket) => statusFilter === 'All' ||
    (statusFilter === 'Active' ? ['Pending', 'Preparing', 'Delayed'].includes(ticket.status) : ticket.status === statusFilter));

  async function updateTicket(ticket, status, reason) {
    const delay_reason = status === 'Delayed' ? String(reason || '').trim() : '';
    if (status === 'Delayed' && !delay_reason) {
      setError('Enter a reason before marking this ticket delayed.');
      return;
    }
    setError('');
    setMessage('');
    setUpdating(ticket.id);
    try {
      await request(`/kot/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, delay_reason })
      });
      setDelayTicket(null);
      setDelayReason('');
      setMessage(`${ticket.ticket_code} marked ${status.toLowerCase()}.`);
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className="kitchen-tickets">
      <header className="kitchen-tickets-heading">
        <div><h1>{station === 'Bar' ? 'Bar tickets' : 'Kitchen tickets'}</h1><p>Preparation queue · Items and instructions from the POS</p></div>
        <button type="button" onClick={load} disabled={loading}>Refresh tickets</button>
      </header>
      {error && <div className="kitchen-alert error" role="alert">{error}</div>}
      {message && <div className="kitchen-alert success" role="status">{message}</div>}
      <nav className="kitchen-ticket-filters" aria-label="Filter tickets">{['Active', 'Pending', 'Preparing', 'Ready', 'Delayed', 'All'].map((status) =>
        <button type="button" key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>
      )}</nav>
      {loading ? <p className="kitchen-empty">Loading tickets…</p> : visibleTickets.length === 0 ? <p className="kitchen-empty">No tickets in this view.</p> : (
        <div className="kitchen-ticket-grid">{visibleTickets.map((ticket) => (
          <article className={`kitchen-ticket status-${ticket.status.toLowerCase()}${printing === ticket.id ? ' printing' : ''}`} key={ticket.id}>
            <div className="kitchen-ticket-header"><div><h2>{ticket.ticket_code}</h2><strong>{ticket.table_number || ticket.order_code}</strong></div><span>{ticket.status}</span></div>
            <p className="kitchen-ticket-meta">Order {ticket.order_code} · {ticket.station} · {new Date(ticket.created_at).toLocaleString()}</p>
            <ul>{(ticket.items || []).map((item, index) => <li key={`${ticket.id}-${index}`}><strong>{item.quantity} × {item.item_name}</strong>{item.special_instruction && <span className="kitchen-instruction">Item request: {item.special_instruction}</span>}</li>)}</ul>
            {ticket.customer_note && <p className="kitchen-instruction"><strong>Order note:</strong> {ticket.customer_note}</p>}
            {ticket.status === 'Delayed' && ticket.delay_reason && <p className="kitchen-delay"><strong>Delayed:</strong> {ticket.delay_reason}</p>}
            <div className="kitchen-ticket-actions">
              <button type="button" onClick={() => {
                setPrinting(ticket.id);
                window.setTimeout(() => {
                  window.print();
                  setPrinting(null);
                }, 0);
              }}>Print ticket</button>
              {ticket.status === 'Pending' && <button type="button" onClick={() => updateTicket(ticket, 'Preparing')} disabled={updating === ticket.id}>Start preparing</button>}
              {['Pending', 'Preparing'].includes(ticket.status) && <button type="button" onClick={() => { setDelayTicket(ticket.id); setDelayReason(''); }} disabled={updating === ticket.id}>Report delay</button>}
              {ticket.status === 'Delayed' && <button type="button" onClick={() => updateTicket(ticket, 'Preparing')} disabled={updating === ticket.id}>Resume preparation</button>}
              {ticket.status === 'Preparing' && <button type="button" className="primary" onClick={() => updateTicket(ticket, 'Ready')} disabled={updating === ticket.id}>Mark ready</button>}
              {ticket.status === 'Ready' && <button type="button" className="primary" onClick={() => updateTicket(ticket, 'Served')} disabled={updating === ticket.id}>Mark served</button>}
              {updating === ticket.id && <span>Updating…</span>}
            </div>
            {delayTicket === ticket.id && <form className="kitchen-delay-form" onSubmit={(event) => { event.preventDefault(); updateTicket(ticket, 'Delayed', delayReason); }}>
              <label>Reason for delay<input required maxLength={500} value={delayReason} onChange={(event) => setDelayReason(event.target.value)} placeholder="e.g. Waiting for fresh ingredients" /></label>
              <button type="submit" disabled={updating === ticket.id}>Save reason</button>
              <button type="button" onClick={() => setDelayTicket(null)} disabled={updating === ticket.id}>Cancel</button>
            </form>}
          </article>
        ))}</div>
      )}
    </section>
  );
}
