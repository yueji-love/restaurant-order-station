import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardText,
  CookingPot,
  GearSix,
  LockSimple,
  Plus,
  SlidersHorizontal,
  Trash,
  X,
} from '@phosphor-icons/react';
import {
  createOrder,
  getState,
  saveSettings,
  subscribeToState,
  updateOrder,
  updateOrdersBatch,
} from './api.js';

const CATEGORIES = [
  { name: '双拼饭', note: '两荤一素' },
  { name: '招牌拌面', note: '现拌现出' },
  { name: '砂锅米线', note: '可选辣度' },
  { name: '鸡腿饭', note: '整只鸡腿' },
  { name: '素食套餐', note: '三素一汤' },
  { name: '儿童餐', note: '少盐少辣' },
];
const EXTRAS = [
  { name: '加辣', note: '正常辣度' },
  { name: '加葱', note: '出餐前加入' },
  { name: '加香菜', note: '出餐前加入' },
  { name: '加卤蛋', note: '+2 元' },
  { name: '少饭', note: '减少三分之一' },
  { name: '不要蒜', note: '制作时留意' },
];
const DEFAULT_AVAILABLE_NUMBERS = Array.from({ length: 36 }, (_, index) => index + 1);
const DEFAULT_SETTINGS = { sortMode: 'time', sound: true, availableNumbers: DEFAULT_AVAILABLE_NUMBERS };

function playOrderSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(740, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  oscillator.addEventListener('ended', () => context.close());
}

function App() {
  const [view, setView] = useState('order');
  const [step, setStep] = useState(0);
  const [number, setNumber] = useState(null);
  const [category, setCategory] = useState(null);
  const [extras, setExtras] = useState([]);
  const [queue, setQueue] = useState([]);
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
    getState()
      .then((state) => {
        if (!active) return;
        setQueue(state.queue);
        setSettings(state.settings);
      })
      .catch(() => {
        if (active) setSyncStatus('error');
      });

    const unsubscribe = subscribeToState({
      onState: (state) => {
        if (!active) return;
        setQueue(state.queue);
        setSettings(state.settings);
      },
      onOpen: () => active && setSyncStatus('connected'),
      onError: () => active && setSyncStatus('error'),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!queueInitialized.current) {
      queueCount.current = queue.length;
      queueInitialized.current = true;
      return;
    }
    if (settings.sound && queue.length > queueCount.current) playOrderSound();
    queueCount.current = queue.length;
  }, [queue, settings.sound]);

  useEffect(() => {
    const availableNumbers = settings.availableNumbers ?? DEFAULT_AVAILABLE_NUMBERS;
    if (number && !availableNumbers.includes(number)) {
      setStep(0);
      setNumber(null);
      setCategory(null);
      setExtras([]);
      setSubmitError('');
    }
  }, [number, settings.availableNumbers]);

  const resetOrder = () => {
    setStep(0);
    setNumber(null);
    setCategory(null);
    setExtras([]);
    setSubmitting(false);
    setSuccess(false);
    setSubmitError('');
  };

  const selectNumber = (nextNumber) => {
    setNumber(nextNumber);
    setStep(1);
  };

  const selectCategory = (nextCategory) => {
    setCategory(nextCategory);
    setStep(2);
  };

  const selectExtras = (nextExtras) => {
    setExtras(nextExtras);
    setStep(3);
  };

  const submitOrder = async () => {
    if (!number || !category || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await createOrder({ number, category: category.name, extras });
      setSubmitting(false);
      setSuccess(true);
      window.setTimeout(resetOrder, 1200);
    } catch (error) {
      setSubmitting(false);
      setSubmitError(error.message);
      if (error.message.includes('使用中') || error.message.includes('未启用')) {
        setNumber(null);
        setCategory(null);
        setExtras([]);
        setStep(0);
      }
    }
  };

  const changeSettings = async (patch) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
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

  return (
    <div className="app-shell">
      <Header view={view} onViewChange={setView} />
      {view === 'order' && (
        <OrderView
          step={step}
          number={number}
          category={category}
          extras={extras}
          submitting={submitting}
          success={success}
          submitError={submitError}
          unavailableNumbers={unavailableNumbers}
          availableNumbers={settings.availableNumbers ?? DEFAULT_AVAILABLE_NUMBERS}
          onStepBack={() => setStep((current) => Math.max(0, current - 1))}
          onNumberChange={selectNumber}
          onCategoryChange={selectCategory}
          onExtrasChange={selectExtras}
          onSubmit={submitOrder}
          onReset={resetOrder}
        />
      )}
      {view === 'kitchen' && (
        <KitchenView
          queue={queue}
          settings={settings}
          onOrderAction={changeOrderStatus}
          onCategoryAction={changeCategoryStatus}
        />
      )}
      {view === 'settings' && (
        <SettingsView settings={settings} status={settingsStatus} onChange={changeSettings} />
      )}
    </div>
  );
}

