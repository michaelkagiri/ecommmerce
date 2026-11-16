import React, { useCallback, useEffect, useState } from 'react';
import { api, fmt, toCents } from './api.js';

const TABS = ['Products', 'Sales', 'Reports', 'Users', 'Audit'];

export default function Manager() {
  const [tab, setTab] = useState('Products');
  return (
    <div className="mgr">
      <div className="tabs">{TABS.map((t) => (<button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>))}</div>
      <div className="panel">
        {tab === 'Products' && <Products />}
        {tab === 'Sales' && <Sales />}
        {tab === 'Reports' && <Reports />}
        {tab === 'Users' && <Users />}
        {tab === 'Audit' && <Audit />}
      </div>
    </div>
  );
}

// Small helper: load data, expose reload and an error line.
function useLoad(path) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api(path).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message)), [path]);
  useEffect(() => { load(); }, [load]);
  return [data, load, err];
}
const run = async (fn, reload, setErr) => { try { await fn(); setErr(''); reload(); } catch (e) { setErr(e.message); } };

function Products() {
  const [data, load, err0] = useLoad('/products?all=1');
  const [low] = useLoad('/reports/low-stock');
  const [err, setErr] = useState('');
  const [f, setF] = useState({ barcode: '', name: '', price: '', stock: '' });
  const [q, setQ] = useState('');
  const items = (data?.items || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.barcode.includes(q));
  const add = () => run(() => api('/products', { method: 'POST', body: { barcode: f.barcode, name: f.name, priceCents: toCents(f.price), stock: parseInt(f.stock || '0', 10) } }).then(() => setF({ barcode: '', name: '', price: '', stock: '' })), load, setErr);
  const price = (p) => { const v = prompt(`New price for ${p.name} (KES)`, p.priceCents / 100); if (v !== null) run(() => api('/products/' + p._id, { method: 'PUT', body: { priceCents: toCents(v) } }), load, setErr); };
  const adjust = (p) => {
    const d = prompt(`Stock change for ${p.name} (e.g. 24 for a delivery, -2 for damage)`); if (!d) return;
    const reason = prompt('Reason: delivery, damage, stocktake or correction', parseInt(d, 10) > 0 ? 'delivery' : 'damage'); if (!reason) return;
    run(() => api(`/products/${p._id}/adjust`, { method: 'POST', body: { delta: parseInt(d, 10), reason } }), load, setErr);
  };
  const toggle = (p) => run(() => api('/products/' + p._id, { method: 'PUT', body: { active: !p.active } }), load, setErr);
  return (
    <>
      {(err || err0) && <p className="err">{err || err0}</p>}
      {low?.length > 0 && <p className="flag">Low stock: {low.map((p) => `${p.name} (${p.stock})`).join(', ')}</p>}
      <div className="form">
        <input placeholder="Barcode" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} />
        <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="Price KES" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <input placeholder="Opening stock" inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} />
        <button className="primary" onClick={add}>Add product</button>
      </div>
      <input placeholder="Search name or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
      <table>
        <thead><tr><th>Barcode</th><th>Name</th><th className="num">Price</th><th className="num">Stock</th><th /></tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p._id} style={{ opacity: p.active ? 1 : 0.5 }}>
              <td>{p.barcode}</td><td>{p.name}</td><td className="num">{fmt(p.priceCents)}</td><td className="num">{p.stock}</td>
              <td className="num"><button onClick={() => price(p)}>Price</button> <button onClick={() => adjust(p)}>Stock</button> <button onClick={() => toggle(p)}>{p.active ? 'Disable' : 'Enable'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Sales() {
  const [flagged, setFlagged] = useState(false);
  const [data, load, err0] = useLoad('/sales' + (flagged ? '?flagged=1' : ''));
  const [err, setErr] = useState('');
  const refund = (s) => {
    const reason = prompt(`Refund everything on ${s.receiptNo}? Enter a reason:`); if (!reason) return;
    const method = prompt('Refund paid back by: cash, card or mpesa', s.payments[0]?.method || 'cash') || 'cash';
    run(() => api(`/sales/${s._id}/refund`, { method: 'POST', body: { reason, method } }), load, setErr);
  };
  return (
    <>
      {(err || err0) && <p className="err">{err || err0}</p>}
      <label><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} style={{ width: 'auto' }} /> Only flagged sales</label>
      <table>
        <thead><tr><th>Receipt</th><th>Time</th><th>Cashier</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
        <tbody>
          {(data || []).map((s) => (
            <tr key={s._id}>
              <td>{s.receiptNo}</td><td>{new Date(s.soldAt).toLocaleString()}</td><td>{s.cashierName}</td><td className="num">{fmt(s.totalCents)}</td>
              <td>{s.status} {s.flags?.map((x) => <span key={x} className="flag">[{x}] </span>)}</td>
              <td>{s.status !== 'refunded' && <button onClick={() => refund(s)}>Refund</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Reports() {
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const from = new Date(date + 'T00:00:00').toISOString();
  const to = new Date(new Date(date + 'T00:00:00').getTime() + 86400000).toISOString();
  const [r, , err] = useLoad(`/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return (
    <>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      {err && <p className="err">{err}</p>}
      {r && (
        <>
          <div className="cards">
            <div className="card">Sales<b>{r.salesCount}</b></div>
            <div className="card">Gross<b>{fmt(r.grossCents)}</b></div>
            <div className="card">Refunds<b>{fmt(r.refundsCents)}</b></div>
            <div className="card">Net<b>{fmt(r.netCents)}</b></div>
            <div className="card">Cash<b>{fmt(r.byMethod.cash)}</b></div>
            <div className="card">Card<b>{fmt(r.byMethod.card)}</b></div>
            <div className="card">M-Pesa<b>{fmt(r.byMethod.mpesa)}</b></div>
            <div className="card">Expected in drawer<b>{fmt(r.expectedCashCents)}</b><small>cash − change − cash refunds</small></div>
          </div>
          {r.flaggedCount > 0 && <p className="flag">{r.flaggedCount} sale(s) need review in the Sales tab.</p>}
        </>
      )}
    </>
  );
}

function Users() {
  const [data, load, err0] = useLoad('/users');
  const [err, setErr] = useState('');
  const [f, setF] = useState({ username: '', password: '', role: 'cashier' });
  const add = () => run(() => api('/users', { method: 'POST', body: f }).then(() => setF({ username: '', password: '', role: 'cashier' })), load, setErr);
  const reset = (u) => { const p = prompt(`New password for ${u.username} (8+ chars)`); if (p) run(() => api('/users/' + u._id, { method: 'PUT', body: { password: p } }), load, setErr); };
  const toggle = (u) => run(() => api('/users/' + u._id, { method: 'PUT', body: { active: !u.active } }), load, setErr);
  return (
    <>
      {(err || err0) && <p className="err">{err || err0}</p>}
      <div className="form">
        <input placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input placeholder="Password (8+)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>cashier</option><option>manager</option></select>
        <button className="primary" onClick={add}>Add user</button>
      </div>
      <table>
        <tbody>{(data || []).map((u) => (<tr key={u._id}><td>{u.username}</td><td>{u.role}</td><td>{u.active ? 'active' : 'disabled'}</td><td><button onClick={() => reset(u)}>Reset password</button> <button onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button></td></tr>))}</tbody>
      </table>
    </>
  );
}

function Audit() {
  const [data, , err] = useLoad('/reports/audit');
  return (
    <>
      {err && <p className="err">{err}</p>}
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{(data || []).map((a) => (<tr key={a._id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.byName}</td><td>{a.action}</td><td><code>{JSON.stringify(a.detail)}</code></td></tr>))}</tbody>
      </table>
    </>
  );
}
