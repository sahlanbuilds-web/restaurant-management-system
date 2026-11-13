import { useEffect, useMemo, useState } from 'react';
import './AdminMenu.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const emptyItem = {
  item_code: '', barcode: '', name: '', description: '', category: '', price: '', cost: '0',
  stock_quantity: '0', reorder_level: '5', pricing_type: 'Fixed', department: 'Kitchen',
  is_free: false, sends_to_kot: true, image: '', available: true
};

async function request(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function AdminMenu() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stewards, setStewards] = useState([]);
  const [stewardName, setStewardName] = useState('');
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [menu, categoryRows, stewardRows] = await Promise.all([request('/menu'), request('/categories'), request('/stewards')]);
      setItems(menu);
      setCategories(categoryRows.map((category) => category.name));
      setStewards(stewardRows);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((item) =>
    `${item.name} ${item.item_code || ''} ${item.barcode || ''} ${item.category}`.toLowerCase().includes(search.toLowerCase())
  ), [items, search]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function generateCode() {
    setError('');
    try {
      const cat = form?.category || '';
      const result = await request(`/menu/generate-code?category=${encodeURIComponent(cat)}`);
      if (result.code) {
        setField('item_code', result.code);
      }
    } catch (err) {
      setError(`Could not generate code: ${err.message}`);
    }
  }

  async function saveItem(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const payload = {
      ...form,
      item_code: (form.item_code || '').trim(),
      barcode: (form.barcode || '').trim() || null,
      price: Number(form.price),
      cost: Number(form.cost),
      stock_quantity: Number(form.stock_quantity),
      reorder_level: Number(form.reorder_level)
    };
    if (!payload.item_code || !/^[A-Za-z0-9_-]{2,50}$/.test(payload.item_code) || !payload.name.trim() || !payload.category.trim() ||
        !Number.isFinite(payload.price) || payload.price < 0 ||
        (!payload.is_free && payload.price === 0 && payload.pricing_type !== 'Open') ||
        !Number.isFinite(payload.cost) || payload.cost < 0 ||
        !Number.isFinite(payload.stock_quantity) || payload.stock_quantity < 0 ||
        !Number.isFinite(payload.reorder_level) || payload.reorder_level < 0) {
      setError('Enter a valid item code (2-50 letters/digits/_/-), name, category, and non-negative price, cost, stock, and low-stock level.');
      return;
    }
    if (payload.barcode && !/^[A-Za-z0-9_-]{3,100}$/.test(payload.barcode)) {
      setError('Barcode must be 3-100 letters, numbers, hyphens, or underscores.');
      return;
    }
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      await request(editing ? `/menu/${form.id}` : '/menu', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setForm(null);
      setMessage(editing ? 'Menu item updated.' : 'Menu item added.');
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item) {
    if (!window.confirm(`Remove ${item.name} from the menu?`)) return;
    setError('');
    setMessage('');
    try {
      await request(`/menu/${item.id}`, { method: 'DELETE' });
      setMessage(`${item.name} removed.`);
      await load();
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  async function addSteward(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await request('/stewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stewardName })
      });
      setStewardName('');
      setMessage('Steward added.');
      await load();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function updateSteward(steward, changes) {
    setError('');
    setMessage('');
    try {
      await request(`/stewards/${steward.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: changes.name ?? steward.name, active: changes.active ?? Boolean(steward.active) })
      });
      setMessage('Steward updated.');
      await load();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <section className="admin-menu">
      <header className="admin-menu-heading">
        <div><h1>Menu management</h1><p>Add, update, and remove items from one place.</p></div>
        <button type="button" className="admin-menu-primary" onClick={() => { setError(''); setForm({ ...emptyItem }); }}>Add menu item</button>
      </header>
      {error && <div className="admin-menu-alert error" role="alert">{error}</div>}
      {message && <div className="admin-menu-alert success" role="status">{message}</div>}
      <div className="admin-menu-toolbar"><label>Search menu<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item name, code, or category" /></label></div>
      {loading ? <p className="admin-menu-empty">Loading menu items…</p> : filtered.length === 0 ? <p className="admin-menu-empty">No menu items found.</p> : (
        <div className="admin-menu-list">
          {filtered.map((item) => (
            <article className="admin-menu-row" key={item.id}>
              {item.image ? <img src={item.image} alt="" loading="lazy" /> : <div className="admin-menu-photo-placeholder">No photo</div>}
              <div className="admin-menu-item-info">
                <strong>{item.name}</strong>
                <div className="admin-menu-codes">
                  <span className="code-badge">Code: <b>{item.item_code || 'None'}</b></span>
                  {item.barcode && <span className="barcode-badge">Barcode: <b>{item.barcode}</b></span>}
                  <span>{item.category} · {item.department || 'Kitchen'}</span>
                </div>
                <span>{item.available ? 'Available' : 'Unavailable'} · {item.pricing_type || 'Fixed'} price · Stock {Number(item.stock_quantity || 0)}{Number(item.stock_quantity) <= Number(item.reorder_level) ? ' · Low stock' : ''}</span>
              </div>
              <strong className="admin-menu-price">{Number(item.price) === 0 && item.is_free ? 'Free' : `LKR ${Number(item.price).toFixed(2)}`}</strong>
              <div className="admin-menu-actions">
                <button type="button" onClick={() => {
                  setError('');
                  setForm({ ...emptyItem, ...item, barcode: item.barcode || '', price: String(item.price), cost: String(item.cost || 0), stock_quantity: String(item.stock_quantity || 0), reorder_level: String(item.reorder_level ?? 5) });
                }}>Edit</button>
                <button type="button" className="danger" onClick={() => removeItem(item)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="admin-stewards">
        <div><h2>Stewards</h2><p>Manage the team members available for table assignments.</p></div>
        <form onSubmit={addSteward}><label htmlFor="admin-steward-name">Steward name</label><input id="admin-steward-name" required maxLength={100} value={stewardName} onChange={(event) => setStewardName(event.target.value)} placeholder="Enter a name" /><button className="admin-menu-primary" type="submit">Add steward</button></form>
        {stewards.length === 0 ? <p className="admin-menu-empty">No stewards added yet.</p> : <div className="admin-steward-list">{stewards.map((steward) => <div key={steward.id}><span><strong>{steward.name}</strong><small>{steward.active ? 'Active' : 'Inactive'}</small></span><button type="button" onClick={() => {
          const name = window.prompt('Steward name', steward.name);
          if (name?.trim()) updateSteward(steward, { name: name.trim() });
        }}>Edit</button><button type="button" onClick={() => updateSteward(steward, { active: !Boolean(steward.active) })}>{steward.active ? 'Deactivate' : 'Activate'}</button></div>)}</div>}
      </section>
      {form && <div className="admin-menu-backdrop" onMouseDown={() => !saving && setForm(null)}>
        <form className="admin-menu-dialog" onSubmit={saveItem} onMouseDown={(event) => event.stopPropagation()}>
          <div className="admin-menu-dialog-heading"><h2>{form.id ? 'Edit menu item' : 'Add menu item'}</h2><button type="button" onClick={() => setForm(null)} aria-label="Close">×</button></div>
          <div className="admin-menu-fields">
            <label>
              Item code
              <div className="input-with-button">
                <input required maxLength={50} pattern="[A-Za-z0-9_-]{2,50}" value={form.item_code} onChange={(event) => setField('item_code', event.target.value.toUpperCase())} placeholder="e.g. FD001 or BURGER-01" />
                <button type="button" className="admin-btn-secondary" onClick={generateCode} title="Auto-generate next unique code">Generate</button>
              </div>
            </label>
            <label>
              Barcode / Scanner ID (optional)
              <input maxLength={100} pattern="[A-Za-z0-9_-]{3,100}" value={form.barcode || ''} onChange={(event) => setField('barcode', event.target.value)} placeholder="e.g. 4791234567890 (or scan)" />
            </label>
            <label>Item name<input required maxLength={150} value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label>Category<input required list="admin-menu-categories" maxLength={100} value={form.category} onChange={(event) => setField('category', event.target.value)} placeholder="Food, Bakery, Beverages…" /><datalist id="admin-menu-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
            <label>Price type<select value={form.pricing_type} onChange={(event) => setField('pricing_type', event.target.value)}><option>Fixed</option><option>Open</option></select></label>
            <label>Selling price<input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setField('price', event.target.value)} /></label>
            <label>Cost price<input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setField('cost', event.target.value)} /></label>
            <label>Stock quantity<input type="number" min="0" step="0.01" value={form.stock_quantity} onChange={(event) => setField('stock_quantity', event.target.value)} /></label>
            <label>Low-stock warning at<input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(event) => setField('reorder_level', event.target.value)} /></label>
            <label>Preparation route<select value={form.department} onChange={(event) => setField('department', event.target.value)}><option>Kitchen</option><option>Bar</option><option>None</option></select></label>
            <label className="admin-menu-wide">Photo URL (optional)<input type="url" value={form.image || ''} onChange={(event) => setField('image', event.target.value)} placeholder="https://…" /></label>
            <label className="admin-menu-wide">Description<textarea rows={2} maxLength={2000} value={form.description || ''} onChange={(event) => setField('description', event.target.value)} /></label>
          </div>
          <div className="admin-menu-options">
            <label><input type="checkbox" checked={Boolean(form.available)} onChange={(event) => setField('available', event.target.checked)} /> Available for sale</label>
            <label><input type="checkbox" checked={Boolean(form.is_free)} onChange={(event) => setField('is_free', event.target.checked)} /> Free / complimentary item</label>
            <label><input type="checkbox" checked={Boolean(form.sends_to_kot)} onChange={(event) => setField('sends_to_kot', event.target.checked)} /> Send to kitchen / bar ticket</label>
          </div>
          {error && <div className="admin-menu-alert error" role="alert">{error}</div>}
          <div className="admin-menu-dialog-actions"><button type="button" onClick={() => setForm(null)} disabled={saving}>Cancel</button><button type="submit" className="admin-menu-primary" disabled={saving}>{saving ? 'Saving…' : 'Save item'}</button></div>
        </form>
      </div>}
    </section>
  );
}