function Header({ view, onViewChange }) {
  const items = [
    { id: 'order', label: '点单', Icon: ClipboardText },
    { id: 'kitchen', label: '出餐', Icon: CookingPot },
    { id: 'settings', label: '设置', Icon: GearSix },
  ];

  return (
    <header className="topbar">
      <div className="topbar__brand" aria-label="餐厅工作台">
        <span>餐厅工作台</span>
      </div>
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
    </header>
  );
}

function OrderView({
  step,
  number,
  category,
  extras,
  submitting,
  success,
  submitError,
  unavailableNumbers,
  availableNumbers,
  onStepBack,
  onNumberChange,
  onCategoryChange,
  onExtrasChange,
  onSubmit,
  onReset,
}) {
  const title = ['选择号码', '选择品类', '选择小料', '确认订单'][step];

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
                <ArrowLeft size={18} aria-hidden="true" />
                返回上一步
              </button>
            )}
          </div>

          {step === 0 && <NumberGrid value={number} availableNumbers={availableNumbers} unavailableNumbers={unavailableNumbers} onChange={onNumberChange} />}
          {step === 1 && <CategoryGrid value={category} onChange={onCategoryChange} />}
          {step === 2 && <ExtraGrid value={extras} onChange={onExtrasChange} />}
          {step === 3 && (
            <ConfirmPanel number={number} category={category} extras={extras} />
          )}
        </section>

        <OrderSummary number={number} category={category} extras={extras} />
      </div>

      <ActionBar
        step={step}
        number={number}
        category={category}
        extras={extras}
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

