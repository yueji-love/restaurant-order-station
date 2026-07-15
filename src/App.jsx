import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, CheckCircle, ClipboardText, CookingPot, QrCode, Receipt, SignOut, UserCircle, WarningCircle,
} from '@phosphor-icons/react';
import {
  getCurrentUser, getPublicProgress, getState, loginUser, logoutUser, registerUser, subscribeToPublicProgress, subscribeToState,
} from './api.js';
import CheckoutView from './CheckoutView.jsx';
import KitchenView from './KitchenView.jsx';
import MineView from './MineView.jsx';
import OrderView from './OrderView.jsx';
import { dateTime, money, StatusPill } from './ui.jsx';

const EMPTY_STATE = {
  categories: [], dishes: [], addOns: [], numberPlates: [], openBills: [], queue: [],
  settings: { sound: true, paymentQrConfigured: false, availableNumbers: [] },
};

let audioContext;
async function playOrderSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') await audioContext.resume().catch(() => undefined);
  const start = audioContext.currentTime + 0.02;
  [1046.5, 1318.51, 1567.98].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = start + index * 0.115;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.13, noteStart + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.32);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(noteStart); oscillator.stop(noteStart + 0.34);
  });
}

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('yue');
  const [password, setPassword] = useState('123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = mode === 'login' ? await loginUser({ username, password }) : await registerUser({ username, password });
      onAuthenticated(result.user);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-visual"><img src="/auth-restaurant-workstation.png" alt="餐厅点菜与出餐工作场景" /><div className="auth-visual__caption"><span>餐厅工作台</span><strong>每一单，<br />都清清楚楚。</strong></div></section>
    <section className="auth-panel"><div className="auth-card"><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setPassword('123'); }}>登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setPassword(''); }}>注册</button></div><form onSubmit={submit}><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>{mode === 'register' && <p className="form-hint">用户名至少 3 位，密码至少 8 位。</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '进入工作台' : '创建账号'}<ArrowRight size={21} /></button></form></div></section>
  </main>;
}

function PublicProgress({ token }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => getPublicProgress(token).then((result) => alive && setProgress(result)).catch((reason) => alive && setError(reason.status === 404 ? '这个号牌二维码无效' : reason.message));
    load();
    const unsubscribe = subscribeToPublicProgress(token, { onChange: load, onError: () => undefined });
    return () => { alive = false; unsubscribe(); };
  }, [token]);
  if (error) return <main className="public-page public-empty"><QrCode size={55} /><h1>{error}</h1></main>;
  if (!progress) return <main className="public-page public-empty"><span className="loader" />正在读取号牌…</main>;
  const bill = progress.bill;
  const timeline = (item) => [
    { label: '下单', value: item.createdAt },
    { label: '开始制作', value: item.startedAt },
    { label: '完成', value: item.completedAt },
  ];
  return <main className="public-page">
    <header><div><span>号牌</span><strong>{String(progress.number).padStart(2, '0')}<small>号</small></strong></div>{bill && <section><small>当前消费</small><strong>{money(bill.totalCents, true)}</strong></section>}</header>
    {!bill ? <section className="public-no-bill"><Check size={52} /><h1>当前没有未结算账单</h1><p>下单后，这里会自动显示制作进度。</p></section> : <><section className="public-summary"><div><strong>{bill.totalQuantity}</strong><span>总份数</span></div><div><strong>{bill.completedCount}</strong><span>已完成</span></div><div><strong>{bill.incompleteCount}</strong><span>未完成</span></div></section><section className="public-items">{bill.items.map((item) => <article key={item.id}>
      <header className="public-item-head"><StatusPill status={item.status} /><section><h2>{item.dishName} <small>× {item.quantity}</small></h2><p>{item.extras.join('、') || '不加小料'}</p></section><strong>{money(item.totalCents)}</strong></header>
      {item.status === 'waiting' && <p className="queue-ahead">{item.aheadCount > 0 ? `前面还有 ${item.aheadCount} 份待制作` : '已排到最前'}</p>}
      <div className={`item-timeline timeline-${item.status}`} aria-label={`${item.dishName}制作进度`}>{timeline(item).map((event) => <div key={event.label} className={`timeline-event ${event.value ? 'reached' : ''}`}><i aria-hidden="true" /><span>{event.label}</span>{event.value ? <time dateTime={event.value}>{dateTime(event.value)}</time> : <small>等待中</small>}</div>)}</div>
    </article>)}</section></>}
    {progress.paymentQrConfigured && <footer className="public-payment"><span>扫码付款</span><img src={`/api/public/plates/${token}/payment-qr`} alt="商家收款码" /><p>请向商家确认结算金额</p></footer>}
  </main>;
}

export default function App() {
  const token = window.location.pathname.match(/^\/Q\/([0-9A-Z]+)\/?$/i)?.[1]?.toUpperCase();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [state, setState] = useState(EMPTY_STATE);
  const [view, setView] = useState('order');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const previousWaiting = useRef(0);

  useEffect(() => { if (!token) getCurrentUser().then(({ user: current }) => { setUser(current); setAuthReady(true); }).catch(() => setAuthReady(true)); }, [token]);
  useEffect(() => {
    if (!user) return undefined;
    getState().then((next) => { setState(next); previousWaiting.current = next.queue.filter((item) => item.status === 'waiting').length; });
    return subscribeToState({ onState: (next) => {
      const count = next.queue.filter((item) => item.status === 'waiting').length;
      if (next.settings.sound && count > previousWaiting.current) playOrderSound();
      previousWaiting.current = count; setState(next);
    }, onOpen: () => undefined, onError: () => undefined });
  }, [user]);
  useEffect(() => { if (!toast && !error) return undefined; const timer = setTimeout(() => { setToast(''); setError(''); }, 2800); return () => clearTimeout(timer); }, [toast, error]);
  async function run(action, success) {
    setError('');
    try { const result = await action(); if (success) setToast(success); return result || true; }
    catch (reason) { setError(reason.message); return false; }
  }
  if (token) return <PublicProgress token={token} />;
  if (!authReady) return <div className="loading-screen"><span className="loader" /></div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  const nav = [{ id: 'order', label: '点菜', icon: ClipboardText }, { id: 'kitchen', label: '出餐', icon: CookingPot }, { id: 'checkout', label: '结算', icon: Receipt }, { id: 'mine', label: '我的', icon: UserCircle }];
  async function signOut() { await logoutUser(); setUser(null); setState(EMPTY_STATE); }
  return <div className="app-shell">
    <header className="topbar"><div className="topbar__brand">点单台</div><nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon weight={view === id ? 'fill' : 'regular'} />{label}{id === 'kitchen' && state.queue.length > 0 && <i>{state.queue.length}</i>}</button>)}</nav><div className="topbar__account"><span><UserCircle />{user.username}</span><button onClick={signOut} aria-label="退出登录"><SignOut /></button></div></header>
    {view === 'order' && <OrderView state={state} run={run} />}{view === 'kitchen' && <KitchenView state={state} run={run} />}{view === 'checkout' && <CheckoutView state={state} run={run} />}{view === 'mine' && <MineView state={state} run={run} />}
    {(toast || error) && <div key={error || toast} className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">{error ? <WarningCircle weight="fill" /> : <CheckCircle weight="fill" />}<span>{error || toast}</span></div>}
  </div>;
}
