import React, { useState } from 'react';
import { api, getSession, setSession } from './api.js';
import Cashier from './Cashier.jsx';
import Manager from './Manager.jsx';

function Login({ onDone }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try {
      const d = await api('/auth/login', { method: 'POST', body: { username: u, password: p } });
      setSession(d);
      onDone(d);
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="login">
      <h1>Sign in</h1>
      <input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
      <input placeholder="Password" type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button className="primary" onClick={go}>Sign in</button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export default function App() {
  const [session, setS] = useState(getSession());
  const [view, setView] = useState('cashier');
  if (!session) return <Login onDone={setS} />;
  const isMgr = session.user.role === 'manager';
  const logout = () => { setSession(null); setS(null); };
  return (
    <>
      <header className="top">
        <strong>POS</strong>
        {isMgr && (
          <nav>
            <button className={view === 'cashier' ? 'on' : ''} onClick={() => setView('cashier')}>Till</button>
            <button className={view === 'manager' ? 'on' : ''} onClick={() => setView('manager')}>Manager</button>
          </nav>
        )}
        <span className="grow" />
        <span>{session.user.username}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      {view === 'manager' && isMgr ? <Manager /> : <Cashier onNeedLogin={logout} />}
    </>
  );
}
