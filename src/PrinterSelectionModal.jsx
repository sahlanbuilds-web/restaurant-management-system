import { useState } from 'react';
import './PrinterSelectionModal.css';

export default function PrinterSelectionModal({
  isOpen,
  onClose,
  onConfirm,
  printers = [],
  loading = false,
  printing = false
}) {
  const [selectedId, setSelectedId] = useState(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!selectedId) return;
    const selectedPrinter = printers.find((p) => p.id === selectedId);
    onConfirm(selectedPrinter);
  };

  const getIcon = (key) => {
    switch (key) {
      case 'kitchen':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 10a4 4 0 1 1 2-7.5A4 4 0 0 1 15.5 4 3.5 3.5 0 1 1 18 10H6Z" />
            <path d="M7 10v9h10v-9M9 15h6" />
          </svg>
        );
      case 'bar':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 21h8" />
            <path d="M12 15v6" />
            <path d="m5 3 7 7 7-7Z" />
          </svg>
        );
      case 'cashier':
      default:
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="m8 9 3 3-3 3M14 15h3" />
          </svg>
        );
    }
  };

  return (
    <div className="printer-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="printer-modal-title">
      <div className="printer-modal-card">
        <div className="printer-modal-header">
          <div>
            <span className="printer-modal-badge">BILLING DESTINATION</span>
            <h2 id="printer-modal-title">SELECT BILL PRINTER LOCATION</h2>
            <p>Choose the target thermal printer for this customer receipt.</p>
          </div>
          <button type="button" className="printer-modal-close" onClick={onClose} disabled={printing} aria-label="Close dialog">
            &times;
          </button>
        </div>

        {loading ? (
          <div className="printer-modal-loading">
            <div className="spinner" />
            <p>Scanning printer destinations & status…</p>
          </div>
        ) : (
          <div className="printer-cards-grid">
            {printers.map((printer) => {
              const isSelected = selectedId === printer.id;
              const isActive = Boolean(printer.is_active);
              const isConnected = Boolean(printer.is_connected);

              return (
                <div
                  key={printer.id}
                  className={`printer-card ${isSelected ? 'selected' : ''} ${!isActive ? 'disabled' : ''}`}
                  onClick={() => {
                    if (isActive) setSelectedId(printer.id);
                  }}
                  tabIndex={isActive ? 0 : -1}
                  role="button"
                  aria-pressed={isSelected}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && isActive) {
                      e.preventDefault();
                      setSelectedId(printer.id);
                    }
                  }}
                >
                  <div className="printer-card-top">
                    <div className={`printer-icon-wrap ${printer.location_key}`}>
                      {getIcon(printer.location_key)}
                    </div>
                    <div className="printer-status-pills">
                      <span className={`status-pill ${isActive ? 'active' : 'inactive'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                      {isActive && (
                        <span className={`status-pill ${isConnected ? 'online' : 'offline'}`}>
                          {isConnected ? 'Connected' : 'Offline'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="printer-card-details">
                    <h3>{printer.printer_name}</h3>
                    <p className="printer-spec">
                      <strong>{printer.connection_type}</strong> · {printer.printer_address}
                      {printer.printer_port ? `:${printer.printer_port}` : ''}
                    </p>
                    <span className="paper-spec">{printer.paper_width || '80mm'} thermal paper</span>
                  </div>

                  <div className="printer-card-select-radio">
                    <input
                      type="radio"
                      name="printer_choice"
                      checked={isSelected}
                      disabled={!isActive}
                      onChange={() => setSelectedId(printer.id)}
                    />
                    <span>{isSelected ? 'Selected' : 'Select printer'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="printer-modal-actions">
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={onClose}
            disabled={printing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-modal-confirm"
            onClick={handleConfirm}
            disabled={!selectedId || printing || loading}
          >
            {printing ? 'Sending to printer…' : 'Confirm & Print'}
          </button>
        </div>
      </div>
    </div>
  );
}

