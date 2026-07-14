import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChartBar,
  Check,
  CaretDown,
  CaretUp,
  ClipboardText,
  CookingPot,
  ForkKnife,
  LockSimple,
  Minus,
  PencilSimple,
  Plus,
  SignOut,
  SlidersHorizontal,
  Storefront,
  Trash,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import {
  createAddOn,
  createDish,
  createOrder,
  deleteAddOn,
  deleteDish,
  getCurrentUser,
  getAnalytics,
  getState,
  loginUser,
  logoutUser,
  registerUser,
  reorderAddOns,
  reorderDishes,
  saveSettings,
  subscribeToState,
  updateAddOn,
  updateDish,
  updateOrder,
  updateOrdersBatch,
} from './api.js';

const DEFAULT_AVAILABLE_NUMBERS = Array.from({ length: 36 }, (_, index) => index + 1);
const DEFAULT_SETTINGS = { sortMode: 'time', sound: true, availableNumbers: DEFAULT_AVAILABLE_NUMBERS };
const EMPTY_DISH_FORM = { group: '', name: '', note: '', price: '', active: true, allowedAddOnIds: [] };
const EMPTY_ADD_ON_FORM = { name: '', price: '', active: true };

let notificationAudioContext;

function formatPrice(priceCents = 0) {
  return `¥${(priceCents / 100).toFixed(priceCents % 100 ? 2 : 0)}`;
}

function getOrderQuantity(order) {
  return Number.isInteger(order?.quantity) && order.quantity >= 1 ? order.quantity : 1;
}

function getOrderTotalCents(order) {
  if (Number.isInteger(order?.totalCents) && order.totalCents >= 0) return order.totalCents;
  const unitTotal = (order?.priceCents ?? 0)
    + (order?.addOns ?? []).reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
  return unitTotal * getOrderQuantity(order);
}

function getNotificationAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!notificationAudioContext) notificationAudioContext = new AudioContextClass();
  return notificationAudioContext;
}

async function unlockOrderSound() {
  const context = getNotificationAudioContext();
  if (context?.state === 'suspended') await context.resume().catch(() => undefined);
}

