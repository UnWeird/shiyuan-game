import React, { useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';

/**
 * 古风确认对话框，替代 window.confirm()。
 * 由 uiStore.askConfirm() 触发，返回 Promise<boolean>。
 */
export const ConfirmDialog: React.FC = () => {
  const req = useUIStore(state => state.confirmRequest);
  const settleConfirm = useUIStore(state => state.settleConfirm);

  // Esc 取消 / Enter 确认
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settleConfirm(false);
      if (e.key === 'Enter') settleConfirm(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, settleConfirm]);

  if (!req) return null;

  const accent = req.danger ? '#C0392B' : '#C9A227';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 modal-overlay"
      style={{ background: 'rgba(5,2,0,0.78)', backdropFilter: 'blur(3px)' }}
      onClick={() => settleConfirm(false)}
    >
      <div
        className="modal-content relative w-full max-w-sm rounded-lg border p-6"
        style={{
          borderColor: 'rgba(201,162,39,0.35)',
          background: 'linear-gradient(180deg, rgba(26,10,0,0.97) 0%, rgba(13,5,0,0.99) 100%)',
          boxShadow: '0 0 60px rgba(201,162,39,0.15), inset 0 1px 0 rgba(201,162,39,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 四角装饰 */}
        <div className="absolute top-2 left-2 w-5 h-5 border-t border-l" style={{ borderColor: 'rgba(201,162,39,0.4)' }} />
        <div className="absolute top-2 right-2 w-5 h-5 border-t border-r" style={{ borderColor: 'rgba(201,162,39,0.4)' }} />
        <div className="absolute bottom-2 left-2 w-5 h-5 border-b border-l" style={{ borderColor: 'rgba(201,162,39,0.4)' }} />
        <div className="absolute bottom-2 right-2 w-5 h-5 border-b border-r" style={{ borderColor: 'rgba(201,162,39,0.4)' }} />

        {/* 顶部装饰线 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-imperial-gold/50" />
          <div className="w-1.5 h-1.5 rotate-45" style={{ background: accent }} />
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-imperial-gold/50" />
        </div>

        <h3
          className="font-ancient text-2xl text-center tracking-widest mb-3"
          style={{ color: accent, textShadow: `0 0 20px ${accent}55` }}
        >
          {req.title}
        </h3>

        <p className="font-chinese text-center text-sm leading-relaxed mb-6 whitespace-pre-line" style={{ color: '#EADCBD' }}>
          {req.message}
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => settleConfirm(false)}
            className="flex-1 py-2.5 rounded border font-chinese tracking-widest text-sm transition-all duration-300"
            style={{ borderColor: 'rgba(201,162,39,0.3)', color: 'rgba(201,162,39,0.75)', background: 'rgba(26,18,9,0.6)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,162,39,0.6)'; e.currentTarget.style.color = '#C9A227'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(201,162,39,0.3)'; e.currentTarget.style.color = 'rgba(201,162,39,0.75)'; }}
          >
            {req.cancelText}
          </button>
          <button
            onClick={() => settleConfirm(true)}
            autoFocus
            className="flex-1 py-2.5 rounded border font-chinese tracking-widest text-sm transition-all duration-300"
            style={{
              borderColor: accent,
              color: req.danger ? '#F0C7C0' : '#F2E3A9',
              background: req.danger
                ? 'linear-gradient(135deg, rgba(139,26,26,0.7) 0%, rgba(74,14,14,0.85) 100%)'
                : 'linear-gradient(135deg, rgba(139,105,20,0.6) 0%, rgba(26,18,9,0.85) 100%)',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 20px ${accent}55`; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
          >
            {req.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
