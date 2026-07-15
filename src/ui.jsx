import { useEffect } from 'react';
import { Check, X } from '@phosphor-icons/react';

export function money(cents = 0, fixed = false) {
  const value = (Number(cents) || 0) / 100;
  return `¥${value.toFixed(fixed || value % 1 ? 2 : 0)}`;
}

export function dateTime(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value)) : '-';
}

export function waitMinutes(value) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
}

export function moveItem(items, index, offset) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StatusPill({ status, active }) {
  const normalized = active === true ? 'active' : active === false ? 'inactive' : status;
  const labels = { waiting: '待制作', making: '制作中', completed: '已完成', settled: '已结算', active: '已启用', inactive: '已停用' };
  return <span className={`status-pill status-${normalized}`}>{normalized === 'completed' && <Check weight="bold" />}{labels[normalized] || normalized}</span>;
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button></header>
        {children}
      </section>
    </div>
  );
}

export function Drawer({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    document.body.classList.add('drawer-open');
    return () => {
      window.removeEventListener('keydown', close);
      document.body.classList.remove('drawer-open');
    };
  }, [onClose]);
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`drawer ${wide ? 'drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button></header>
        {children}
      </section>
    </div>
  );
}
