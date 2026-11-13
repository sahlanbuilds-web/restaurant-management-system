import { useEffect, useMemo, useRef, useState } from 'react';
import PrinterSelectionModal from './PrinterSelectionModal.jsx';
import './PosWorkspace.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const money = (value) => `LKR ${(Number(value) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (value) => Math.round((Number(value) || 0) * 100);

async function request(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

// ── Inline SVG icons (no external icon library) ──────────────────────────────
function IconSearch({ size = 18, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconBarcode({ size = 18, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
    </svg>
  );
}

function IconX({ size = 16, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconPlus({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default function PosWorkspace() {
  const [menu, setMenu] = useState([]);
  const [tables, setTables] = useState([]);
  const [stewards, setStewards] = useState([]);
  const [cart, setCart] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [tableId, setTableId] = useState('');
  const [orderType, setOrderType] = useState('Dine in');
  const [customerName, setCustomerName] = useState('');
  const [stewardId, setStewardId] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [received, setReceived] = useState('');
  const [savedOrder, setSavedOrder] = useState(null);
  const [remainingAmount, setRemainingAmount] = useState(null);
  const [changeDue, setChangeDue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [printersList, setPrintersList] = useState([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printingStatus, setPrintingStatus] = useState(false);

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(-1);

  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);
  const searchDebounceRef = useRef(null);
  // Barcode scanner detection: track last keystroke time
  const lastKeyTimeRef = useRef(0);
  const keyCountRef = useRef(0);

  const orderRequestKey = useRef(null);
  const addonRequestKey = useRef(null);
  const paymentRequestKey = useRef(null);

  // ── Load data ───────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    setError('');
    try {
      const [items, diningTables, activeStewards] = await Promise.all([
        request('/menu'),
        request('/tables'),
        request('/stewards')
      ]);
      setMenu(items.filter((item) => item.available));
      setTables(diningTables);
      setStewards(activeStewards.filter((steward) => Boolean(steward.active)));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── F2 global shortcut: focus search ───────────────────────────────────────
  useEffect(() => {
    function handleGlobalKey(e) {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // ── Close dropdown on outside click ────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Derived state ───────────────────────────────────────────────────────────
  const categories = useMemo(() => ['All', ...new Set(menu.map((item) => item.category))], [menu]);
  const visibleItems = useMemo(() => menu.filter((item) =>
    (category === 'All' || item.category === category) &&
    `${item.name} ${item.item_code || ''} ${item.category}`.toLowerCase().includes(search.toLowerCase())
  ), [menu, category, search]);
  const subtotalCents = cart.reduce((total, item) => total + cents(item.price) * item.quantity, 0);
  const total = savedOrder
    ? Number(savedOrder.total_amount) + (isAddingItems ? subtotalCents / 100 : 0)
    : subtotalCents / 100;

  // ── Cart actions ─────────────────────────────────────────────────────────────
  function addItem(item) {
    if (!item) return;
    if (savedOrder && !isAddingItems) {
      setMessage('This order has been sent. Start a new order to add more items.');
      return;
    }
    if (!item.available) {
      setError(`"${item.name}" is currently unavailable.`);
      return;
    }
    const price = item.pricing_type === 'Open' ? 0 : Number(item.price);
    setCart((current) => {
      const found = current.find((line) => line.id === item.id);
      if (found) return current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { id: item.id, name: item.name, code: item.item_code, price, quantity: 1, openPrice: item.pricing_type === 'Open', special_instruction: '' }];
    });
    setMessage('');
    setError('');
  }

  function updateLine(id, update) {
    setCart((current) => current.map((line) => line.id === id ? { ...line, ...update } : line));
  }

  function changeQuantity(id, delta) {
    setCart((current) => current.flatMap((line) => {
      if (line.id !== id) return [line];
      const quantity = line.quantity + delta;
      return quantity > 0 ? [{ ...line, quantity: Math.min(99, quantity) }] : [];
    }));
  }

  // ── Search logic ─────────────────────────────────────────────────────────────
  function performLocalSearch(q) {
    if (!q) return [];
    const qLow = q.toLowerCase().trim();
    // Sort: exact code/barcode first, then prefix, then contains
    return menu
      .map((item) => {
        const codeLow = (item.item_code || '').toLowerCase();
        const barcode = (item.barcode || '');
        const nameLow = item.name.toLowerCase();
        const catLow = item.category.toLowerCase();
        let rank = 99;
        if (codeLow === qLow || barcode === q.trim()) rank = 0;        // exact code / barcode
        else if (codeLow.startsWith(qLow)) rank = 1;                   // code prefix
        else if (nameLow === qLow) rank = 2;                            // exact name
        else if (nameLow.startsWith(qLow)) rank = 3;                   // name prefix
        else if (nameLow.includes(qLow)) rank = 4;                     // name contains
        else if (catLow.includes(qLow)) rank = 5;                      // category contains
        else return null;
        return { ...item, _rank: rank };
      })
      .filter(Boolean)
      .sort((a, b) => a._rank - b._rank)
      .slice(0, 20);
  }

  function handleSearchInput(value) {
    setSearchQuery(value);
    setSearch(value);          // also drives grid filter
    setSearchHighlight(-1);

    if (!value.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      clearTimeout(searchDebounceRef.current);
      return;
    }

    // Instant local results
    const local = performLocalSearch(value);
    setSearchResults(local);
    setSearchOpen(true);

    // Debounced API search (supplements local for large/stale menus)
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ q: value.trim(), limit: '20' });
        const apiResults = await request(`/menu/search?${params}`);
        // Merge: API results take priority, deduplicate by id
        const seen = new Set(apiResults.map((r) => r.id));
        const merged = [...apiResults, ...local.filter((r) => !seen.has(r.id))];
        setSearchResults(merged.slice(0, 20));
      } catch (_) {
        // Keep local results on API error
      } finally {
        setSearchLoading(false);
      }
    }, 280);
  }

  function clearSearch() {
    setSearchQuery('');
    setSearch('');
    setSearchResults([]);
    setSearchOpen(false);
    setSearchHighlight(-1);
    clearTimeout(searchDebounceRef.current);
    searchInputRef.current?.focus();
  }

  // Barcode scanner: USB HID scanners type characters very fast then send Enter.
  // We track inter-keystroke timing on the search input.
  function handleSearchKeyPress() {
    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;
    // If keys are arriving < 50ms apart, increment scan counter
    if (gap < 50) {
      keyCountRef.current += 1;
    } else {
      keyCountRef.current = 1;
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchHighlight(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchHighlight((h) => Math.min(h + 1, searchResults.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchHighlight((h) => Math.max(h - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchQuery.trim();
      if (!q) return;

      // Determine if this is a barcode scanner Enter
      // Scanner fires many chars in <300ms then Enter
      const isScannerEnter = keyCountRef.current >= 4;
      keyCountRef.current = 0;

      // 1. If a result is highlighted, add it
      if (searchHighlight >= 0 && searchResults[searchHighlight]) {
        addItem(searchResults[searchHighlight]);
        clearSearch();
        return;
      }

      // 2. Exact barcode match (scanner)
      if (isScannerEnter) {
        const barcodeMatch = menu.find((m) => m.barcode === q);
        if (barcodeMatch) {
          addItem(barcodeMatch);
          setMessage(`Scanned: ${barcodeMatch.name} added.`);
          clearSearch();
          return;
        }
      }

      // 3. Exact item code match
      const codeMatch = menu.find((m) => m.item_code?.toLowerCase() === q.toLowerCase());
      if (codeMatch) {
        addItem(codeMatch);
        clearSearch();
        return;
      }

      // 4. Single result → add it
      if (searchResults.length === 1) {
        addItem(searchResults[0]);
        clearSearch();
        return;
      }

      // 5. No single match — keep dropdown open so user can pick
      if (!searchOpen && searchResults.length > 0) setSearchOpen(true);
    }
  }

  function handleResultClick(item) {
    addItem(item);
    clearSearch();
  }

  // ── Order actions ────────────────────────────────────────────────────────────
  async function sendToKitchen() {
    setError('');
    setMessage('');
    if (!cart.length) return setError('Add at least one item before sending the order.');
    if (!savedOrder && orderType === 'Dine in' && !tableId) return setError('Select a table for a dine-in order.');
    const invalid = cart.find((line) => !Number.isFinite(Number(line.price)) || Number(line.price) < 0 ||
      (Number(line.price) === 0 && !menu.find((item) => item.id === line.id)?.is_free) ||
      !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99);
    if (invalid) return setError(`Enter a valid price and quantity for ${invalid.name}.`);
    setSaving(true);
    try {
      const addingItems = Boolean(savedOrder && isAddingItems);
      const lines = cart.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        price: Number(line.price),
        special_instruction: line.special_instruction
      }));
      const result = await request(addingItems ? `/orders/${savedOrder.orderId}/items` : '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addingItems
          ? {
            idempotency_key: addonRequestKey.current || (addonRequestKey.current = crypto.randomUUID()),
            items: lines
          }
          : {
            order_type: orderType,
            table_number: tables.find((table) => String(table.id) === tableId)?.table_number || '—',
            customer_name: customerName || 'Guest',
            customer_note: orderNote,
            steward_id: stewardId || null,
            created_by: 'Staff',
            idempotency_key: orderRequestKey.current || (orderRequestKey.current = crypto.randomUUID()),
            items: lines
          })
      });
      if (addingItems) {
        setOrderItems((current) => [...current, ...cart]);
        setSavedOrder((current) => ({ ...current, total_amount: result.total_amount }));
        setRemainingAmount(result.remaining);
        setChangeDue(null);
        setPaymentMethod('');
        setPaymentAmount(result.remaining > 0 ? String(result.remaining) : '');
        setCart([]);
        setIsAddingItems(false);
        addonRequestKey.current = null;
      } else {
        setSavedOrder(result);
        setOrderItems(cart);
      }
      if (!addingItems && Number(result.total_amount) === 0) {
        setRemainingAmount(0);
        setChangeDue(0);
      }
      setMessage(addingItems
        ? `Items added to ${result.order_code}${result.kot_codes?.length ? ` · ${result.kot_codes.join(', ')}` : ''}.`
        : `Order ${result.order_code} sent to preparation${result.kot_codes?.length ? ` · ${result.kot_codes.join(', ')}` : ''}.`);
      paymentRequestKey.current = null;
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function completePayment() {
    setError('');
    setMessage('');
    if (!savedOrder) return setError('Send the order before taking payment.');
    if (!paymentMethod) return setError('Select a payment method. Credit is never selected automatically.');
    if (paymentMethod === 'Credit' && !customerName.trim()) return setError('Enter the customer name before recording a credit payment.');
    const amount = Math.round((Number(paymentAmount || total) + Number.EPSILON) * 100) / 100;
    const outstanding = remainingAmount ?? total;
    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) return setError('Enter a payment amount within the outstanding balance.');
    const receivedAmount = paymentMethod === 'Cash' ? Number(received) : amount;
    if (!Number.isFinite(receivedAmount) || receivedAmount < amount) return setError('Amount received must cover this payment.');
    setSaving(true);
    try {
      const result = await request(`/orders/${savedOrder.orderId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: paymentMethod,
          amount,
          received_amount: receivedAmount,
          idempotency_key: paymentRequestKey.current || (paymentRequestKey.current = crypto.randomUUID())
        })
      });
      paymentRequestKey.current = null;
      setRemainingAmount(result.remaining);
      setChangeDue(result.remaining === 0 ? result.change : null);
      setPaymentAmount(result.remaining > 0 ? String(result.remaining) : '');
      setReceived('');
      setMessage(result.remaining > 0
        ? `Payment recorded. ${money(result.remaining)} remains outstanding.`
        : `Payment complete for ${savedOrder.order_code}.`);
    } catch (paymentError) {
      setError(paymentError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openPrinterSelection() {
    if (!savedOrder) return;
    setError('');
    setMessage('');
    setPrinterModalOpen(true);
    setPrintersLoading(true);
    try {
      const printers = await request('/printers');
      setPrintersList(printers);
    } catch (loadErr) {
      setError(`Failed to scan printers: ${loadErr.message}`);
    } finally {
      setPrintersLoading(false);
    }
  }

  async function handleConfirmPrint(selectedPrinter) {
    if (!savedOrder || !selectedPrinter) return;
    setPrintingStatus(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        order_id: savedOrder.id,
        printer_id: selectedPrinter.id,
        idempotency_key: `print-${savedOrder.id}-${selectedPrinter.id}-${Date.now()}`
      };
      const result = await request('/billing/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setPrinterModalOpen(false);
      const notice = result.simulated
        ? ` (Simulation Mode: ${selectedPrinter.printer_name} verified)`
        : '';
      setMessage(`Bill sent to ${selectedPrinter.printer_name} successfully!${notice}`);
    } catch (printErr) {
      setError(`Print failed: ${printErr.message}`);
    } finally {
      setPrintingStatus(false);
    }
  }

  function printReceipt() { openPrinterSelection(); }

  function startNewOrder() {
    setSavedOrder(null);
    setCart([]);
    setOrderItems([]);
    setIsAddingItems(false);
    setOrderType('Dine in');
    setTableId('');
    setCustomerName('');
    setStewardId('');
    setOrderNote('');
    setPaymentMethod('');
    setPaymentAmount('');
    setReceived('');
    setRemainingAmount(null);
    setChangeDue(null);
    setMessage('');
    setError('');
    clearSearch();
    orderRequestKey.current = null;
    addonRequestKey.current = null;
    paymentRequestKey.current = null;
    load();
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className="pos-workspace">
      <header className="pos-page-heading">
        <div><h1>Point of sale</h1><p>Select a table, add items, then send the order to preparation.</p></div>
        <button type="button" className="pos-refresh" onClick={load} disabled={loading}>Refresh menu</button>
      </header>

      {error && <div className="pos-alert pos-alert-error" role="alert">{error}</div>}
      {message && <div className="pos-alert pos-alert-success" role="status">{message}</div>}

      <div className="pos-layout">
        <div className="pos-menu">

          {/* ── Unified item search bar ─────────────────────────────────── */}
          <div className="pos-search-bar">
            <div className="pos-search-wrapper" ref={searchWrapperRef}>
              <IconSearch className="pos-search-icon" size={18} />
              <input
                ref={searchInputRef}
                id="pos-item-search"
                type="text"
                className="pos-search-input"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onKeyPress={handleSearchKeyPress}
                onFocus={() => { if (searchQuery && searchResults.length) setSearchOpen(true); }}
                placeholder="Search item name or enter item code..."
                autoComplete="off"
                spellCheck={false}
                aria-label="Item search"
                aria-expanded={searchOpen}
                aria-haspopup="listbox"
                aria-autocomplete="list"
                role="combobox"
              />
              <div className="pos-search-actions-right">
                {searchQuery && (
                  <button
                    type="button"
                    className="pos-search-clear"
                    onClick={clearSearch}
                    aria-label="Clear search"
                  >
                    <IconX size={15} />
                  </button>
                )}
                <span className="pos-search-barcode-hint" title="Barcode scanner supported">
                  <IconBarcode size={18} />
                </span>
              </div>

              {/* Search results dropdown */}
              {searchOpen && (searchResults.length > 0 || (searchQuery && !searchLoading)) && (
                <div className="pos-search-results" role="listbox" aria-label="Search results">
                  {searchLoading && (
                    <div className="pos-search-loading">
                      <span className="pos-search-spinner" />Searching…
                    </div>
                  )}
                  {searchResults.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      className={[
                        'pos-search-result-item',
                        idx === searchHighlight ? 'highlighted' : '',
                        !item.available ? 'unavailable' : ''
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleResultClick(item)}
                      role="option"
                      aria-selected={idx === searchHighlight}
                      disabled={!item.available}
                    >
                      {item.image
                        ? <img src={item.image} alt="" loading="lazy" className="pos-result-thumb" />
                        : <div className="pos-result-thumb pos-result-thumb-placeholder">
                            <span>{item.name[0]}</span>
                          </div>
                      }
                      <div className="pos-result-info">
                        <strong className="pos-result-name">{item.name}</strong>
                        <span className="pos-result-meta">
                          {item.item_code && (
                            <span className="pos-result-code">{item.item_code}</span>
                          )}
                          <span className="pos-result-category">{item.category}</span>
                        </span>
                      </div>
                      <div className="pos-result-right">
                        <b className="pos-result-price">
                          {item.pricing_type === 'Open' ? 'Open price' : money(item.price)}
                        </b>
                        <span className={item.available ? 'pos-avail-yes' : 'pos-avail-no'}>
                          {item.available ? '● Available' : '● Unavailable'}
                        </span>
                      </div>
                      {item.available && (
                        <span className="pos-result-add" aria-hidden="true">
                          <IconPlus size={13} /> Add
                        </span>
                      )}
                    </button>
                  ))}
                  {!searchLoading && searchResults.length === 0 && searchQuery && (
                    <p className="pos-search-no-results">
                      No items match <em>"{searchQuery}"</em>.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Category nav ───────────────────────────────────────────── */}
          <nav className="pos-categories" aria-label="Menu categories">
            {categories.map((entry) => (
              <button
                type="button"
                key={entry}
                className={entry === category ? 'active' : ''}
                onClick={() => setCategory(entry)}
              >
                {entry}
              </button>
            ))}
          </nav>

          {/* ── Item grid ──────────────────────────────────────────────── */}
          {loading
            ? <p className="pos-empty">Loading menu and tables…</p>
            : !visibleItems.length
              ? <p className="pos-empty">No available menu items match this search.</p>
              : (
                <div className="pos-item-grid">
                  {visibleItems.map((item) => (
                    <button type="button" className="pos-item-card" key={item.id} onClick={() => addItem(item)}>
                      {item.image
                        ? <img src={item.image} alt="" loading="lazy" />
                        : <div className="pos-image-placeholder">Menu item</div>
                      }
                      <span className="pos-item-info">
                        <strong>{item.name}</strong>
                        <small>
                          {item.category}
                          {item.item_code ? ` · ${item.item_code}` : ''}
                        </small>
                        <b>{item.pricing_type === 'Open' ? 'Open price' : money(item.price)}</b>
                      </span>
                    </button>
                  ))}
                </div>
              )
          }
        </div>

        {/* ── Order card ─────────────────────────────────────────────────── */}
        <aside className="pos-order-card">
          <div className="pos-order-heading">
            <div>
              <h2>{savedOrder ? `Order ${savedOrder.order_code}` : 'Current order'}</h2>
              <p>{isAddingItems ? 'Adding items to this order' : savedOrder ? 'Sent to preparation' : 'New order'}</p>
            </div>
            {savedOrder && !isAddingItems && (
              <button type="button" className="pos-link-button" onClick={() => {
                setCart([]);
                setIsAddingItems(true);
                setError('');
                setMessage('');
              }}>Add items</button>
            )}
            {savedOrder && (
              <button type="button" className="pos-link-button" onClick={printReceipt}>Print receipt</button>
            )}
          </div>

          {(!savedOrder || isAddingItems) && <>
            {!savedOrder && (
              <div className="pos-order-details">
                <label>Order type<select value={orderType} onChange={(e) => setOrderType(e.target.value)}><option>Dine in</option><option>Takeaway</option><option>Delivery</option></select></label>
                {orderType === 'Dine in' && (
                  <label>Table<select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                    <option value="">Select a table</option>
                    {tables.map((table) => <option key={table.id} value={table.id} disabled={table.status !== 'Available'}>{table.table_number} · {table.status}</option>)}
                  </select></label>
                )}
                <label>Customer name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Guest" /></label>
                <label>Steward<select value={stewardId} onChange={(e) => setStewardId(e.target.value)}>
                  <option value="">Not assigned</option>
                  {stewards.map((steward) => <option key={steward.id} value={steward.id}>{steward.name}</option>)}
                </select></label>
              </div>
            )}

            <div className="pos-cart-lines">
              {!cart.length
                ? <p className="pos-empty">{isAddingItems ? 'Choose one or more additional items.' : 'Choose a menu item to start this order.'}</p>
                : cart.map((line) => (
                  <div className="pos-cart-line" key={line.id}>
                    <div className="pos-line-top">
                      <div><strong>{line.name}</strong><small>{money(line.price)} each</small></div>
                      <b>{money(line.price * line.quantity)}</b>
                    </div>
                    {line.openPrice && (
                      <label className="pos-instruction">Open price<input type="number" min="0" step="0.01" value={line.price} onChange={(e) => updateLine(line.id, { price: e.target.value })} /></label>
                    )}
                    <label className="pos-instruction">Item request<input value={line.special_instruction} onChange={(e) => updateLine(line.id, { special_instruction: e.target.value })} placeholder="No sugar, extra crispy..." maxLength={500} /></label>
                    <div className="pos-line-controls">
                      <button type="button" aria-label={`Remove one ${line.name}`} onClick={() => changeQuantity(line.id, -1)}>−</button>
                      <span>{line.quantity}</span>
                      <button type="button" aria-label={`Add one ${line.name}`} onClick={() => changeQuantity(line.id, 1)}>+</button>
                      <button type="button" className="pos-remove" onClick={() => setCart((items) => items.filter((item) => item.id !== line.id))}>Remove</button>
                    </div>
                  </div>
                ))
              }
            </div>

            {!savedOrder && (
              <label className="pos-order-note">Order note<textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} maxLength={1000} placeholder="General instructions for the whole order" rows={2} /></label>
            )}
          </>}

          {savedOrder && !isAddingItems && (
            <div className="pos-cart-lines pos-receipt-lines">
              <h3>Items</h3>
              {orderItems.map((line, index) => (
                <div className="pos-receipt-line" key={`${line.id}-${index}`}>
                  <span>{line.quantity} × {line.name}{line.special_instruction && <small>Request: {line.special_instruction}</small>}</span>
                  <strong>{money(Number(line.price) * line.quantity)}</strong>
                </div>
              ))}
              <p>Customer: {customerName.trim() || 'Guest'}{orderType === 'Dine in' ? ` · ${tables.find((table) => String(table.id) === tableId)?.table_number || ''}` : ` · ${orderType}`}</p>
              <p>Payment: {remainingAmount === 0 ? paymentMethod : 'Unpaid / partially paid'} · {new Date().toLocaleString()}</p>
              {orderNote && <p><strong>Order note:</strong> {orderNote}</p>}
            </div>
          )}

          <div className="pos-total-row"><span>Subtotal</span><strong>{money(total)}</strong></div>
          <div className="pos-total-row pos-grand-total"><span>Total</span><strong>{money(total)}</strong></div>

          {!savedOrder ? (
            <button type="button" className="pos-primary-action" onClick={sendToKitchen} disabled={saving || loading || cart.length === 0}>
              {saving ? 'Sending order…' : 'Send to kitchen'}
            </button>
          ) : isAddingItems ? (
            <div className="pos-payment">
              <button type="button" className="pos-primary-action" onClick={sendToKitchen} disabled={saving || loading || cart.length === 0}>{saving ? 'Sending items…' : 'Send added items'}</button>
              <button type="button" className="pos-link-button" onClick={() => { setCart([]); setIsAddingItems(false); setError(''); setMessage(''); }} disabled={saving}>Cancel</button>
            </div>
          ) : total === 0 ? (
            <div className="pos-payment">
              <p className="pos-credit-note">Complimentary order · No payment due</p>
              <button type="button" className="pos-primary-action" onClick={printReceipt}>Print receipt</button>
              <button type="button" className="pos-link-button" onClick={startNewOrder}>Start new order</button>
            </div>
          ) : remainingAmount === 0 ? (
            <div className="pos-payment">
              <p className="pos-change">Payment complete · {paymentMethod}</p>
              <button type="button" className="pos-primary-action" onClick={printReceipt}>Print receipt</button>
              <button type="button" className="pos-link-button" onClick={startNewOrder}>Start new order</button>
            </div>
          ) : (
            <div className="pos-payment">
              <h3>Complete payment</h3>
              <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="">Select payment method</option>
                <option>Cash</option><option>Card</option><option>Online</option><option>Credit</option><option>Other</option>
              </select></label>
              {paymentMethod === 'Credit' && <p className="pos-credit-note">Credit selected. Confirm the customer's credit arrangement before completing this payment.</p>}
              <label>Amount to pay<input type="number" min="0.01" max={remainingAmount ?? total} step="0.01" value={paymentAmount || (remainingAmount ?? total)} onChange={(e) => setPaymentAmount(e.target.value)} /></label>
              {paymentMethod === 'Cash' && <label>Amount received<input type="number" min={Number(paymentAmount || remainingAmount || total)} step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} /></label>}
              {changeDue !== null && <p className="pos-change">Change due: <strong>{money(changeDue)}</strong></p>}
              <button type="button" className="pos-primary-action" onClick={completePayment} disabled={saving}>{saving ? 'Recording payment…' : 'Complete payment'}</button>
              {changeDue !== null && <button type="button" className="pos-link-button" onClick={startNewOrder}>Start new order</button>}
            </div>
          )}
        </aside>
      </div>

      <PrinterSelectionModal
        isOpen={printerModalOpen}
        onClose={() => setPrinterModalOpen(false)}
        onConfirm={handleConfirmPrint}
        printers={printersList}
        loading={printersLoading}
        printing={printingStatus}
      />
    </section>
  );
}
