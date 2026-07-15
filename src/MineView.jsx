import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChartBar, DownloadSimple, ForkKnife, Gear, PencilSimple, Plus, QrCode, Storefront, Trash, UploadSimple,
} from '@phosphor-icons/react';
import {
  createAddOn, createCategory, createDish, deleteAddOn, deleteDish, deletePaymentQr, downloadOrderExport, getAnalytics,
  reorderAddOns, reorderCategories, reorderDishes, saveSettings, updateAddOn, updateCategory, updateDish, uploadPaymentQr,
} from './api.js';
import { Modal, money, moveItem, saveBlob, StatusPill } from './ui.jsx';

function AnalyticsPanel() {
  const [days, setDays] = useState(7);
  const [analytics, setAnalytics] = useState(null);
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => ({ from: new Date(Date.now() - days * 86400000).toISOString(), to: new Date(Date.now() + 1000).toISOString() }), [days]);
  useEffect(() => { getAnalytics(range).then(setAnalytics).catch(() => setAnalytics(null)); }, [range]);
  async function exportData(format) {
    setBusy(true);
    try { const result = await downloadOrderExport({ ...range, format }); saveBlob(result.blob, result.filename); } finally { setBusy(false); }
  }
  return <section className="mine-panel analytics-panel">
    <div className="panel-toolbar"><div className="segmented">{[1, 7, 30].map((value) => <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{value === 1 ? '今天' : `近 ${value} 天`}</button>)}</div><div className="export-buttons"><button onClick={() => exportData('csv')} disabled={busy}><DownloadSimple />CSV</button><button onClick={() => exportData('json')} disabled={busy}><DownloadSimple />JSON</button></div></div>
    <div className="metric-grid"><div><span>营业额</span><strong className="green">{money(analytics?.summary.revenueCents, true)}</strong></div><div><span>结算账单</span><strong>{analytics?.summary.orderCount || 0}<small>单</small></strong></div><div><span>售出菜品</span><strong>{analytics?.summary.dishCount || 0}<small>份</small></strong></div><div><span>平均客单</span><strong>{money(analytics?.summary.averageOrderCents, true)}</strong></div></div>
    <div className="sales-table"><header><h2>菜品销售</h2><span>按份数排序</span></header>{analytics?.dishes.length ? analytics.dishes.map((item, index) => <div key={item.name}><i>{index + 1}</i><span>{item.name}</span><b>{item.count} 份</b></div>) : <div className="empty-compact">这个时间段还没有已结算数据</div>}</div>
  </section>;
}

