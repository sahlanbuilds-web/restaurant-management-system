const net = require('net');
const fs = require('fs');

/**
 * ESC/POS Thermal Receipt Builder & Sender
 * Supports 80mm (approx 48 chars) and 58mm (approx 32 chars)
 */
class EscPosReceipt {
  constructor(paperWidth = '80mm') {
    this.paperWidth = paperWidth === '58mm' ? '58mm' : '80mm';
    this.maxChars = this.paperWidth === '58mm' ? 32 : 48;
    this.buffers = [];
    this.init();
  }

  init() {
    // ESC @ - Initialize printer
    this.buffers.push(Buffer.from([0x1B, 0x40]));
  }

  align(alignment = 'left') {
    // ESC a n (0: left, 1: center, 2: right)
    const n = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0;
    this.buffers.push(Buffer.from([0x1B, 0x61, n]));
  }

  bold(enabled = true) {
    // ESC E n
    this.buffers.push(Buffer.from([0x1B, 0x45, enabled ? 1 : 0]));
  }

  doubleSize(enabled = true) {
    // GS ! n (0x11: double width and height, 0x00: normal)
    this.buffers.push(Buffer.from([0x1D, 0x21, enabled ? 0x11 : 0x00]));
  }

  lineFeed(count = 1) {
    for (let i = 0; i < count; i++) {
      this.buffers.push(Buffer.from([0x0A]));
    }
  }

  text(str = '') {
    this.buffers.push(Buffer.from(str, 'ascii'));
  }

  textLine(str = '') {
    this.text(str);
    this.lineFeed(1);
  }

  divider(char = '-') {
    this.align('left');
    this.textLine(char.repeat(this.maxChars));
  }

  row(left, right) {
    this.align('left');
    const rightStr = String(right);
    const availableLeft = this.maxChars - rightStr.length - 1;
    let leftStr = String(left);
    if (leftStr.length > availableLeft) {
      leftStr = leftStr.slice(0, availableLeft);
    }
    const spaces = ' '.repeat(Math.max(1, this.maxChars - leftStr.length - rightStr.length));
    this.textLine(leftStr + spaces + rightStr);
  }

  cut() {
    this.lineFeed(3);
    // GS V 66 0 - Partial cut with feed
    this.buffers.push(Buffer.from([0x1D, 0x56, 0x42, 0x00]));
  }

  toBuffer() {
    return Buffer.concat(this.buffers);
  }
}

/**
 * Format Customer Bill to ESC/POS bytes
 */
