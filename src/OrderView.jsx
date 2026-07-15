import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Receipt } from '@phosphor-icons/react';
import { addBillItem } from './api.js';
import { money } from './ui.jsx';

export default function OrderView({ state, run }) {
  const [plateId, setPlateId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dishId, setDishId] = useState('');
  const [addOnIds, setAddOnIds] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const selectedPlate = state.numberPlates.find((item) => item.id === plateId);
  const selectedDish = state.dishes.find((item) => item.id === dishId);
  const bill = state.openBills.find((item) => item.numberPlateId === plateId);
  const categoryDishes = state.dishes.filter((item) => item.categoryId === categoryId && item.active);
  const allowedAddOns = selectedDish ? state.addOns.filter((item) => selectedDish.allowedAddOnIds.includes(item.id) && item.active) : [];
  const addOnTotal = allowedAddOns.filter((item) => addOnIds.includes(item.id)).reduce((sum, item) => sum + item.priceCents, 0);
  const currentTotal = selectedDish ? (selectedDish.priceCents + addOnTotal) * quantity : 0;

  function resetChoices() { setCategoryId(''); setDishId(''); setAddOnIds([]); setQuantity(1); }
  function choosePlate(id) { setPlateId(id); resetChoices(); }
  function chooseCategory(id) { setCategoryId(id); setDishId(''); setAddOnIds([]); setQuantity(1); }
  function chooseDish(id) { setDishId(id); setAddOnIds([]); setQuantity(1); }
  async function submit() {
    const ok = await run(() => addBillItem(plateId, { dishId, addOnIds, quantity }), '已加入号牌账单');
    if (ok) { setDishId(''); setAddOnIds([]); setQuantity(1); }
  }

  if (!selectedPlate) return (
    <main className="page order-select-page">
      <div className="compact-heading"><h1>选择号牌</h1><span>{state.numberPlates.filter((item) => item.status === 'active').length} 个进行中</span></div>
      <div className="plate-grid">{state.numberPlates.map((plate) => (
        <button key={plate.id} className={`plate-button ${plate.status}`} onClick={() => choosePlate(plate.id)}>
          <strong>{String(plate.number).padStart(2, '0')}</strong><span>{plate.status === 'active' ? `进行中 · ${money(plate.totalCents)}` : '空闲'}</span>
        </button>
      ))}</div>
    </main>
  );

  return (
    <main className="page order-builder-page">
      <section className="order-builder">
        <button className="back-button" onClick={() => setPlateId('')}><ArrowLeft />返回号牌</button>
        <div className="order-title"><div><span>当前号牌</span><strong>{String(selectedPlate.number).padStart(2, '0')}<small>号</small></strong></div><p>{bill ? '继续加菜' : '新账单'}</p></div>
        <div className="choice-section"><h2>品类</h2><div className="choice-tabs">{state.categories.map((category) => <button key={category.id} className={category.id === categoryId ? 'active' : ''} onClick={() => chooseCategory(category.id)}>{category.name}</button>)}</div></div>
        {categoryId && <div className="choice-section"><h2>菜品</h2><div className="dish-choice-grid">{categoryDishes.map((dish) => <button key={dish.id} className={dish.id === dishId ? 'active' : ''} onClick={() => chooseDish(dish.id)}><strong>{dish.name}</strong><span>{dish.note || ' '}</span><b>{money(dish.priceCents)}</b></button>)}</div></div>}
        {selectedDish && <section className="dish-config">
          <div className="dish-config__title"><div><span>{selectedDish.group}</span><h2>{selectedDish.name}</h2></div><strong>{money(selectedDish.priceCents)}</strong></div>
          <div className="quantity-row"><span>份数</span><div className="stepper"><button aria-label="减少份数" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button><strong>{quantity}</strong><button aria-label="增加份数" onClick={() => setQuantity((value) => Math.min(99, value + 1))}><Plus /></button></div></div>
          <div className="add-on-list"><h3>小料</h3>{allowedAddOns.length ? allowedAddOns.map((item) => <button key={item.id} className={addOnIds.includes(item.id) ? 'active' : ''} onClick={() => setAddOnIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}><span>{item.name}</span><b>+{money(item.priceCents)}</b><i>{addOnIds.includes(item.id) && <Check weight="bold" />}</i></button>) : <p>此菜品无需选择小料</p>}</div>
          <button className="primary-button submit-dish" onClick={submit}>加入账单 · {quantity} 份 · {money(currentTotal)}<ArrowRight /></button>
        </section>}
      </section>
      <aside className="bill-aside">
        <header><span>{String(selectedPlate.number).padStart(2, '0')} 号账单</span><strong>{money(bill?.totalCents || 0)}</strong></header>
        {bill?.items.length ? <div className="bill-lines">{bill.items.map((item) => <div key={item.id}><div><strong>{item.dishName}</strong><span>× {item.quantity}</span></div><small>{item.extras.join('、') || '不加小料'}</small><b>{money(item.totalCents)}</b></div>)}</div> : <div className="empty-compact"><Receipt size={34} /><span>还没有菜品</span></div>}
        <footer><span>共 {bill?.totalQuantity || 0} 份</span><strong>{money(bill?.totalCents || 0)}</strong></footer>
      </aside>
    </main>
  );
}