function CategoryGrid({ value, onChange }) {
  return (
    <div className="option-grid" role="radiogroup" aria-label="品类">
      {CATEGORIES.map((item) => {
        const selected = value?.name === item.name;
        return (
          <button
            type="button"
            className={`option-card ${selected ? 'is-selected' : ''}`}
            role="radio"
            aria-checked={selected}
            key={item.name}
            onClick={() => onChange(item)}
          >
            <span className="option-card__copy">
              <strong>{item.name}</strong>
              <small>{item.note}</small>
            </span>
            <span className="option-card__indicator" aria-hidden="true">
              {selected && <Check size={18} weight="bold" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExtraGrid({ value, onChange }) {
  const toggle = (name) => {
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
  };

  return (
    <div className="option-grid" role="group" aria-label="小料，可多选">
      <button
        type="button"
        className="option-card option-card--skip"
        onClick={() => onChange([])}
      >
        <span className="option-card__copy">
          <strong>不加小料</strong>
          <small>直接确认订单</small>
        </span>
        <ArrowRight size={22} aria-hidden="true" />
      </button>
      {EXTRAS.map((item) => {
        const selected = value.includes(item.name);
        return (
          <button
            type="button"
            className={`option-card ${selected ? 'is-selected' : ''}`}
            aria-pressed={selected}
            key={item.name}
            onClick={() => toggle(item.name)}
          >
            <span className="option-card__copy">
              <strong>{item.name}</strong>
              <small>{item.note}</small>
            </span>
            <span className="option-card__indicator" aria-hidden="true">
              {selected && <Check size={18} weight="bold" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConfirmPanel({ number, category, extras }) {
  return (
    <div className="confirm-panel">
      <div className="confirm-number">
        <span>{String(number).padStart(2, '0')}</span>
        <small>号</small>
      </div>
      <div className="confirm-details">
        <div>
          <span>品类</span>
          <strong>{category?.name}</strong>
        </div>
        <div>
          <span>小料</span>
          <strong>{extras.length ? extras.join('、') : '不加小料'}</strong>
        </div>
      </div>
      <p>确认无误后直接下单，订单会立即进入出餐队列。</p>
    </div>
  );
}

function OrderSummary({ number, category, extras }) {
  const hasSelection = number || category || extras.length;
  return (
    <aside className="order-summary" aria-label="当前订单">
      <h2>当前订单</h2>
      {number ? (
        <div className="summary-number">
          <strong>{String(number).padStart(2, '0')}</strong>
          <span>号</span>
        </div>
      ) : (
        <div className="summary-empty-number">未选号码</div>
      )}
      <div className="summary-divider" />
      {hasSelection ? (
        <dl className="summary-list">
          <div>
            <dt>品类</dt>
            <dd>{category?.name ?? '尚未选择'}</dd>
          </div>
          <div>
            <dt>小料</dt>
            <dd>{extras.length ? extras.join('、') : '未添加'}</dd>
          </div>
        </dl>
      ) : (
        <div className="summary-placeholder">
          <ClipboardText size={46} weight="thin" aria-hidden="true" />
          <span>从左侧选择号码</span>
        </div>
      )}
    </aside>
  );
}

function ActionBar({ step, number, category, extras, submitting, success, submitError, onSubmit, onReset }) {
  const summary = [
    number ? `${number}号` : null,
    category?.name,
    extras.length ? extras.join('、') : null,
  ].filter(Boolean).join(' / ');

  return (
    <footer className={`action-bar ${step < 3 ? 'is-auto-flow' : ''}`}>
      <button type="button" className="clear-button" onClick={onReset} disabled={!number && !category && !extras.length}>
        <Trash size={20} aria-hidden="true" />
        清空选择
      </button>
      <div className={`action-bar__summary ${submitError ? 'is-error' : ''}`} aria-live="polite">
        {submitError || summary}
      </div>
      {step === 3 && (
        <button
          type="button"
          className={`primary-button ${success ? 'is-success' : ''}`}
          disabled={submitting || success}
          onClick={onSubmit}
        >
          {success ? (
            <><Check size={22} weight="bold" aria-hidden="true" />下单成功</>
          ) : submitting ? (
            '正在下单'
          ) : (
            <>确认下单<ArrowRight size={22} weight="bold" aria-hidden="true" /></>
          )}
        </button>
      )}
    </footer>
  );
}

function KitchenView({ queue, settings, onOrderAction, onCategoryAction }) {
  const [pendingId, setPendingId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [batchAction, setBatchAction] = useState(null);
  const [now, setNow] = useState(Date.now());
  const categoryMode = settings.sortMode === 'category';

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

  const activeCategory = categoryGroups.some((item) => item.name === selectedCategory)
    ? selectedCategory
    : categoryGroups[0]?.name ?? '';
  const activeGroup = categoryGroups.find((item) => item.name === activeCategory);

  const orderedQueue = useMemo(
    () => [...queue].sort((a, b) => {
      if (categoryMode) {
        return a.category.localeCompare(b.category, 'zh-CN') || Date.parse(a.createdAt) - Date.parse(b.createdAt);
      }
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    }),
    [categoryMode, queue],
  );

  const visibleQueue = categoryMode && activeCategory
    ? orderedQueue.filter((item) => item.category === activeCategory)
    : orderedQueue;

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
      <div className="page-heading kitchen-heading">
        <h1>{categoryMode ? '按品类出餐' : '按下单顺序'}</h1>
        <div className="order-count" aria-label={`${queue.length}单待处理`}>
          <strong>{queue.length}</strong>
          <span>单待处理</span>
        </div>
      </div>

      {categoryMode && categoryGroups.length > 0 && (
        <section className="category-controls" aria-label="按品类筛选和批量出餐">
          <div className="category-tabs" role="tablist" aria-label="品类">
            {categoryGroups.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={item.name === activeCategory}
                className={item.name === activeCategory ? 'is-active' : ''}
                key={item.name}
                onClick={() => setSelectedCategory(item.name)}
              >
                <span>{item.name}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          <div className="category-batch-actions">
            <button
              type="button"
              className="batch-start-button"
              disabled={!activeGroup?.waiting || batchAction !== null}
              onClick={() => actOnCategory('start')}
            >
              {batchAction === 'start' ? '正在开始' : `一键开始制作 ${activeGroup?.waiting ?? 0}`}
            </button>
            <button
              type="button"
              className="batch-complete-button"
              disabled={!activeGroup?.making || batchAction !== null}
              onClick={() => actOnCategory('complete')}
            >
              {batchAction === 'complete' ? '正在出餐' : `一键出餐 ${activeGroup?.making ?? 0}`}
            </button>
          </div>
        </section>
      )}

      {visibleQueue.length ? (
        <div className="queue-grid">
          {visibleQueue.map((item) => (
            <article className={`queue-card status-${item.status}`} key={item.id}>
              <div className="queue-card__topline">
                <div className="queue-card__number">{String(item.number).padStart(2, '0')}<small>号</small></div>
                <span>{Math.max(0, Math.floor((now - Date.parse(item.createdAt)) / 60_000))} 分钟</span>
              </div>
              <h2>{item.category}</h2>
              <p>{item.extras.length ? item.extras.join('、') : '不加小料'}</p>
              <div className="queue-card__action">
                <button
                  type="button"
                  className={item.status === 'waiting' ? 'queue-button' : 'ready-button'}
                  disabled={pendingId === item.id}
                  onClick={() => actOnOrder(item)}
                >
                  {pendingId === item.id
                    ? '正在更新'
                    : item.status === 'waiting' ? '开始制作' : '完成取餐'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <CookingPot size={52} weight="thin" aria-hidden="true" />
          <h2>当前没有待处理订单</h2>
          <p>新订单会自动出现在这里。</p>
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

  useEffect(() => {
    setRangeEnd(String(Math.max(...availableNumbers)));
  }, [settings.availableNumbers]);

  const addNumber = (event) => {
    event.preventDefault();
    const value = Number(newNumber);
    if (!Number.isInteger(value) || value < 1 || value > 999) {
      setNumberError('请输入 1 到 999 之间的整数。');
      return;
    }
    if (availableNumbers.includes(value)) {
      setNumberError(`${value} 号已经在清单中。`);
      return;
    }
    setNumberError('');
    setNewNumber('');
    onChange({ availableNumbers: [...availableNumbers, value].sort((a, b) => a - b) });
  };

  const regenerateNumbers = (event) => {
    event.preventDefault();
    const value = Number(rangeEnd);
    if (!Number.isInteger(value) || value < 1 || value > 999) {
      setNumberError('连续号牌数量需为 1 到 999 之间的整数。');
      return;
    }
    setNumberError('');
    onChange({ availableNumbers: Array.from({ length: value }, (_, index) => index + 1) });
  };

  const removeNumber = (numberToRemove) => {
    if (availableNumbers.length <= 1) {
      setNumberError('至少需要保留一个号牌。');
      return;
    }
    setNumberError('');
    onChange({ availableNumbers: availableNumbers.filter((item) => item !== numberToRemove) });
  };

  return (
    <main className="secondary-page settings-page">
      <div className="page-heading">
        <div>
          <p>门店设置</p>
          <h1>工作台设置</h1>
        </div>
        <SlidersHorizontal size={28} aria-hidden="true" />
      </div>
      <section className="settings-group" aria-labelledby="queue-setting">
        <div>
          <h2 id="queue-setting">出餐排序</h2>
          <p>决定出餐页面默认如何排列订单。</p>
        </div>
        <div className="segmented-control" role="radiogroup" aria-label="出餐排序">
          <button type="button" role="radio" disabled={status === 'saving'} aria-checked={settings.sortMode === 'time'} className={settings.sortMode === 'time' ? 'is-active' : ''} onClick={() => onChange({ sortMode: 'time' })}>下单顺序</button>
          <button type="button" role="radio" disabled={status === 'saving'} aria-checked={settings.sortMode === 'category'} className={settings.sortMode === 'category' ? 'is-active' : ''} onClick={() => onChange({ sortMode: 'category' })}>按品类</button>
        </div>
      </section>
      <section className="settings-group" aria-labelledby="sound-setting">
        <div>
          <h2 id="sound-setting">新订单提示音</h2>
          <p>有新订单时播放一次简短提示音。</p>
        </div>
        <button type="button" disabled={status === 'saving'} className={`switch ${settings.sound ? 'is-on' : ''}`} role="switch" aria-checked={settings.sound} onClick={() => onChange({ sound: !settings.sound })}>
          <span />
          {settings.sound ? '已开启' : '已关闭'}
        </button>
      </section>
      <section className="settings-group settings-group--plates" aria-labelledby="number-setting">
        <div className="plate-setting-heading">
          <div>
            <h2 id="number-setting">可用号牌</h2>
            <p>当前共 {availableNumbers.length} 张。丢失的号牌可直接移除，也可以单独补回任意号码。</p>
          </div>
          <strong>{availableNumbers.length}<small> 张</small></strong>
        </div>

        <div className="plate-tools">
          <form onSubmit={regenerateNumbers}>
            <label htmlFor="plate-range">连续号牌</label>
            <div>
              <span>1 —</span>
              <input
                id="plate-range"
                type="number"
                min="1"
                max="999"
                inputMode="numeric"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
                disabled={status === 'saving'}
              />
              <button type="submit" disabled={status === 'saving'}>重新生成</button>
            </div>
            <small>会替换下方当前清单</small>
          </form>

          <form onSubmit={addNumber}>
            <label htmlFor="plate-number">单独添加</label>
            <div>
              <input
                id="plate-number"
                type="number"
                min="1"
                max="999"
                inputMode="numeric"
                placeholder="例如 42"
                value={newNumber}
                onChange={(event) => setNewNumber(event.target.value)}
                disabled={status === 'saving'}
              />
              <button type="submit" disabled={status === 'saving'}>
                <Plus size={17} weight="bold" aria-hidden="true" />
                添加号牌
              </button>
            </div>
            <small>支持不连续号码</small>
          </form>
        </div>

        <div className="plate-list" aria-label="当前可用号牌">
          {availableNumbers.map((item) => (
            <button
              type="button"
              key={item}
              disabled={status === 'saving' || availableNumbers.length <= 1}
              onClick={() => removeNumber(item)}
              aria-label={`移除 ${item} 号牌`}
              title={`移除 ${item} 号牌`}
            >
              <strong>{String(item).padStart(2, '0')}</strong>
              <X size={14} weight="bold" aria-hidden="true" />
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