function buildBillReceipt(orderData, settings, paperWidth = '80mm') {
  const receipt = new EscPosReceipt(paperWidth);

  // Header
  receipt.align('center');
  receipt.bold(true);
  receipt.doubleSize(true);
  receipt.textLine(settings.restaurant_name || 'Proxima Restaurant');
  receipt.doubleSize(false);

  if (settings.address) {
    receipt.bold(false);
    receipt.textLine(settings.address);
  }
  if (settings.phone) {
    receipt.textLine(`Tel: ${settings.phone}`);
  }
  if (settings.business_email) {
    receipt.textLine(`Email: ${settings.business_email}`);
  }

  receipt.divider('=');
  receipt.bold(true);
  receipt.textLine('TAX INVOICE / CUSTOMER BILL');
  receipt.bold(false);
  receipt.divider('-');

  // Meta details
  receipt.row('Invoice / Order:', orderData.order_code || `#${orderData.id}`);
  const orderDate = orderData.created_at ? new Date(orderData.created_at).toLocaleString() : new Date().toLocaleString();
  receipt.row('Date & Time:', orderDate);
  receipt.row('Order Type:', orderData.order_type || 'Dine in');
  if (orderData.table_number && orderData.table_number !== '—') {
    receipt.row('Table:', `Table ${orderData.table_number}`);
  }
  if (orderData.customer_name) {
    receipt.row('Customer:', orderData.customer_name);
  }
  if (orderData.steward_name) {
    receipt.row('Steward:', orderData.steward_name);
  }
  receipt.row('Cashier:', orderData.cashier_name || 'Cashier');

  receipt.divider('-');
  receipt.bold(true);
  receipt.row('ITEM', 'TOTAL');
  receipt.bold(false);
  receipt.divider('-');

  // Items
  const items = orderData.items || [];
  const currency = settings.currency || 'LKR';

  for (const item of items) {
    const qty = item.quantity || 1;
    const unitPrice = Number(item.unit_price || item.price || 0).toFixed(2);
    const subtotal = Number(item.subtotal || qty * unitPrice).toFixed(2);

    receipt.bold(true);
    receipt.textLine(item.item_name || item.name || 'Item');
    receipt.bold(false);
    receipt.row(`  ${qty} x ${currency} ${unitPrice}`, `${currency} ${subtotal}`);

    if (item.special_instruction) {
      receipt.textLine(`  * Note: ${item.special_instruction}`);
    }
  }

  receipt.divider('-');

  // Summary
  const grandTotal = Number(orderData.total_amount || 0).toFixed(2);
  receipt.row('Subtotal:', `${currency} ${grandTotal}`);

  receipt.divider('=');
  receipt.bold(true);
  receipt.doubleSize(true);
  receipt.row('TOTAL:', `${currency} ${grandTotal}`);
  receipt.doubleSize(false);
  receipt.divider('=');

  // Payments
  const payments = orderData.payments || [];
  if (payments.length > 0) {
    receipt.bold(true);
    receipt.textLine('Payment Information:');
    receipt.bold(false);
    for (const p of payments) {
      const pMethod = p.payment_method || 'Paid';
      const pAmount = Number(p.amount || 0).toFixed(2);
      receipt.row(`  ${pMethod}:`, `${currency} ${pAmount}`);
      if (p.received_amount && Number(p.received_amount) > 0) {
        receipt.row(`    Received:`, `${currency} ${Number(p.received_amount).toFixed(2)}`);
      }
      if (p.change_amount && Number(p.change_amount) > 0) {
        receipt.row(`    Change:`, `${currency} ${Number(p.change_amount).toFixed(2)}`);
      }
    }
    receipt.divider('-');
  } else if (orderData.payment_status) {
    receipt.row('Payment Status:', orderData.payment_status);
    if (orderData.payment_method) {
      receipt.row('Method:', orderData.payment_method);
    }
    receipt.divider('-');
  }

  // Footer
  receipt.align('center');
  if (settings.receipt_footer) {
    receipt.textLine(settings.receipt_footer);
  }
  receipt.textLine('Powered by Proxima Technologies POS');
  receipt.lineFeed(1);

  // Cut
  receipt.cut();

  return receipt.toBuffer();
}

/**
 * Format Test Print receipt
 */
function buildTestReceipt(printer, settings) {
  const receipt = new EscPosReceipt(printer.paper_width || '80mm');

  receipt.align('center');
  receipt.bold(true);
  receipt.doubleSize(true);
  receipt.textLine('TEST PRINT');
  receipt.doubleSize(false);
  receipt.textLine(settings.restaurant_name || 'Proxima Technologies');
  receipt.divider('=');

  receipt.align('left');
  receipt.row('Printer Location:', printer.location_key ? printer.location_key.toUpperCase() : 'UNKNOWN');
  receipt.row('Printer Name:', printer.printer_name);
  receipt.row('Connection Type:', printer.connection_type);
  receipt.row('Address / Port:', `${printer.printer_address}:${printer.printer_port}`);
  receipt.row('Paper Width:', printer.paper_width || '80mm');
  receipt.row('Test Time:', new Date().toLocaleString());

  receipt.divider('-');
  receipt.align('center');
  receipt.textLine('Printer communication verified successfully!');
  receipt.textLine('Hardware is ready for billing receipts.');

  receipt.cut();
  return receipt.toBuffer();
}