async function playOrderSound() {
  const context = getNotificationAudioContext();
  if (!context) return;
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
  if (context.state !== 'running') return;

  const start = context.currentTime + 0.02;
  [1046.5, 1318.51, 1567.98].forEach((frequency, index) => {
    const noteStart = start + index * 0.115;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.14, noteStart + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.34);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.36);
  });
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('order');
  const [step, setStep] = useState(0);
  const [number, setNumber] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [category, setCategory] = useState(null);
  const [extras, setExtras] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [queue, setQueue] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [addOns, setAddOns] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [, setSyncStatus] = useState('connecting');
  const [settingsStatus, setSettingsStatus] = useState('idle');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const queueCount = useRef(0);
  const queueInitialized = useRef(false);
  const unavailableNumbers = useMemo(() => new Set(queue.map((item) => item.number)), [queue]);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(({ user: currentUser }) => active && setUser(currentUser))
      .catch(() => active && setUser(null))
      .finally(() => active && setAuthReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const applyState = (nextState) => {
      if (!active) return;
      if (!queueInitialized.current) {
        queueCount.current = nextState.queue.length;
        queueInitialized.current = true;
      }
      setQueue(nextState.queue);
      setDishes(nextState.dishes ?? []);
      setAddOns(nextState.addOns ?? []);
      setSettings(nextState.settings);
    };

    getState()
      .then(applyState)
      .catch((error) => {
        if (!active) return;
        if (error.status === 401) setUser(null);
        else setSyncStatus('error');
      });

    const unsubscribe = subscribeToState({
      onState: applyState,
      onOpen: () => active && setSyncStatus('connected'),
      onError: () => active && setSyncStatus('error'),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const unlock = () => unlockOrderSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [user]);

  useEffect(() => {
    if (!queueInitialized.current) return;
    if (settings.sound && queue.length > queueCount.current) playOrderSound();
    queueCount.current = queue.length;
  }, [queue, settings.sound]);

  useEffect(() => {
    const availableNumbers = settings.availableNumbers ?? DEFAULT_AVAILABLE_NUMBERS;
    if (number && !availableNumbers.includes(number)) resetOrder();
  }, [number, settings.availableNumbers]);

  useEffect(() => {
    if (category && !dishes.some((item) => item.id === category.id && item.active)) {
      setStep(1);
      setCategory(null);
      setExtras([]);
      setQuantity(1);
    }
  }, [category, dishes]);

  useEffect(() => {
    const activeIds = new Set(addOns.filter((item) => item.active).map((item) => item.id));
    const allowedIds = new Set(category?.allowedAddOnIds ?? []);
    setExtras((current) => current.filter((item) => activeIds.has(item.id) && allowedIds.has(item.id)));
  }, [addOns, category]);

  useEffect(() => {
    if (selectedGroup && !dishes.some((item) => item.active && item.group === selectedGroup)) {
      setSelectedGroup('');
      setCategory(null);
      setExtras([]);
      setQuantity(1);
    }
  }, [dishes, selectedGroup]);

  const resetOrder = () => {
    setStep(0);
    setNumber(null);
    setSelectedGroup('');
    setCategory(null);
    setExtras([]);
    setQuantity(1);
    setSubmitting(false);
    setSuccess(false);
    setSubmitError('');
  };

  const selectNumber = (nextNumber) => {
    setNumber(nextNumber);
    setStep(1);
  };

  const selectGroup = (group) => {
    setSelectedGroup(group);
    setCategory(null);
    setExtras([]);
    setQuantity(1);
  };

  const selectCategory = (nextCategory) => {
    setCategory(nextCategory);
    setQuantity(1);
    setStep(2);
  };

  const selectExtras = (nextExtras) => {
    setExtras(nextExtras);
  };

  const stepBack = () => {
    if (step === 2) {
      setCategory(null);
      setExtras([]);
      setQuantity(1);
      setStep(1);
      return;
    }
    if (step === 1) {
      setSelectedGroup('');
      setNumber(null);
      setStep(0);
    }
  };

  const submitOrder = async () => {
    if (!number || !category || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await createOrder({ number, dishId: category.id, addOnIds: extras.map((item) => item.id), quantity });
      setSubmitting(false);
      setSuccess(true);
      window.setTimeout(resetOrder, 1200);
    } catch (error) {
      setSubmitting(false);
      setSubmitError(error.message);
      if (error.message.includes('使用中') || error.message.includes('未启用')) resetOrder();
      if (error.message.includes('菜品') || error.message.includes('加料')) {
        setCategory(null);
        setExtras([]);
        setQuantity(1);
        setStep(1);
      }
    }
  };

  const changeSettings = async (patch) => {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSettingsStatus('saving');
    try {
      await saveSettings(patch);
      setSettingsStatus('saved');
    } catch {
      setSettings(previous);
      setSettingsStatus('error');
    }
  };

  const changeOrderStatus = async (id, action) => {
    try {
      await updateOrder(id, action);
    } catch {
      setSyncStatus('error');
    }
  };

  const changeCategoryStatus = async (categoryName, action) => {
    try {
      await updateOrdersBatch(categoryName, action);
    } catch {
      setSyncStatus('error');
    }
  };

  const signOut = async () => {
    await logoutUser().catch(() => undefined);
    queueInitialized.current = false;
    queueCount.current = 0;
    setUser(null);
    setQueue([]);
    setDishes([]);
    setAddOns([]);
    setView('order');
    resetOrder();
  };

  if (!authReady) return <div className="auth-loading">正在打开工作台</div>;
  if (!user) return <AuthView onAuthenticated={setUser} />;

  return (
    <div className="app-shell">
      <Header view={view} user={user} onViewChange={setView} onLogout={signOut} />
      {view === 'order' && (
        <OrderView
          step={step}
          number={number}
          category={category}
          selectedGroup={selectedGroup}
          extras={extras}
          quantity={quantity}
          dishes={dishes.filter((item) => item.active)}
          addOns={addOns.filter((item) => item.active)}
          submitting={submitting}
          success={success}
          submitError={submitError}
          unavailableNumbers={unavailableNumbers}
          availableNumbers={settings.availableNumbers ?? DEFAULT_AVAILABLE_NUMBERS}
          onStepBack={stepBack}
          onNumberChange={selectNumber}
          onGroupChange={selectGroup}
          onCategoryChange={selectCategory}
          onExtrasChange={selectExtras}
          onQuantityChange={setQuantity}
          onSubmit={submitOrder}
          onReset={resetOrder}
        />
      )}
      {view === 'kitchen' && (
        <KitchenView
          queue={queue}
          onOrderAction={changeOrderStatus}
          onCategoryAction={changeCategoryStatus}
        />
      )}
      {view === 'mine' && (
        <MineView
          dishes={dishes}
          addOns={addOns}
          settings={settings}
          settingsStatus={settingsStatus}
          onSettingsChange={changeSettings}
        />
      )}
    </div>
  );
}

function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmation('');
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'register' && password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = mode === 'register'
        ? await registerUser({ username, password })
        : await loginUser({ username, password });
      onAuthenticated(result.user);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="餐厅工作台欢迎图">
        <img src="/auth-restaurant-workstation.png" alt="热气腾腾的粉面、号码牌与餐厅出餐台" />
      </section>
      <section className="auth-panel">
        <div className="auth-mode" role="tablist" aria-label="账号入口">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => changeMode('login')}>登录</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => changeMode('register')}>注册</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div>
            <label htmlFor="auth-username">用户名</label>
            <input id="auth-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </div>
          <div>
            <label htmlFor="auth-password">密码</label>
            <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-confirmation">确认密码</label>
              <input id="auth-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            </div>
          )}
          <p className="auth-error" aria-live="polite">{error}</p>
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? '正在处理' : mode === 'login' ? '进入工作台' : '创建账号'}
            <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}

