import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardText,
  CookingPot,
  GearSix,
  LockSimple,
  SlidersHorizontal,
  Trash,
} from '@phosphor-icons/react';

const STEPS = ['选号码', '选品类', '选小料', '确认'];
const UNAVAILABLE_NUMBERS = new Set([3, 11, 21, 28]);
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
const INITIAL_QUEUE = [
  { id: 1, number: 12, category: '双拼饭', extras: ['加辣'], status: 'waiting', minutes: 3 },
  { id: 2, number: 7, category: '砂锅米线', extras: ['不要蒜'], status: 'making', minutes: 7 },
  { id: 3, number: 23, category: '鸡腿饭', extras: [], status: 'ready', minutes: 9 },
];

function App() {
  const [view, setView] = useState('order');
  const [step, setStep] = useState(0);
  const [number, setNumber] = useState(null);
  const [category, setCategory] = useState(null);
  const [extras, setExtras] = useState([]);
  const [queue, setQueue] = useState(INITIAL_QUEUE);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetOrder = () => {
    setStep(0);
    setNumber(null);
    setCategory(null);
    setExtras([]);
    setSubmitting(false);
    setSuccess(false);
  };

  const next = () => {
    if (step === 0 && number) setStep(1);
    if (step === 1 && category) setStep(2);
    if (step === 2) setStep(3);
  };

  const submitOrder = () => {
    if (!number || !category || submitting) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setQueue((current) => [
        ...current,
        {
          id: Date.now(),
          number,
          category: category.name,
          extras,
          status: 'waiting',
          minutes: 0,
        },
      ]);
      setSubmitting(false);
      setSuccess(true);
      window.setTimeout(resetOrder, 1200);
    }, 650);
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
          onStepBack={() => setStep((current) => Math.max(0, current - 1))}
          onNumberChange={setNumber}
          onCategoryChange={setCategory}
          onExtrasChange={setExtras}
          onNext={next}
          onSubmit={submitOrder}
          onReset={resetOrder}
        />
      )}
      {view === 'kitchen' && <KitchenView queue={queue} onQueueChange={setQueue} />}
      {view === 'settings' && <SettingsView />}
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
      <div className="topbar__shift">午市</div>
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
  onStepBack,
  onNumberChange,
  onCategoryChange,
  onExtrasChange,
  onNext,
  onSubmit,
  onReset,
}) {
  const title = ['选择号码', '选择品类', '选择小料', '确认订单'][step];

  return (
    <main className="order-page">
      <Progress step={step} />
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

          {step === 0 && <NumberGrid value={number} onChange={onNumberChange} />}
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
        onNext={onNext}
        onSubmit={onSubmit}
        onReset={onReset}
      />
    </main>
  );
}

function Progress({ step }) {
  return (
    <ol className="progress" aria-label="点单进度">
      {STEPS.map((label, index) => {
        const complete = index < step;
        const active = index === step;
        return (
          <li className={`progress__item ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`} key={label}>
            <span className="progress__marker" aria-hidden="true">
              {complete ? <Check size={16} weight="bold" /> : index + 1}
            </span>
            <span className="progress__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function NumberGrid({ value, onChange }) {
  return (
    <div className="number-grid" role="group" aria-label="可用号码">
      {Array.from({ length: 36 }, (_, index) => index + 1).map((item) => {
        const unavailable = UNAVAILABLE_NUMBERS.has(item);
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

function ActionBar({ step, number, category, extras, submitting, success, onNext, onSubmit, onReset }) {
  const canContinue = step === 0 ? Boolean(number) : step === 1 ? Boolean(category) : true;
  const labels = ['下一步  选品类', '下一步  选小料', '下一步  确认', '确认下单'];
  const summary = [
    number ? `${number}号` : null,
    category?.name,
    extras.length ? extras.join('、') : null,
  ].filter(Boolean).join(' / ');

  return (
    <footer className="action-bar">
      <button type="button" className="clear-button" onClick={onReset} disabled={!number && !category && !extras.length}>
        <Trash size={20} aria-hidden="true" />
        清空选择
      </button>
      <div className="action-bar__summary" aria-live="polite">{summary || '请选择号码开始点单'}</div>
      <button
        type="button"
        className={`primary-button ${success ? 'is-success' : ''}`}
        disabled={!canContinue || submitting || success}
        onClick={step === 3 ? onSubmit : onNext}
      >
        {success ? (
          <><Check size={22} weight="bold" aria-hidden="true" />下单成功</>
        ) : submitting ? (
          '正在下单'
        ) : (
          <>{labels[step]}<ArrowRight size={22} weight="bold" aria-hidden="true" /></>
        )}
      </button>
    </footer>
  );
}

function KitchenView({ queue, onQueueChange }) {
  const orderedQueue = useMemo(
    () => [...queue].sort((a, b) => a.id - b.id),
    [queue],
  );

  const advance = (id) => {
    onQueueChange((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (item.status === 'waiting') return { ...item, status: 'making' };
      if (item.status === 'making') return { ...item, status: 'ready' };
      return item;
    }));
  };

  const remove = (id) => onQueueChange((current) => current.filter((item) => item.id !== id));

  return (
    <main className="secondary-page">
      <div className="page-heading">
        <div>
          <p>按下单顺序</p>
          <h1>出餐队列</h1>
        </div>
        <span>{queue.length} 单待处理</span>
      </div>
      {orderedQueue.length ? (
        <div className="queue-grid">
          {orderedQueue.map((item) => (
            <article className={`queue-card status-${item.status}`} key={item.id}>
              <div className="queue-card__topline">
                <div className="queue-card__number">{String(item.number).padStart(2, '0')}<small>号</small></div>
                <span>{item.minutes} 分钟</span>
              </div>
              <h2>{item.category}</h2>
              <p>{item.extras.length ? item.extras.join('、') : '不加小料'}</p>
              <div className="queue-card__action">
                {item.status === 'ready' ? (
                  <button type="button" className="ready-button" onClick={() => remove(item.id)}>完成取餐</button>
                ) : (
                  <button type="button" className="queue-button" onClick={() => advance(item.id)}>
                    {item.status === 'waiting' ? '开始制作' : '通知取餐'}
                  </button>
                )}
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

function SettingsView() {
  const [sortMode, setSortMode] = useState('time');
  const [sound, setSound] = useState(true);

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
          <button type="button" role="radio" aria-checked={sortMode === 'time'} className={sortMode === 'time' ? 'is-active' : ''} onClick={() => setSortMode('time')}>下单顺序</button>
          <button type="button" role="radio" aria-checked={sortMode === 'category'} className={sortMode === 'category' ? 'is-active' : ''} onClick={() => setSortMode('category')}>按品类</button>
        </div>
      </section>
      <section className="settings-group" aria-labelledby="sound-setting">
        <div>
          <h2 id="sound-setting">新订单提示音</h2>
          <p>有新订单时播放一次简短提示音。</p>
        </div>
        <button type="button" className={`switch ${sound ? 'is-on' : ''}`} role="switch" aria-checked={sound} onClick={() => setSound((current) => !current)}>
          <span />
          {sound ? '已开启' : '已关闭'}
        </button>
      </section>
    </main>
  );
}

export default App;
