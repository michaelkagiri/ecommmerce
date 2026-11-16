import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmt, toCents } from './api.js';
import { enqueueSale, failedSales, loadCatalog, nextReceiptNo, pendingCount, refreshCatalog, syncQueue } from './offline.js';

const useOnline = () => {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u); window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
};

export default function Cashier({ onNeedLogin }) {
  const online = useOnline();
  const [till, setTill] = useState(localStorage.getItem('till') || '');
  const [catalog, setCatalog] = useState({ items: [], at: null });
  const [cart, setCart] = useState([]);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [syncState, setSyncState] = useState('ok');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [mpesa, setMpesa] = useState(null); // {id, status}
  const [receipt, setReceipt] = useState(null);
  const scanRef = useRef(null);

  const byCode = useMemo(() => new Map(catalog.items.map((p) => [p.barcode, p])), [catalog]);
  const total = cart.reduce((a, l) => a + l.priceCents * l.qty, 0);

  const refreshCounts = useCallback(async () => { setPending(await pendingCount()); setFailed((await failedSales()).length); }, []);
  const sync = useCallback(async () => {
    const r = await syncQueue();
    if (r !== 'busy') setSyncState(r);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    loadCatalog().then((c) => c && setCatalog(c));
    refreshCounts();
  }, [refreshCounts]);

  // Pull a fresh catalog when online; keep the cached one if the request fails.
  useEffect(() => {
    if (!online) return;
    const pull = () => refreshCatalog().then(setCatalog).catch(() => {});
    pull(); sync();
    const t1 = setInterval(pull, 5 * 60 * 1000), t2 = setInterval(sync, 15 * 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [online, sync]);

  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  const add = (barcode) => {
    const p = byCode.get(barcode.trim());
    if (!p) { setMsg(`Unknown barcode: ${barcode}`); return; }
    setMsg('');
    setCart((c) => {
      const i = c.findIndex((l) => l.barcode === p.barcode);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { barcode: p.barcode, name: p.name, priceCents: p.priceCents, qty: 1 }];
    });
  };
  const setQty = (barcode, q) => setCart((c) => c.map((l) => (l.barcode === barcode ? { ...l, qty: q } : l)).filter((l) => l.qty > 0));

  // A USB scanner "types" the code and presses Enter, so this is just a text field.
  const onScan = (e) => { if (e.key === 'Enter' && code) { add(code); setCode(''); } };

  const reset = () => { setCart([]); setTendered(''); setRef(''); setPhone(''); setMpesa(null); setMethod('cash'); focusScan(); };

  const finish = async (payments, changeCents) => {
    const t = till || 'T1';
    const sale = {
      clientId: crypto.randomUUID(),
      receiptNo: await nextReceiptNo(t),
      till: t,
      soldAt: new Date().toISOString(),
      lines: cart.map((l) => ({ barcode: l.barcode, qty: l.qty, unitPriceCents: l.priceCents })),
      payments,
    };
    await enqueueSale(sale);
    setReceipt({ ...sale, items: cart, totalCents: total, changeCents });
    reset();
    refreshCounts();
    sync();
  };

  const charge = async () => {
    if (!cart.length) return;
    if (method === 'cash') {
      const paid = toCents(tendered) || total;
      if (paid < total) return setMsg('Cash tendered is less than the total');
      return finish([{ method: 'cash', amountCents: paid }], paid - total);
    }
    if (method === 'card') return finish([{ method: 'card', amountCents: total, ref: ref || undefined }], 0);
    // M-Pesa: online only. Send the STK push, wait for the Daraja callback, then record the sale.
    try {
      setMsg('');
      const { checkoutRequestId } = await api('/mpesa/stkpush', { method: 'POST', body: { phone, amountCents: total } });
      setMpesa({ id: checkoutRequestId, status: 'pending' });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await api('/mpesa/status/' + checkoutRequestId);
        if (s.status === 'success') { setMpesa(null); return finish([{ method: 'mpesa', amountCents: total, ref: checkoutRequestId }], 0); }
        if (s.status === 'failed') { setMpesa(null); return setMsg('M-Pesa failed: ' + (s.message || 'cancelled')); }
      }
      setMpesa(null); setMsg('M-Pesa timed out. Ask the customer to retry.');
    } catch (e) { setMpesa(null); setMsg(e.message); }
  };

  if (!till) {
    return (
      <div className="login">
        <h1>Name this till</h1>
        <p>Used in receipt numbers, e.g. T1 or FRONT.</p>
        <input autoFocus placeholder="T1" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim().toUpperCase().slice(0, 10); localStorage.setItem('till', v); setTill(v); } }} />
      </div>
    );
  }

  return (
    <main className="till">
      <div className={`bar ${online ? 'ok' : 'warn'}`}>
        {online ? 'Online' : 'OFFLINE: sales are saved on this device'} · Till {till} · {pending} waiting to sync
        {failed > 0 && <b> · {failed} rejected, tell a manager</b>}
        {syncState === 'auth' && <> · <button onClick={onNeedLogin}>Session expired: sign in to sync</button></>}
      </div>

      <section className="cart">
        <input ref={scanRef} className="scan" autoFocus placeholder="Scan barcode or type it and press Enter" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onScan} />
        {msg && <p className="err">{msg}</p>}
        <table>
          <tbody>
            {cart.map((l) => (
              <tr key={l.barcode}>
                <td>{l.name}</td>
                <td className="num">{fmt(l.priceCents)}</td>
                <td className="qty">
                  <button onClick={() => { setQty(l.barcode, l.qty - 1); focusScan(); }}>−</button>
                  {l.qty}
                  <button onClick={() => { setQty(l.barcode, l.qty + 1); focusScan(); }}>+</button>
                </td>
                <td className="num">{fmt(l.priceCents * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cart.length && <p className="muted">Scan an item to start. {catalog.items.length} products loaded{catalog.at ? ` (updated ${new Date(catalog.at).toLocaleTimeString()})` : ''}.</p>}
        <details>
          <summary>Search products</summary>
          <ProductSearch items={catalog.items} onPick={(b) => { add(b); focusScan(); }} />
        </details>
      </section>

      <section className="pay">
        <div className="total">{fmt(total)}</div>
        <div className="methods">
          {['cash', 'card', 'mpesa'].map((m) => (
            <button key={m} className={method === m ? 'on' : ''} disabled={m === 'mpesa' && !online} onClick={() => setMethod(m)}>
              {m === 'mpesa' ? 'M-Pesa' : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {method === 'cash' && (
          <>
            <input inputMode="decimal" placeholder={`Cash received (blank = ${fmt(total)})`} value={tendered} onChange={(e) => setTendered(e.target.value)} />
            {toCents(tendered) > total && <div className="change">Change: {fmt(toCents(tendered) - total)}</div>}
          </>
        )}
        {method === 'card' && <input placeholder="Card terminal reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />}
        {method === 'mpesa' && <input inputMode="tel" placeholder="Customer phone 07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        <button className="primary big" disabled={!cart.length || !!mpesa} onClick={charge}>
          {mpesa ? 'Waiting for customer to enter PIN…' : method === 'mpesa' ? 'Send M-Pesa prompt' : 'Complete sale'}
        </button>
        <button onClick={reset}>Clear</button>
      </section>

      {receipt && <Receipt r={receipt} onClose={() => { setReceipt(null); focusScan(); }} />}
    </main>
  );
}

function ProductSearch({ items, onPick }) {
  const [q, setQ] = useState('');
  const hits = q.length < 2 ? [] : items.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div>
      <input placeholder="Type a product name" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.map((p) => (<button key={p.barcode} className="hit" onClick={() => { onPick(p.barcode); setQ(''); }}>{p.name} · {fmt(p.priceCents)}</button>))}
    </div>
  );
}

// Prints through the browser. A dedicated ESC/POS bridge can replace window.print() later.
function Receipt({ r, onClose }) {
  return (
    <div className="modal">
      <div className="receipt">
        <h3>Receipt {r.receiptNo}</h3>
        <small>{new Date(r.soldAt).toLocaleString()}</small>
        {r.items.map((l) => (<div key={l.barcode} className="row"><span>{l.qty} × {l.name}</span><span>{fmt(l.priceCents * l.qty)}</span></div>))}
        <div className="row b"><span>Total</span><span>{fmt(r.totalCents)}</span></div>
        {r.payments.map((p, i) => (<div key={i} className="row"><span>{p.method}</span><span>{fmt(p.amountCents)}</span></div>))}
        {r.changeCents > 0 && <div className="row"><span>Change</span><span>{fmt(r.changeCents)}</span></div>}
        <div className="noprint actions"><button onClick={() => window.print()}>Print</button><button className="primary" onClick={onClose}>Next customer</button></div>
      </div>
    </div>
  );
}
