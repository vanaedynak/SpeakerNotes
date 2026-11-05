import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../store';

export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
  className,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean | 'full';
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide === 'full' ? 'full' : wide ? 'wide' : ''} ${className ?? ''}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1700);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className={'toast' + (show ? ' show' : '')}>{toast.text}</div>;
}

// ---------- свой prompt() (в Electron стандартного нет) ----------
interface AskState {
  q: null | { title: string; value: string; multiline?: boolean; resolve: (v: string | null) => void; confirmOnly?: boolean; danger?: boolean };
}
const useAsk = create<AskState>(() => ({ q: null }));

export function askText(title: string, value = '', multiline = false): Promise<string | null> {
  return new Promise((resolve) => useAsk.setState({ q: { title, value, multiline, resolve } }));
}

export function confirmBox(title: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => useAsk.setState({ q: { title, value: '', confirmOnly: true, danger, resolve: (v) => resolve(v !== null) } }));
}

export function AskDialog() {
  const q = useAsk((s) => s.q);
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (q) {
      setV(q.value);
      setTimeout(() => {
        ref.current?.focus();
        ref.current?.select();
      }, 30);
    }
  }, [q]);
  if (!q) return null;
  const done = (val: string | null) => {
    q.resolve(val);
    useAsk.setState({ q: null });
  };
  return (
    <Modal
      title={q.title}
      onClose={() => done(null)}
      className="ask"
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>
            Отмена
          </button>
          <button className={'btn ' + (q.danger ? 'danger' : 'primary')} onClick={() => done(q.confirmOnly ? '' : v)}>
            {q.confirmOnly ? (q.danger ? 'Удалить' : 'Да') : 'OK'}
          </button>
        </>
      }
    >
      {!q.confirmOnly &&
        (q.multiline ? (
          <textarea ref={ref} className="input" rows={5} value={v} onChange={(e) => setV(e.target.value)} />
        ) : (
          <input
            ref={ref}
            className="input"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(v);
            }}
          />
        ))}
    </Modal>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([k, label]) => (
        <button key={String(k)} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}