/**
 * Check Network Printer Online Status via TCP ping/connect
 */
function checkNetworkPrinterStatus(host, port = 9100, timeoutMs = 2000) {
  return new Promise((resolve) => {
    // If simulator or local dummy host
    if (host === '127.0.0.1' || host === 'localhost') {
      return resolve({ online: true, message: 'Local / Simulated Host (Ready)' });
    }

    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ online: true, message: 'Online and connected' });
      }
    });

    socket.on('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ online: false, message: 'Connection timed out' });
      }
    });

    socket.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ online: false, message: err.message || 'Connection failed' });
      }
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      if (!isResolved) {
        isResolved = true;
        resolve({ online: false, message: err.message });
      }
    }
  });
}

/**
 * Send Raw ESC/POS Buffer to Physical Network Printer
 */
function sendToNetworkPrinter(host, port, buffer, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    // Developer simulation mode check: if address is 127.0.0.1 or local simulated test, simulate physical thermal print
    if (host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host.startsWith('sim:')) {
      // Simulate delay and success
      setTimeout(() => {
        resolve({ success: true, simulated: true, message: 'Simulated physical print completed successfully.' });
      }, 500);
      return;
    }

    const socket = new net.Socket();
    let hasEnded = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      socket.write(buffer, (err) => {
        if (err) {
          if (!hasEnded) {
            hasEnded = true;
            socket.destroy();
            reject(new Error(`Failed to transmit data to printer: ${err.message}`));
          }
        } else {
          // Wait a short moment for buffer flush before closing socket
          setTimeout(() => {
            if (!hasEnded) {
              hasEnded = true;
              socket.end();
              resolve({ success: true, message: 'Receipt transmitted and printed successfully.' });
            }
          }, 300);
        }
      });
    });

    socket.on('timeout', () => {
      if (!hasEnded) {
        hasEnded = true;
        socket.destroy();
        reject(new Error(`Connection to printer ${host}:${port} timed out.`));
      }
    });

    socket.on('error', (err) => {
      if (!hasEnded) {
        hasEnded = true;
        socket.destroy();
        reject(new Error(`Printer communication error (${host}:${port}): ${err.message}`));
      }
    });
  });
}

/**
 * Unified Physical Print Dispatcher
 */
async function printToDevice(printer, buffer) {
  if (!printer.is_active) {
    throw new Error(`Printer "${printer.printer_name}" is currently disabled in settings.`);
  }

  if (printer.connection_type === 'Network') {
    const port = parseInt(printer.printer_port, 10) || 9100;
    return await sendToNetworkPrinter(printer.printer_address, port, buffer);
  }

  if (printer.connection_type === 'USB' || printer.connection_type === 'Windows') {
    // For USB direct raw ports or Windows spooler
    // Check if device path exists or simulated
    if (printer.printer_address === 'SIMULATOR' || printer.printer_address === '127.0.0.1') {
      return { success: true, simulated: true, message: 'Simulated USB thermal print successful.' };
    }
    // Attempt raw write if file/com port path
    if (fs.existsSync(printer.printer_address)) {
      try {
        fs.appendFileSync(printer.printer_address, buffer);
        return { success: true, message: `Data sent directly to USB device: ${printer.printer_address}` };
      } catch (err) {
        throw new Error(`Failed to write to USB printer device: ${err.message}`);
      }
    } else {
      // In development/testing environments without physical USB plugged in, return explicit notice
      return { success: true, simulated: true, message: `Hardware USB (${printer.printer_address}) processed in simulation.` };
    }
  }

  throw new Error(`Unsupported printer connection type: ${printer.connection_type}`);
}

module.exports = {
  EscPosReceipt,
  buildBillReceipt,
  buildTestReceipt,
  checkNetworkPrinterStatus,
  sendToNetworkPrinter,
  printToDevice
};

