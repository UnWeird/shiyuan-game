import React from 'react';
import { useUIStore, type ToastKind } from '../../stores/uiStore';

/**
 * 游戏内提示条，替代原生 alert()。
 * 不阻塞操作、自动消失、同内容自动合并计数。
 */

/** 每种提示的强调色与前缀符号（都取自 imperial 色板） */
const KIND_STYLE: Record<ToastKind, { accent: string; text: string; mark: string; label: string }> = {
  error: { accent: '#C0392B', text: '#F0C7C0', mark: '✕', label: '不可' },
  warn: { accent: '#E8C84A', text: '#F2E3A9', mark: '!', label: '注意' },
  info: { accent: '#D4B896', text: '#EADCBD', mark: '·', label: '提示' },
  success: { accent: '#3F8A66', text: '#C6E2D3', mark: '✓', label: '成' },
};

export const ToastContainer: React.FC = () => {
  const toasts = useUIStore(state => state.toasts);
  const dismissToast = useUIStore(state => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[100] flex flex-col gap-2 pointer-events-none
                 top-3 left-3 right-3 items-stretch
                 sm:top-5 sm:right-5 sm:left-auto sm:items-end sm:w-auto sm:max-w-sm"
    >
      {toasts.map(t => {
        const style = KIND_STYLE[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => dismissToast(t.id)}
            className="toast-enter pointer-events-auto cursor-pointer rounded border overflow-hidden
                       flex items-stretch sm:min-w-[260px]"
            style={{
              borderColor: 'rgba(201,162,39,0.35)',
              background: 'linear-gradient(135deg, rgba(26,18,9,0.97) 0%, rgba(13,5,0,0.98) 100%)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201,162,39,0.15)',
              backdropFilter: 'blur(2px)',
            }}
          >
            {/* 左侧色条 */}
            <div className="w-[3px] shrink-0" style={{ background: style.accent }} />

            <div className="flex items-start gap-2.5 px-3 py-2.5 flex-1">
              {/* 标记 */}
              <span
                className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{
                  color: style.accent,
                  border: `1px solid ${style.accent}`,
                  background: 'rgba(0,0,0,0.3)',
                }}
              >
                {style.mark}
              </span>

              <div className="flex-1 min-w-0">
                <div
                  className="font-chinese text-[11px] tracking-[0.2em] mb-0.5 opacity-70"
                  style={{ color: style.accent }}
                >
                  {t.title ?? style.label}
                </div>
                <div
                  className="font-chinese text-sm leading-snug whitespace-pre-line break-words"
                  style={{ color: style.text }}
                >
                  {t.message}
                </div>
              </div>

              {/* 重复计数 */}
              {t.count > 1 && (
                <span
                  key={t.count}
                  className="toast-bump shrink-0 mt-0.5 min-w-[18px] h-[18px] px-1 rounded-full
                             flex items-center justify-center text-[10px] font-bold font-chinese"
                  style={{ background: style.accent, color: '#0D0D0D' }}
                >
                  {t.count}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ToastContainer;
