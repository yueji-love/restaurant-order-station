import { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, Minus, Plus, Receipt, ShoppingCart, Trash,
} from '@phosphor-icons/react';
import { addBillItems } from './api.js';
import { Drawer, money } from './ui.jsx';

function cartLineTotal(line, state) {
  const dish = state.dishes.find((item) => item.id === line.dishId);
  const addOnTotal = state.addOns.filter((item) => line.addOnIds.includes(item.id)).reduce((sum, item) => sum + item.priceCents, 0);
  return ((dish?.priceCents || 0) + addOnTotal) * line.quantity;
}

export default function OrderView({ state, run }) {
  const [plateId, setPlateId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [configDishId, setConfigDishId] = useState('');
  const [configAddOnIds, setConfigAddOnIds] = useState([]);
  const [configQuantity, setConfigQuantity] = useState(1);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const selectedPlate = state.numberPlates.find((item) => item.id === plateId);
  const bill = state.openBills.find((item) => item.numberPlateId === plateId);
  const configDish = state.dishes.find((item) => item.id === configDishId);
  const categoryDishes = state.dishes.filter((item) => item.categoryId === categoryId && item.active);
  const configAddOns = configDish ? state.addOns.filter((item) => configDish.allowedAddOnIds.includes(item.id) && item.active) : [];
  const configTotal = configDish ? ((configDish.priceCents + configAddOns.filter((item) => configAddOnIds.includes(item.id)).reduce((sum, item) => sum + item.priceCents, 0)) * configQuantity) : 0;
  const cartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + cartLineTotal(item, state), 0), [cart, state]);

  function choosePlate(id) {
    setPlateId(id);
    setCategoryId(state.categories[0]?.id || '');
    setCart([]);
  }
  function openDish(dishId) {
    setConfigDishId(dishId);
    setConfigAddOnIds([]);
    setConfigQuantity(1);
  }
  function closeDish() { setConfigDishId(''); setConfigAddOnIds([]); setConfigQuantity(1); }
  function addToCart() {
    if (!configDish) return;
    setCart((items) => [...items, {
      clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      dishId: configDish.id,
      addOnIds: configAddOnIds,
      quantity: configQuantity,
    }]);
    closeDish();
  }
  function changeCartQuantity(clientId, offset) {
    setCart((items) => items.map((item) => item.clientId === clientId ? { ...item, quantity: Math.max(1, Math.min(99, item.quantity + offset)) } : item));
  }
  async function submitCart() {
    const result = await run(() => addBillItems(plateId, cart.map(({ dishId, addOnIds, quantity }) => ({ dishId, addOnIds, quantity }))), `已提交 ${cartQuantity} 份菜品`);
    if (result) { setCart([]); setCartOpen(false); }
  }
  function leavePlate() {
    if (cart.length) setCartOpen(true);
    else { setPlateId(''); setCategoryId(''); }
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
    <main className="page fast-order-page">
      <header className="fast-order-header">
        <button className="back-button" onClick={leavePlate}><ArrowLeft />返回号牌</button>
        <div className="fast-order-plate"><span>当前号牌</span><strong>{String(selectedPlate.number).padStart(2, '0')}<small>号</small></strong></div>
        <div className="submitted-total"><span>已送后厨</span><strong>{bill?.totalQuantity || 0} 份 · {money(bill?.totalCents || 0)}</strong></div>
      </header>

      <nav className="fast-category-tabs" aria-label="菜品品类">
        {state.categories.map((category) => <button key={category.id} className={category.id === categoryId ? 'active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
      </nav>

      <section className="fast-dish-grid">
        {categoryDishes.map((dish) => <button key={dish.id} onClick={() => openDish(dish.id)}><span><strong>{dish.name}</strong><small>{dish.note || dish.group}</small></span><b>{money(dish.priceCents)}</b><Plus /></button>)}
        {categoryId && !categoryDishes.length && <div className="empty-compact"><Receipt size={30} />这个品类还没有启用的菜品</div>}
      </section>

      <button className={`floating-cart ${cart.length ? 'has-items' : ''}`} onClick={() => setCartOpen(true)} aria-label={`点菜单，${cartQuantity} 份`}>
        <ShoppingCart weight="fill" /><span><b>{cartQuantity}</b> 份</span><strong>{money(cartTotal)}</strong>
      </button>

      {configDish && <Drawer title="选择份数和小料" onClose={closeDish}>
        <div className="dish-drawer-body">
          <div className="drawer-dish-title"><div><span>{configDish.group}</span><h2>{configDish.name}</h2><p>{configDish.note || ' '}</p></div><strong>{money(configDish.priceCents)}</strong></div>
          <div className="drawer-quantity"><span>份数</span><div className="stepper"><button aria-label="减少份数" onClick={() => setConfigQuantity((value) => Math.max(1, value - 1))}><Minus /></button><strong>{configQuantity}</strong><button aria-label="增加份数" onClick={() => setConfigQuantity((value) => Math.min(99, value + 1))}><Plus /></button></div></div>
          <div className="drawer-addons"><h3>小料</h3>{configAddOns.length ? <div>{configAddOns.map((item) => <button key={item.id} className={configAddOnIds.includes(item.id) ? 'active' : ''} onClick={() => setConfigAddOnIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}><span>{item.name}</span><b>+{money(item.priceCents)}</b><i>{configAddOnIds.includes(item.id) && <Check weight="bold" />}</i></button>)}</div> : <p>此菜品无需选择小料</p>}</div>
        </div>
        <footer className="drawer-footer"><button className="primary-button" onClick={addToCart}>加入点菜单 · {configQuantity} 份 · {money(configTotal)}<ArrowRight /></button></footer>
      </Drawer>}

      {cartOpen && <Drawer title={`${String(selectedPlate.number).padStart(2, '0')} 号点菜单`} onClose={() => setCartOpen(false)} wide>
        <div className="cart-drawer-body">
          {bill && <div className="already-submitted"><div><span>已送后厨</span><strong>{bill.totalQuantity} 份</strong></div><b>{money(bill.totalCents)}</b></div>}
          {cart.length ? <div className="cart-lines">{cart.map((line) => {
            const dish = state.dishes.find((item) => item.id === line.dishId);
            const addOns = state.addOns.filter((item) => line.addOnIds.includes(item.id));
            return <article key={line.clientId}><section><strong>{dish?.name}</strong><small>{addOns.map((item) => item.name).join('、') || '不加小料'}</small></section><div className="cart-stepper"><button aria-label={`减少 ${dish?.name} 份数`} onClick={() => changeCartQuantity(line.clientId, -1)}><Minus /></button><b>{line.quantity}</b><button aria-label={`增加 ${dish?.name} 份数`} onClick={() => changeCartQuantity(line.clientId, 1)}><Plus /></button></div><strong>{money(cartLineTotal(line, state))}</strong><button className="cart-delete" aria-label={`删除 ${dish?.name}`} onClick={() => setCart((items) => items.filter((item) => item.clientId !== line.clientId))}><Trash /></button></article>;
          })}</div> : <div className="cart-empty"><ShoppingCart size={44} /><h3>点菜单还是空的</h3><p>关闭这里，点击菜品即可添加。</p></div>}
        </div>
        <footer className="drawer-footer cart-footer"><button className="clear-cart" disabled={!cart.length} onClick={() => setCart([])}>清空</button><button className="primary-button" disabled={!cart.length} onClick={submitCart}>确认下单 · {cartQuantity} 份 · {money(cartTotal)}<ArrowRight /></button></footer>
      </Drawer>}
    </main>
  );
}