function Header({ view, user, onViewChange, onLogout }) {
  const items = [
    { id: 'order', label: '点菜', Icon: ClipboardText },
    { id: 'kitchen', label: '出餐', Icon: CookingPot },
    { id: 'mine', label: '我的', Icon: UserCircle },
  ];

  return (
    <header className="topbar">
      <div className="topbar__brand" aria-label="餐厅工作台"><span>点单台</span></div>
      <nav className="topbar__nav" aria-label="主要功能">
        {items.map(({ id, label, Icon }) => (
          <button
            className={`nav-item ${view === id ? 'is-active' : ''}`}
            type="button"
            key={id}
            onClick={() => onViewChange(id)}
            aria-current={view === id ? 'page' : undefined}
          >
            <Icon size={20} weight={view === id ? 'fill' : 'regular'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="account-menu">
        <UserCircle size={20} weight="fill" aria-hidden="true" />
        <strong>{user.username}</strong>
        <button type="button" onClick={onLogout} aria-label="退出登录" title="退出登录">
          <SignOut size={19} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function OrderView({
  step,
  number,
  category,
  selectedGroup,
  extras,
  quantity,
  dishes,
  addOns,
  submitting,
  success,
  submitError,
  unavailableNumbers,
  availableNumbers,
  onStepBack,
  onNumberChange,
  onGroupChange,
  onCategoryChange,
  onExtrasChange,
  onQuantityChange,
  onSubmit,
  onReset,
}) {
  const title = ['选择号码', '选择品类与菜品', '选择小料'][step];
  const availableAddOns = category
    ? addOns.filter((item) => category.allowedAddOnIds?.includes(item.id))
    : [];

  return (
    <main className="order-page">
      <div className="order-workspace">
        <section className="selection-panel" aria-labelledby="selection-title">
          <div className="selection-heading">
            <div>
              <p className="selection-heading__context">当前操作</p>
              <h1 id="selection-title">{title}</h1>
            </div>
            {step > 0 && (
              <button type="button" className="text-action" onClick={onStepBack}>
                <ArrowLeft size={18} aria-hidden="true" />返回上一步
              </button>
            )}
          </div>

          {step === 0 && <NumberGrid value={number} availableNumbers={availableNumbers} unavailableNumbers={unavailableNumbers} onChange={onNumberChange} />}
          {step === 1 && (
            <CategoryDishPicker
              dishes={dishes}
              selectedGroup={selectedGroup}
              value={category}
              onGroupChange={onGroupChange}
              onDishChange={onCategoryChange}
            />
          )}
          {step === 2 && <ExtraGrid items={availableAddOns} value={extras} onChange={onExtrasChange} />}
        </section>

        <OrderSummary
          number={number}
          category={category}
          extras={extras}
          quantity={quantity}
          onQuantityChange={onQuantityChange}
        />
      </div>

      <ActionBar
        step={step}
        number={number}
        category={category}
        extras={extras}
        quantity={quantity}
        submitting={submitting}
        success={success}
        submitError={submitError}
        onSubmit={onSubmit}
        onReset={onReset}
      />
    </main>
  );
}

function NumberGrid({ value, availableNumbers, unavailableNumbers, onChange }) {
  return (
    <div className="number-grid" role="group" aria-label="可用号码">
      {availableNumbers.map((item) => {
        const unavailable = unavailableNumbers.has(item);
        const selected = value === item;
        return (
          <button
            type="button"
            className={`number-token ${selected ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}`}
            key={item}
            disabled={unavailable}
            onClick={() => onChange(item)}
            aria-pressed={selected}
            aria-label={unavailable ? `${item}号使用中` : `${item}号`}
          >
            {unavailable && <LockSimple className="number-token__lock" size={14} weight="bold" aria-hidden="true" />}
            <span className="number-token__value">{String(item).padStart(2, '0')}</span>
            {unavailable && <span className="number-token__state">使用中</span>}
            {selected && <Check className="number-token__check" size={17} weight="bold" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function CategoryDishPicker({ dishes, selectedGroup, value, onGroupChange, onDishChange }) {
  if (!dishes.length) {
    return <div className="selection-empty"><ForkKnife size={42} weight="thin" /><strong>暂无启用菜品</strong><span>请先到“我的”中录入菜品。</span></div>;
  }
  const groups = [...new Set(dishes.map((item) => item.group))];
  const visibleDishes = selectedGroup ? dishes.filter((item) => item.group === selectedGroup) : [];
  return (
    <div className="category-dish-picker">
      <div className="order-category-tabs" role="tablist" aria-label="品类">
        {groups.map((group) => (
          <button type="button" role="tab" aria-selected={selectedGroup === group} className={selectedGroup === group ? 'is-active' : ''} key={group} onClick={() => onGroupChange(group)}>
            <strong>{group}</strong><span>{dishes.filter((item) => item.group === group).length}</span>
          </button>
        ))}
      </div>
      {selectedGroup ? (
        <div className="option-grid dish-options" role="radiogroup" aria-label={`${selectedGroup}菜品`}>
          {visibleDishes.map((item) => {
            const selected = value?.id === item.id;
            return (
              <button type="button" className={`option-card ${selected ? 'is-selected' : ''}`} role="radio" aria-checked={selected} key={item.id} onClick={() => onDishChange(item)}>
                <span className="option-card__copy"><strong>{item.name}</strong>{item.note && <small>{item.note}</small>}</span>
                <span className="option-card__aside"><b>{formatPrice(item.priceCents)}</b><span className="option-card__indicator" aria-hidden="true">{selected && <Check size={18} weight="bold" />}</span></span>
              </button>
            );
          })}
        </div>
      ) : <div className="category-prompt">先选择一个品类，下方会显示菜品。</div>}
    </div>
  );
}

function ExtraGrid({ items, value, onChange }) {
  const toggle = (item) => {
    onChange(value.some((selected) => selected.id === item.id)
      ? value.filter((selected) => selected.id !== item.id)
      : [...value, item]);
  };

  return (
    <div className="option-grid" role="group" aria-label="小料">
      {items.map((item) => {
        const selected = value.some((selectedItem) => selectedItem.id === item.id);
        return (
          <button
            type="button"
            className={`option-card ${selected ? 'is-selected' : ''}`}
            aria-pressed={selected}
            key={item.id}
            onClick={() => toggle(item)}
          >
            <span className="option-card__copy"><strong>{item.name}</strong><small>{formatPrice(item.priceCents)}</small></span>
            <span className="option-card__indicator" aria-hidden="true">{selected && <Check size={18} weight="bold" />}</span>
          </button>
        );
      })}
      {!items.length && <div className="selection-empty selection-empty--compact"><strong>这个菜品没有可选小料</strong><span>可以直接确认下单。</span></div>}
    </div>
  );
}

function ConfirmPanel({ number, category, extras }) {
  const total = (category?.priceCents ?? 0) + extras.reduce((sum, item) => sum + item.priceCents, 0);
  return (
    <div className="confirm-panel">
      <div className="confirm-number"><span>{String(number).padStart(2, '0')}</span><small>号</small></div>
      <div className="confirm-details">
        <div><span>菜品</span><strong>{category?.name}</strong></div>
        <div><span>小料</span><strong>{extras.length ? extras.map((item) => item.name).join('、') : '不加小料'}</strong></div>
        <div><span>合计</span><strong>{formatPrice(total)}</strong></div>
      </div>
    </div>
  );
}

function OrderSummary({ number, category, extras, quantity, onQuantityChange }) {
  const hasSelection = number || category || extras.length;
  const unitTotal = (category?.priceCents ?? 0) + extras.reduce((sum, item) => sum + item.priceCents, 0);
  const total = unitTotal * quantity;
  return (
    <aside className="order-summary" aria-label="当前订单">
      <h2>当前订单</h2>
      {number ? <div className="summary-number"><strong>{String(number).padStart(2, '0')}</strong><span>号</span></div> : <div className="summary-empty-number">未选号码</div>}
      <div className="summary-divider" />
      {hasSelection ? (
        <dl className="summary-list">
          <div><dt>菜品</dt><dd>{category?.name ?? '尚未选择'}</dd></div>
          <div><dt>小料</dt><dd>{extras.length ? extras.map((item) => item.name).join('、') : '未添加'}</dd></div>
          {category && (
            <div className="summary-list__quantity">
              <dt>份数</dt>
              <dd>
                <div className="quantity-stepper" role="group" aria-label="调整菜品份数">
                  <button type="button" disabled={quantity <= 1} onClick={() => onQuantityChange(Math.max(1, quantity - 1))} aria-label="减少一份">
                    <Minus size={17} weight="bold" aria-hidden="true" />
                  </button>
                  <output aria-live="polite" aria-label={`当前 ${quantity} 份`}>{quantity}</output>
                  <button type="button" disabled={quantity >= 99} onClick={() => onQuantityChange(Math.min(99, quantity + 1))} aria-label="增加一份">
                    <Plus size={17} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </dd>
            </div>
          )}
          {category && <div><dt>合计</dt><dd>{formatPrice(total)}</dd></div>}
        </dl>
      ) : (
        <div className="summary-placeholder"><ClipboardText size={46} weight="thin" aria-hidden="true" /><span>从左侧选择号码</span></div>
      )}
    </aside>
  );
}

function ActionBar({ step, number, category, extras, quantity, submitting, success, submitError, onSubmit, onReset }) {
  const unitTotal = (category?.priceCents ?? 0) + extras.reduce((sum, item) => sum + item.priceCents, 0);
  const summary = [number ? `${number}号` : null, category?.name, category ? `${quantity}份` : null, extras.length ? extras.map((item) => item.name).join('、') : null].filter(Boolean).join(' / ');
  return (
    <footer className={`action-bar ${step < 2 ? 'is-auto-flow' : ''}`}>
      <button type="button" className="clear-button" onClick={onReset} disabled={!number && !category && !extras.length}>
        <Trash size={20} aria-hidden="true" />清空选择
      </button>
      <div className={`action-bar__summary ${submitError ? 'is-error' : ''}`} aria-live="polite">{submitError || summary}</div>
      {step === 2 && (
        <button type="button" className={`primary-button ${success ? 'is-success' : ''}`} disabled={submitting || success} onClick={onSubmit}>
          {success ? <><Check size={22} weight="bold" />下单成功</> : submitting ? '正在下单' : <>确认下单 {formatPrice(unitTotal * quantity)}<ArrowRight size={22} weight="bold" /></>}
        </button>
      )}
    </footer>
  );
}

function KitchenView({ queue, onOrderAction, onCategoryAction }) {
  const [pendingId, setPendingId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [batchAction, setBatchAction] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const categoryGroups = useMemo(() => {
    const groups = new Map();
    queue.forEach((item) => {
      const current = groups.get(item.category) ?? { name: item.category, count: 0, waiting: 0, making: 0 };
      current.count += 1;
      current[item.status === 'waiting' ? 'waiting' : 'making'] += 1;
      groups.set(item.category, current);
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [queue]);

  const activeCategory = categoryGroups.some((item) => item.name === selectedCategory) ? selectedCategory : '';
  const activeGroup = categoryGroups.find((item) => item.name === activeCategory);
  const orderedQueue = useMemo(() => [...queue].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [queue]);
  const queuePositionById = useMemo(
    () => new Map(orderedQueue.map((item, index) => [item.id, index + 1])),
    [orderedQueue],
  );
  const visibleQueue = activeCategory ? orderedQueue.filter((item) => item.category === activeCategory) : orderedQueue;

  const actOnOrder = async (item) => {
    setPendingId(item.id);
    await onOrderAction(item.id, item.status === 'waiting' ? 'start' : 'complete');
    setPendingId(null);
  };

  const actOnCategory = async (action) => {
    if (!activeCategory) return;
    setBatchAction(action);
    await onCategoryAction(activeCategory, action);
    setBatchAction(null);
  };

  return (
    <main className="secondary-page">
      <section className="category-controls" aria-label="按品类筛选和批量出餐">
        <div className="category-tabs" role="tablist" aria-label="品类">
          <button type="button" role="tab" aria-selected={!activeCategory} className={!activeCategory ? 'is-active' : ''} onClick={() => setSelectedCategory('')}>
            <span>全部</span><strong>{queue.length}</strong>
          </button>
          {categoryGroups.map((item) => (
            <button type="button" role="tab" aria-selected={item.name === activeCategory} className={item.name === activeCategory ? 'is-active' : ''} key={item.name} onClick={() => setSelectedCategory(item.name)}>
              <span>{item.name}</span><strong>{item.count}</strong>
            </button>
          ))}
        </div>
        {activeGroup && (
          <div className="category-batch-actions">
            <button type="button" className="batch-start-button" disabled={!activeGroup.waiting || batchAction !== null} onClick={() => actOnCategory('start')}>
              {batchAction === 'start' ? '正在开始' : `一键开始制作 ${activeGroup.waiting}`}
            </button>
            <button type="button" className="batch-complete-button" disabled={!activeGroup.making || batchAction !== null} onClick={() => actOnCategory('complete')}>
              {batchAction === 'complete' ? '正在出餐' : `一键出餐 ${activeGroup.making}`}
            </button>
          </div>
        )}
      </section>
      {visibleQueue.length ? (
        <div className="queue-grid">
          {visibleQueue.map((item) => (
            <article className={`queue-card status-${item.status}`} key={item.id}>
              <div className="queue-card__topline">
                <div className="queue-card__number">{String(item.number).padStart(2, '0')}<small>号</small></div>
                <div className="queue-card__facts">
                  <span className="queue-card__position" aria-label={`队列第 ${queuePositionById.get(item.id)} 位`}>
                    {queuePositionById.get(item.id)}
                  </span>
                  <span className="queue-card__metric">
                    <strong>{getOrderQuantity(item)}</strong><small>份</small>
                  </span>
                  <span className="queue-card__metric">
                    <strong>{Math.max(0, Math.floor((now - Date.parse(item.createdAt)) / 60_000))}</strong><small>分钟</small>
                  </span>
                  <span className="queue-card__amount">{formatPrice(getOrderTotalCents(item))}</span>
                </div>
              </div>
              <h2>{item.category}</h2>
              <p>{item.extras?.length ? item.extras.join('、') : '不加小料'}</p>
              <div className="queue-card__action">
                <button type="button" className={item.status === 'waiting' ? 'queue-button' : 'ready-button'} disabled={pendingId === item.id} onClick={() => actOnOrder(item)}>
                  {pendingId === item.id ? '正在更新' : item.status === 'waiting' ? '开始制作' : '完成取餐'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><CookingPot size={54} weight="thin" /><h2>暂无待处理订单</h2></div>
      )}
    </main>
  );
}

function MineView({ dishes, addOns, settings, settingsStatus, onSettingsChange }) {
  const [section, setSection] = useState('dashboard');
  const items = [
    { id: 'dashboard', label: '数据看板', Icon: ChartBar },
    { id: 'dishes', label: '菜品管理', Icon: ForkKnife },
    { id: 'addOns', label: '小料库', Icon: Storefront },
    { id: 'settings', label: '工作台设置', Icon: SlidersHorizontal },
  ];

  return (
    <div className="mine-shell">
      <nav className="mine-nav" aria-label="我的功能">
        {items.map(({ id, label, Icon }) => (
          <button type="button" className={section === id ? 'is-active' : ''} aria-current={section === id ? 'page' : undefined} key={id} onClick={() => setSection(id)}>
            <Icon size={19} weight={section === id ? 'fill' : 'regular'} /><span>{label}</span>
          </button>
        ))}
      </nav>
      {section === 'dashboard' && <DashboardView />}
      {section === 'dishes' && <MenuManagementView key="dishes" dishes={dishes} addOns={addOns} initialMode="dishes" hideModeTabs />}
      {section === 'addOns' && <MenuManagementView key="addOns" dishes={dishes} addOns={addOns} initialMode="addOns" hideModeTabs />}
      {section === 'settings' && <SettingsView settings={settings} status={settingsStatus} onChange={onSettingsChange} />}
    </div>
  );
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function analyticsRange(preset, customFrom, customTo) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (preset === 'custom') {
    const from = new Date(`${customFrom}T00:00:00`);
    const customEnd = new Date(`${customTo}T00:00:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(customEnd.getTime()) || from > customEnd) return null;
    customEnd.setDate(customEnd.getDate() + 1);
    return { from: from.toISOString(), to: customEnd.toISOString() };
  }
  const days = preset === 'today' ? 1 : Number(preset);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
  return { from: from.toISOString(), to: end.toISOString() };
}

function DashboardView() {
  const today = new Date();
  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(toDateInput(today));
  const [customTo, setCustomTo] = useState(toDateInput(today));
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    const range = analyticsRange(preset, customFrom, customTo);
    if (!range) {
      setStatus('error');
      return () => { active = false; };
    }
    getAnalytics(range)
      .then((result) => {
        if (!active) return;
        setData(result);
        setStatus('ready');
      })
      .catch(() => active && setStatus('error'));
    return () => { active = false; };
  }, [preset, customFrom, customTo]);

  const summary = data?.summary ?? { revenueCents: 0, orderCount: 0, averageOrderCents: 0, addOnCount: 0 };
  return (
    <main className="secondary-page dashboard-page">
      <div className="dashboard-filters" role="group" aria-label="统计时间">
        {[['today', '今天'], ['7', '近 7 天'], ['30', '近 30 天'], ['custom', '自定义']].map(([id, label]) => (
          <button type="button" className={preset === id ? 'is-active' : ''} key={id} onClick={() => setPreset(id)}>{label}</button>
        ))}
        {preset === 'custom' && (
          <div className="dashboard-custom-range">
            <label>开始<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label>结束<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label>
          </div>
        )}
      </div>
      {status === 'error' && <div className="dashboard-state">数据读取失败，请稍后重试。</div>}
      {status === 'loading' && <div className="dashboard-state">正在汇总历史订单</div>}
      {status === 'ready' && (
        <>
          <section className="dashboard-metrics" aria-label="经营汇总">
            <div><span>营业额</span><strong>{formatPrice(summary.revenueCents)}</strong></div>
            <div><span>完成订单</span><strong>{summary.orderCount}<small> 单</small></strong></div>
            <div><span>平均客单</span><strong>{formatPrice(summary.averageOrderCents)}</strong></div>
          </section>
          <section className="dashboard-sales" aria-labelledby="dish-sales-title">
            <div className="dashboard-sales-heading">
              <h1 id="dish-sales-title">菜品销售统计</h1>
              <strong>{data.dishes.reduce((total, item) => total + item.count, 0)} 份</strong>
            </div>
            <div className="dashboard-rankings">
              <RankingList title="菜品销量" items={data.dishes} emptyText="所选时间内暂无菜品销售" />
              <RankingList title="品类销量" items={data.categories} />
              <RankingList title="小料销量" items={data.addOns} emptyText="所选时间内没有售出小料" />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function RankingList({ title, items = [], emptyText = '暂无数据' }) {
  return (
    <section className="ranking-panel">
      <h2>{title}</h2>
      {items.length ? <ol>{items.slice(0, 8).map((item, index) => <li key={item.name}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.name}</strong><b>{item.count}</b></li>)}</ol> : <p>{emptyText}</p>}
    </section>
  );
}

function MenuManagementView({ dishes, addOns, initialMode = 'dishes', hideModeTabs = false }) {
  const [mode, setMode] = useState(initialMode);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_DISH_FORM);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const items = mode === 'dishes' ? dishes : addOns;

  useEffect(() => {
    if (!editorOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && status !== 'saving') {
        setEditorOpen(false);
        setEditingId(null);
        setMessage('');
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [editorOpen, status]);

  const resetForm = (nextMode = mode, closeEditor = true) => {
    setEditingId(null);
    setForm(nextMode === 'dishes' ? EMPTY_DISH_FORM : EMPTY_ADD_ON_FORM);
    setMessage('');
    if (closeEditor) setEditorOpen(false);
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    resetForm(nextMode);
  };

  const createItem = () => {
    setEditingId(null);
    setForm(mode === 'dishes' ? EMPTY_DISH_FORM : EMPTY_ADD_ON_FORM);
    setMessage('');
    setEditorOpen(true);
  };

  const editItem = (item) => {
    setEditingId(item.id);
    setForm(mode === 'dishes'
      ? { group: item.group, name: item.name, note: item.note, price: String(item.priceCents / 100), active: item.active, allowedAddOnIds: item.allowedAddOnIds ?? [] }
      : { name: item.name, price: String(item.priceCents / 100), active: item.active });
    setMessage('');
    setEditorOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      setMessage('请输入正确价格。');
      return;
    }
    const payload = { ...form, priceCents: Math.round(price * 100) };
    delete payload.price;
    setStatus('saving');
    setMessage('');
    try {
      const wasEditing = Boolean(editingId);
      if (mode === 'dishes') {
        if (editingId) await updateDish(editingId, payload);
        else await createDish(payload);
      } else if (editingId) await updateAddOn(editingId, payload);
      else await createAddOn(payload);
      setMessage(wasEditing ? '修改已保存。' : '已加入菜单。');
      setEditorOpen(false);
      setEditingId(null);
      setForm(mode === 'dishes' ? EMPTY_DISH_FORM : EMPTY_ADD_ON_FORM);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStatus('idle');
    }
  };

  const toggleItem = async (item) => {
    setStatus('saving');
    setMessage('');
    try {
      if (mode === 'dishes') await updateDish(item.id, { active: !item.active });
      else await updateAddOn(item.id, { active: !item.active });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStatus('idle');
    }
  };

  const removeItem = async (item) => {
    const confirmed = window.confirm(`确认删除“${item.name}”？已下单记录不会受到影响。`);
    if (!confirmed) return;
    setStatus('saving');
    try {
      if (mode === 'dishes') await deleteDish(item.id);
      else await deleteAddOn(item.id);
      setMessage('已删除。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStatus('idle');
    }
  };

  const orderedItems = [...items];
  const dishGroups = orderedItems.reduce((result, item) => {
    const groupName = item.group?.trim() || '未分类';
    const currentGroup = result.find((group) => group.name === groupName);
    if (currentGroup) currentGroup.items.push(item);
    else result.push({ name: groupName, items: [item] });
    return result;
  }, []);
  const groups = [...new Set(dishes.map((item) => item.group))];

  const toggleAllowedAddOn = (id) => {
    const selected = form.allowedAddOnIds ?? [];
    setForm({
      ...form,
      allowedAddOnIds: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    });
  };

  const moveItem = async (item, direction, scopedItems) => {
    const position = scopedItems.findIndex((candidate) => candidate.id === item.id);
    const target = scopedItems[position + direction];
    if (!target) return;
    const nextItems = [...items];
    const sourceIndex = nextItems.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = nextItems.findIndex((candidate) => candidate.id === target.id);
    [nextItems[sourceIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[sourceIndex]];
    setStatus('saving');
    setMessage('');
    try {
      if (mode === 'dishes') await reorderDishes(nextItems.map((candidate) => candidate.id));
      else await reorderAddOns(nextItems.map((candidate) => candidate.id));
      setMessage('顺序已保存。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStatus('idle');
    }
  };

  const renderMenuItem = (item, index, scopedItems) => (
    <article className={item.active ? '' : 'is-inactive'} key={item.id}>
      <div className="menu-order-cell">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div>
          <button type="button" disabled={status === 'saving' || index === 0} onClick={() => moveItem(item, -1, scopedItems)} aria-label={`上移 ${item.name}`}><CaretUp size={15} weight="bold" /></button>
          <button type="button" disabled={status === 'saving' || index === scopedItems.length - 1} onClick={() => moveItem(item, 1, scopedItems)} aria-label={`下移 ${item.name}`}><CaretDown size={15} weight="bold" /></button>
        </div>
      </div>
      <div className="menu-item-copy">
        <strong>{item.name}</strong>
        {mode === 'dishes' && item.note && <span>{item.note}</span>}
        {mode === 'dishes' && <span>{item.allowedAddOnIds?.length ?? 0} 种可选小料</span>}
      </div>
      <b>{formatPrice(item.priceCents)}</b>
      <button type="button" className="menu-status-button" disabled={status === 'saving'} onClick={() => toggleItem(item)}>{item.active ? '已启用' : '已停用'}</button>
      <div className="menu-item-actions">
        <button type="button" onClick={() => editItem(item)} aria-label={`编辑 ${item.name}`}><PencilSimple size={18} /></button>
        <button type="button" onClick={() => removeItem(item)} aria-label={`删除 ${item.name}`}><Trash size={18} /></button>
      </div>
    </article>
  );

  return (
    <main className="secondary-page menu-page">
      {!hideModeTabs && <div className="menu-mode" role="tablist" aria-label="菜单数据类型">
        <button type="button" role="tab" aria-selected={mode === 'dishes'} className={mode === 'dishes' ? 'is-active' : ''} onClick={() => changeMode('dishes')}>菜品 {dishes.length}</button>
        <button type="button" role="tab" aria-selected={mode === 'addOns'} className={mode === 'addOns' ? 'is-active' : ''} onClick={() => changeMode('addOns')}>小料 {addOns.length}</button>
      </div>}
      <section className="menu-list-panel" aria-labelledby="menu-list-title">
        <div className="menu-section-heading menu-list-heading">
          <div><span>{mode === 'dishes' ? '按品类显示' : '小料清单'}</span><h2 id="menu-list-title">{mode === 'dishes' ? '全部菜品' : '全部小料'}</h2></div>
          <div className="menu-list-tools">
            <strong>{items.filter((item) => item.active).length} 启用</strong>
            <button type="button" className="menu-add-button" onClick={createItem}><Plus size={18} weight="bold" />新增{mode === 'dishes' ? '菜品' : '小料'}</button>
          </div>
        </div>
        {!editorOpen && <p className={`menu-page-message ${message.includes('已') ? 'is-success' : ''}`} aria-live="polite">{message}</p>}
        <div className="menu-list">
          {mode === 'dishes'
            ? dishGroups.map((group, groupIndex) => (
              <section className="menu-category-group" key={group.name} aria-labelledby={`menu-category-${groupIndex}`}>
                <div className="menu-category-heading">
                  <h3 id={`menu-category-${groupIndex}`}>{group.name}</h3>
                  <span>{group.items.length} 个菜品</span>
                </div>
                {group.items.map((item, index) => renderMenuItem(item, index, group.items))}
              </section>
            ))
            : orderedItems.map((item, index) => renderMenuItem(item, index, orderedItems))}
          {!orderedItems.length && <div className="menu-empty">还没有数据，点击右上角新增。</div>}
        </div>
      </section>
      {editorOpen && (
        <div className="menu-dialog-layer" onMouseDown={() => status !== 'saving' && resetForm()}>
          <section className={`menu-dialog ${mode === 'addOns' ? 'menu-dialog--compact' : ''}`} role="dialog" aria-modal="true" aria-labelledby="menu-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="menu-dialog-header">
              <div><span>{editingId ? '编辑' : '新增'}</span><h2 id="menu-editor-title">{mode === 'dishes' ? '菜品资料' : '小料资料'}</h2></div>
              <button type="button" disabled={status === 'saving'} onClick={() => resetForm()} aria-label="关闭编辑窗口"><X size={20} /></button>
            </header>
            <form className="menu-form" onSubmit={submit}>
              <div className="menu-form-grid">
                {mode === 'dishes' && (
                  <label>品类<input autoFocus list="dish-groups" value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} placeholder="选择或输入品类" required /><datalist id="dish-groups">{groups.map((group) => <option value={group} key={group} />)}</datalist></label>
                )}
                <label>名称<input autoFocus={mode === 'addOns'} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={mode === 'dishes' ? '例如 锡纸花甲粉/面' : '例如 煎蛋'} required /></label>
                <label>{mode === 'dishes' ? '基础价格（元）' : '小料价格（元）'}<input type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0.00" required /></label>
                {mode === 'dishes' && (
                  <label>说明<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="例如 粉或面任选" /></label>
                )}
              </div>
              {mode === 'dishes' && (
                <fieldset className="addon-library-picker">
                  <legend>可选小料 <span>{form.allowedAddOnIds?.length ?? 0} 项</span></legend>
                  <div>
                    {addOns.map((item) => (
                      <label key={item.id} className={!item.active ? 'is-inactive' : ''}>
                        <input type="checkbox" checked={form.allowedAddOnIds?.includes(item.id) ?? false} onChange={() => toggleAllowedAddOn(item.id)} />
                        <span><strong>{item.name}</strong><small>{formatPrice(item.priceCents)}</small></span>
                      </label>
                    ))}
                    {!addOns.length && <p>请先在“小料库”中添加小料。</p>}
                  </div>
                </fieldset>
              )}
              <label className="menu-active-field"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>{editingId ? '当前启用' : '录入后立即启用'}</span></label>
              <p className={`menu-message ${message.includes('已') ? 'is-success' : ''}`} aria-live="polite">{message}</p>
              <footer className="menu-dialog-actions">
                <button type="button" disabled={status === 'saving'} onClick={() => resetForm()}>取消</button>
                <button type="submit" className="menu-save" disabled={status === 'saving'}>{status === 'saving' ? '正在保存' : editingId ? '保存修改' : `添加${mode === 'dishes' ? '菜品' : '小料'}`}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function SettingsView({ settings, status, onChange }) {
  const availableNumbers = settings.availableNumbers ?? DEFAULT_AVAILABLE_NUMBERS;
  const [newNumber, setNewNumber] = useState('');
  const [rangeEnd, setRangeEnd] = useState(String(Math.max(...availableNumbers)));
  const [numberError, setNumberError] = useState('');

  useEffect(() => setRangeEnd(String(Math.max(...availableNumbers))), [settings.availableNumbers]);

  const addNumber = (event) => {
    event.preventDefault();
    const value = Number(newNumber);
    if (!Number.isInteger(value) || value < 1 || value > 999) return setNumberError('请输入 1 到 999 之间的整数。');
    if (availableNumbers.includes(value)) return setNumberError(`${value} 号已经在清单中。`);
    setNumberError('');
    setNewNumber('');
    return onChange({ availableNumbers: [...availableNumbers, value].sort((a, b) => a - b) });
  };

  const regenerateNumbers = (event) => {
    event.preventDefault();
    const value = Number(rangeEnd);
    if (!Number.isInteger(value) || value < 1 || value > 999) return setNumberError('连续号牌数量需为 1 到 999 之间的整数。');
    setNumberError('');
    return onChange({ availableNumbers: Array.from({ length: value }, (_, index) => index + 1) });
  };

  const removeNumber = (numberToRemove) => {
    if (availableNumbers.length <= 1) return setNumberError('至少需要保留一个号牌。');
    setNumberError('');
    return onChange({ availableNumbers: availableNumbers.filter((item) => item !== numberToRemove) });
  };

  return (
    <main className="secondary-page settings-page settings-page--direct">
      <section className="settings-group" aria-labelledby="sound-setting">
        <div><h2 id="sound-setting">三全音提示</h2><p>有新订单时播放三段短音。</p></div>
        <button type="button" disabled={status === 'saving'} className={`switch ${settings.sound ? 'is-on' : ''}`} role="switch" aria-checked={settings.sound} onClick={() => onChange({ sound: !settings.sound })}>
          <span />{settings.sound ? '已开启' : '已关闭'}
        </button>
      </section>
      <section className="settings-group settings-group--plates" aria-labelledby="number-setting">
        <div className="plate-setting-heading">
          <div><h2 id="number-setting">可用号牌</h2><p>当前共 {availableNumbers.length} 张。丢失的号牌可直接移除，也可以单独补回任意号码。</p></div>
          <strong>{availableNumbers.length}<small> 张</small></strong>
        </div>
        <div className="plate-tools">
          <form onSubmit={regenerateNumbers}>
            <label htmlFor="plate-range">连续号牌</label>
            <div><span>1 至</span><input id="plate-range" type="number" min="1" max="999" inputMode="numeric" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} disabled={status === 'saving'} /><button type="submit" disabled={status === 'saving'}>重新生成</button></div>
            <small>会替换下方当前清单</small>
          </form>
          <form onSubmit={addNumber}>
            <label htmlFor="plate-number">单独添加</label>
            <div><input id="plate-number" type="number" min="1" max="999" inputMode="numeric" placeholder="例如 42" value={newNumber} onChange={(event) => setNewNumber(event.target.value)} disabled={status === 'saving'} /><button type="submit" disabled={status === 'saving'}><Plus size={17} weight="bold" />添加号牌</button></div>
            <small>支持不连续号码</small>
          </form>
        </div>
        <div className="plate-list" aria-label="当前可用号牌">
          {availableNumbers.map((item) => (
            <button type="button" key={item} disabled={status === 'saving' || availableNumbers.length <= 1} onClick={() => removeNumber(item)} aria-label={`移除 ${item} 号牌`} title={`移除 ${item} 号牌`}>
              <strong>{String(item).padStart(2, '0')}</strong><X size={14} weight="bold" />
            </button>
          ))}
        </div>
        <p className="plate-error" aria-live="polite">{numberError}</p>
      </section>
      <p className={`settings-status ${status === 'error' ? 'is-error' : ''}`} aria-live="polite">
        {status === 'saving' ? '正在保存设置' : status === 'saved' ? '设置已同步到所有设备' : status === 'error' ? '保存失败，请检查服务连接' : ''}
      </p>
    </main>
  );
}

export default App;
