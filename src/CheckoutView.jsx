import { useEffect, useState } from 'react';
import { ArrowRight, Receipt } from '@phosphor-icons/react';
import { getBills, settleBill } from './api.js';
import { dateTime, money, StatusPill } from './ui.jsx';

export default function CheckoutView({ state, run }) {
  const [selectedId, setSelectedId] = useState('');
  const [settled, setSettled] = useState([]);
  const selected = state.openBills.find((item) => item.id === selectedId) || state.openBills[0];
  useEffect(() => { if (state.openBills.length && !state.openBills.some((item) => item.id === selectedId)) setSelectedId(state.openBills[0].id); }, [state.openBills, selectedId]);
  useEffect(() => { getBills('settled', 30).then((result) => setSettled(result.bills)).catch(() => undefined); }, [state.openBills]);
  async function settle() {
    if (!selected) return;
    const ok = await run(() => settleBill(selected.id), `${selected.number} 号已结算`);
    if (ok) setSettled((await getBills('settled', 30)).bills);
  }
  return (
    <main className="page checkout-page">
      <section className="checkout-list">
        <div className="compact-heading"><h1>待结算</h1><span>{state.openBills.length} 个号牌</span></div>
        <div className="checkout-cards">{state.openBills.map((bill) => <button key={bill.id} className={selected?.id === bill.id ? 'active' : ''} onClick={() => setSelectedId(bill.id)}><span><strong>{String(bill.number).padStart(2, '0')}</strong>号</span><div><b>{money(bill.totalCents)}</b><small>{bill.completedCount}/{bill.itemCount} 道完成</small></div><ArrowRight /></button>)}</div>
        {!state.openBills.length && <div className="empty-compact"><Receipt size={36} />没有待结算账单</div>}
        <div className="history-title">最近已结算</div>
        <div className="settled-list">{settled.map((bill) => <div key={bill.id}><span>{String(bill.number).padStart(2, '0')} 号</span><small>{dateTime(bill.settledAt)}</small><b>{money(bill.totalCents)}</b></div>)}</div>
      </section>
      <aside className="checkout-detail">
        {selected ? <>
          <header><span>{String(selected.number).padStart(2, '0')}<small>号</small></span><div><small>账单合计</small><strong>{money(selected.totalCents)}</strong></div></header>
          <div className="checkout-lines">{selected.items.map((item) => <div key={item.id}><StatusPill status={item.status} /><section><strong>{item.dishName} × {item.quantity}</strong><small>{item.extras.join('、') || '不加小料'}</small></section><b>{money(item.totalCents)}</b></div>)}</div>
          <footer><p>{selected.incompleteCount ? `还有 ${selected.incompleteCount} 道菜未完成` : '菜品已全部完成，可以结算'}</p><button className="primary-button" disabled={selected.incompleteCount > 0} onClick={settle}>确认结算 · {money(selected.totalCents)}</button></footer>
        </> : <div className="empty-page"><Receipt size={50} /><h2>选择一张账单</h2></div>}
      </aside>
    </main>
  );
}
