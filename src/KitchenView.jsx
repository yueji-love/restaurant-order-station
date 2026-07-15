import { useEffect, useMemo, useState } from 'react';
import { CookingPot } from '@phosphor-icons/react';
import { updateKitchenBatch, updateKitchenTask } from './api.js';
import { waitMinutes } from './ui.jsx';

export default function KitchenView({ state, run }) {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dishFilter, setDishFilter] = useState('all');
  const tasks = state.queue;
  const categoryGroups = useMemo(() => state.categories.map((category) => ({
    id: category.id, name: category.name, count: tasks.filter((task) => task.dishGroup === category.name).length,
  })).filter((item) => item.count), [state.categories, tasks]);
  const categoryTasks = categoryFilter === 'all' ? tasks : tasks.filter((task) => task.dishGroup === categoryFilter);
  const dishGroups = useMemo(() => state.dishes.map((dish) => ({
    id: dish.id, name: dish.name, count: tasks.filter((task) => task.sourceDishId === dish.id).length,
  })).filter((item) => item.count && (categoryFilter === 'all' || tasks.some((task) => task.sourceDishId === item.id && task.dishGroup === categoryFilter))), [categoryFilter, state.dishes, tasks]);
  const filtered = dishFilter === 'all' ? categoryTasks : categoryTasks.filter((task) => task.sourceDishId === dishFilter);
  const waiting = filtered.filter((item) => item.status === 'waiting');
  const making = filtered.filter((item) => item.status === 'making');
  const waitingPositions = new Map(tasks.filter((item) => item.status === 'waiting').map((item, index) => [item.id, index + 1]));

  useEffect(() => { if (categoryFilter !== 'all' && !categoryGroups.some((item) => item.name === categoryFilter)) setCategoryFilter('all'); }, [categoryFilter, categoryGroups]);
  useEffect(() => { if (dishFilter !== 'all' && !dishGroups.some((item) => item.id === dishFilter)) setDishFilter('all'); }, [dishFilter, dishGroups]);
  async function batch(action) {
    if (dishFilter !== 'all') await run(() => updateKitchenBatch(dishFilter, action), action === 'start' ? '已批量开始制作' : '已批量完成制作');
  }
  return (
    <main className="page kitchen-page">
      <div className="kitchen-filters">
        <div className="filter-strip filter-strip--categories" aria-label="品类筛选"><button className={categoryFilter === 'all' ? 'active' : ''} onClick={() => { setCategoryFilter('all'); setDishFilter('all'); }}>全部 <b>{tasks.length}</b></button>{categoryGroups.map((item) => <button key={item.id} className={categoryFilter === item.name ? 'active' : ''} onClick={() => { setCategoryFilter(item.name); setDishFilter('all'); }}>{item.name}<b>{item.count}</b></button>)}</div>
        <div className="filter-strip filter-strip--dishes" aria-label="菜品筛选">{dishGroups.map((item) => <button key={item.id} className={dishFilter === item.id ? 'active' : ''} onClick={() => setDishFilter(dishFilter === item.id ? 'all' : item.id)}>{item.name}<b>{item.count}</b></button>)}</div>
      </div>
      {dishFilter !== 'all' && <div className="batch-bar"><button className="dark-button" disabled={!waiting.length} onClick={() => batch('start')}>一键开始制作 {waiting.length}</button><button className="light-button" disabled={!making.length} onClick={() => batch('complete')}>一键完成制作 {making.length}</button></div>}
      {filtered.length ? <div className="queue-grid">{filtered.map((task) => <article key={task.id} className={`queue-card ${task.status}`}>
        <div className="queue-card__head"><div className="plate-number"><strong>{String(task.number).padStart(2, '0')}</strong><span>号</span></div><div className="task-metrics"><b>{task.quantity}<small>份</small></b><b>{waitMinutes(task.createdAt)}<small>分钟</small></b>{task.status === 'waiting' && <i title="排队位置">{waitingPositions.get(task.id)}</i>}</div></div>
        <div className="queue-card__dish"><h2>{task.dishName}</h2><p>{task.extras.join('、') || '不加小料'}</p></div>
        <button className={task.status === 'waiting' ? 'dark-button' : 'complete-button'} onClick={() => run(() => updateKitchenTask(task.id, task.status === 'waiting' ? 'start' : 'complete'), task.status === 'waiting' ? '已开始制作' : '已完成制作')}>{task.status === 'waiting' ? '开始制作' : '完成制作'}</button>
      </article>)}</div> : <div className="empty-page"><CookingPot size={50} /><h2>暂时没有待处理菜品</h2></div>}
    </main>
  );
}