function DishForm({ initial, state, onSave, onClose }) {
  const [form, setForm] = useState(initial ? { ...initial } : { categoryId: state.categories[0]?.id || '', name: '', note: '', active: true, allowedAddOnIds: [] });
  const [price, setPrice] = useState(initial ? (initial.priceCents / 100).toFixed(2) : '');
  async function submit(event) { event.preventDefault(); const ok = await onSave({ ...form, priceCents: Math.round(Number(price) * 100) }); if (ok) onClose(); }
  return <form className="editor-form" onSubmit={submit}>
    <label>品类<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{state.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>名称<input required maxLength="60" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
    <div className="form-row"><label>基础价格（元）<input required min="0" step="0.01" type="number" value={price} onChange={(event) => setPrice(event.target.value)} /></label><label>状态<select value={form.active ? '1' : '0'} onChange={(event) => setForm({ ...form, active: event.target.value === '1' })}><option value="1">启用</option><option value="0">停用</option></select></label></div>
    <label>说明<input maxLength="100" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
    <fieldset><legend>可选小料 · {form.allowedAddOnIds.length} 项</legend><div className="checkbox-grid">{state.addOns.map((item) => <label key={item.id}><input type="checkbox" checked={form.allowedAddOnIds.includes(item.id)} onChange={() => setForm({ ...form, allowedAddOnIds: form.allowedAddOnIds.includes(item.id) ? form.allowedAddOnIds.filter((id) => id !== item.id) : [...form.allowedAddOnIds, item.id] })} /><span>{item.name}</span><small>{money(item.priceCents)}</small></label>)}</div></fieldset>
    <button className="primary-button">保存菜品</button>
  </form>;
}

function MenuPanel({ state, run }) {
  const [editing, setEditing] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const grouped = state.categories.map((category) => ({ category, dishes: state.dishes.filter((dish) => dish.categoryId === category.id) }));
  async function reorderDish(index, offset) { return run(() => reorderDishes(moveItem(state.dishes, index, offset).map((item) => item.id)), '菜品顺序已更新'); }
  async function reorderCategory(index, offset) { return run(() => reorderCategories(moveItem(state.categories, index, offset).map((item) => item.id)), '品类顺序已更新'); }
  async function saveCategory(event) {
    event.preventDefault();
    const ok = editingCategory
      ? await run(() => updateCategory(editingCategory.id, { name: categoryName }), '品类已更新')
      : await run(() => createCategory({ name: categoryName }), '品类已添加');
    if (ok) { setCategoryName(''); setEditingCategory(null); }
  }
  return <section className="mine-panel management-panel">
    <div className="panel-toolbar"><h1>菜品管理</h1><button className="dark-button" onClick={() => setEditing({ type: 'create' })}><Plus />新增菜品</button></div>
    <form className="category-editor" onSubmit={saveCategory}><input placeholder="新增品类" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /><button>{editingCategory ? '保存名称' : '添加品类'}</button>{editingCategory && <button type="button" onClick={() => { setEditingCategory(null); setCategoryName(''); }}>取消</button>}</form>
    <div className="category-list">{grouped.map(({ category, dishes }, categoryIndex) => <section key={category.id}>
      <header><div><h2>{category.name}</h2><span>{dishes.length} 个菜品</span></div><div className="row-actions"><button aria-label={`${category.name} 上移`} disabled={!categoryIndex} onClick={() => reorderCategory(categoryIndex, -1)}><ArrowUp /></button><button aria-label={`${category.name} 下移`} disabled={categoryIndex === grouped.length - 1} onClick={() => reorderCategory(categoryIndex, 1)}><ArrowDown /></button><button aria-label={`编辑品类 ${category.name}`} onClick={() => { setEditingCategory(category); setCategoryName(category.name); }}><PencilSimple /></button></div></header>
      <div className="management-rows">{dishes.map((dish) => { const index = state.dishes.findIndex((item) => item.id === dish.id); return <div key={dish.id}><section><strong>{dish.name}</strong><small>{dish.note || '无说明'} · {dish.allowedAddOnIds.length} 种可选小料</small></section><b>{money(dish.priceCents)}</b><StatusPill active={dish.active} /><div className="row-actions"><button aria-label={`${dish.name} 上移`} disabled={!index} onClick={() => reorderDish(index, -1)}><ArrowUp /></button><button aria-label={`${dish.name} 下移`} disabled={index === state.dishes.length - 1} onClick={() => reorderDish(index, 1)}><ArrowDown /></button><button aria-label={`编辑菜品 ${dish.name}`} onClick={() => setEditing({ type: 'edit', item: dish })}><PencilSimple /></button><button aria-label={`删除菜品 ${dish.name}`} onClick={() => run(() => deleteDish(dish.id), '菜品已删除')}><Trash /></button></div></div>; })}</div>
    </section>)}</div>
    {editing && <Modal title={editing.type === 'create' ? '新增菜品' : '编辑菜品'} onClose={() => setEditing(null)}><DishForm initial={editing.item} state={state} onClose={() => setEditing(null)} onSave={(body) => run(() => editing.type === 'create' ? createDish(body) : updateDish(editing.item.id, body), '菜品已保存')} /></Modal>}
  </section>;
}

function AddOnForm({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [price, setPrice] = useState(initial ? (initial.priceCents / 100).toFixed(2) : '');
  const [active, setActive] = useState(initial?.active ?? true);
  async function submit(event) { event.preventDefault(); const ok = await onSave({ name, priceCents: Math.round(Number(price) * 100), active }); if (ok) onClose(); }
  return <form className="editor-form" onSubmit={submit}><label>名称<input required maxLength="40" value={name} onChange={(event) => setName(event.target.value)} /></label><label>价格（元）<input required type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label><label>状态<select value={active ? '1' : '0'} onChange={(event) => setActive(event.target.value === '1')}><option value="1">启用</option><option value="0">停用</option></select></label><button className="primary-button">保存小料</button></form>;
}

function AddOnPanel({ state, run }) {
  const [editing, setEditing] = useState(null);
  async function reorder(index, offset) { return run(() => reorderAddOns(moveItem(state.addOns, index, offset).map((item) => item.id)), '小料顺序已更新'); }
  return <section className="mine-panel management-panel"><div className="panel-toolbar"><h1>小料库</h1><button className="dark-button" onClick={() => setEditing({ type: 'create' })}><Plus />新增小料</button></div><div className="management-rows standalone">{state.addOns.map((item, index) => <div key={item.id}><section><strong>{item.name}</strong><small>{item.active ? '点菜时可选' : '已停用'}</small></section><b>{money(item.priceCents)}</b><div className="row-actions"><button aria-label={`${item.name} 上移`} disabled={!index} onClick={() => reorder(index, -1)}><ArrowUp /></button><button aria-label={`${item.name} 下移`} disabled={index === state.addOns.length - 1} onClick={() => reorder(index, 1)}><ArrowDown /></button><button aria-label={`编辑小料 ${item.name}`} onClick={() => setEditing({ type: 'edit', item })}><PencilSimple /></button><button aria-label={`删除小料 ${item.name}`} onClick={() => run(() => deleteAddOn(item.id), '小料已删除')}><Trash /></button></div></div>)}</div>{editing && <Modal title={editing.type === 'create' ? '新增小料' : '编辑小料'} onClose={() => setEditing(null)}><AddOnForm initial={editing.item} onClose={() => setEditing(null)} onSave={(body) => run(() => editing.type === 'create' ? createAddOn(body) : updateAddOn(editing.item.id, body), '小料已保存')} /></Modal>}</section>;
}

function SettingsPanel({ state, run }) {
  const [numbers, setNumbers] = useState(state.settings.availableNumbers.join('、'));
  useEffect(() => setNumbers(state.settings.availableNumbers.join('、')), [state.settings.availableNumbers]);
  const parsedNumbers = [...new Set(numbers.split(/[^0-9]+/).map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= 999))].sort((a, b) => a - b);
  async function upload(event) { const file = event.target.files?.[0]; if (file) await run(() => uploadPaymentQr(file), '收款码已更新'); event.target.value = ''; }
  return <section className="mine-panel settings-panel">
    <div className="settings-row"><div><h2>三全音提示</h2><p>有新菜品任务时播放提示音。</p></div><button className={`toggle ${state.settings.sound ? 'active' : ''}`} onClick={() => run(() => saveSettings({ sound: !state.settings.sound }), '设置已保存')}><i />{state.settings.sound ? '已开启' : '已关闭'}</button></div>
    <div className="settings-block"><header><div><h2>可用号牌</h2><p>支持不连续号码；有未结算账单的号牌不能移除。</p></div><strong>{state.numberPlates.length}<small>张</small></strong></header><textarea value={numbers} onChange={(event) => setNumbers(event.target.value)} placeholder="例如：1、2、3、8、12" /><button className="dark-button" disabled={!parsedNumbers.length} onClick={() => run(() => saveSettings({ availableNumbers: parsedNumbers }), '号牌已更新')}>保存号牌</button></div>
    <div className="settings-block"><header><div><h2>号牌二维码</h2><p>打印后贴在号牌背面；二维码长期有效。</p></div><QrCode size={30} /></header><div className="qr-download-grid">{state.numberPlates.map((plate) => <a key={plate.id} href={`/api/number-plates/${plate.id}/qr.svg`} download><QrCode /><span>{String(plate.number).padStart(2, '0')} 号</span><DownloadSimple /></a>)}</div></div>
    <div className="settings-block"><header><div><h2>商家收款码</h2><p>顾客扫码查看进度时显示在页面底部。</p></div>{state.settings.paymentQrConfigured && <StatusPill active />}</header>{state.settings.paymentQrConfigured && <img className="payment-preview" src="/api/settings/payment-qr" alt="当前收款码" />}<div className="payment-actions"><label className="dark-button"><UploadSimple />{state.settings.paymentQrConfigured ? '更换收款码' : '上传收款码'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} hidden /></label>{state.settings.paymentQrConfigured && <button className="light-button" onClick={() => run(deletePaymentQr, '收款码已移除')}><Trash />移除</button>}</div></div>
  </section>;
}

export default function MineView({ state, run }) {
  const [tab, setTab] = useState('analytics');
  const tabs = [{ id: 'analytics', label: '数据看板', icon: ChartBar }, { id: 'menu', label: '菜品管理', icon: ForkKnife }, { id: 'addons', label: '小料库', icon: Storefront }, { id: 'settings', label: '工作台设置', icon: Gear }];
  return <div className="mine-shell"><nav className="mine-tabs">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav><main className="page mine-page">{tab === 'analytics' && <AnalyticsPanel />}{tab === 'menu' && <MenuPanel state={state} run={run} />}{tab === 'addons' && <AddOnPanel state={state} run={run} />}{tab === 'settings' && <SettingsPanel state={state} run={run} />}</main></div>;
}
