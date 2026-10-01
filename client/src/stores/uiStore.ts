import { create } from 'zustand';
import { playSfx, setSfxEnabled } from '../audio/sfx';

/** 静音开关持久化到 localStorage，刷新后保持 */
const SOUND_KEY = 'sy_soundEnabled';

function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * 界面层状态：游戏内提示、胜负结算、确认对话框
 *
 * 替代原来散落在各处的 18 处原生 alert() / window.confirm()。
 * 原生弹窗会阻塞交互、带着「localhost 显示」的浏览器外壳，
 * 是「不像一个游戏」最直接的来源。
 *
 * 单独建 store 而不是塞进 gameStore：gameStore 已经 870 行，
 * 且这些状态跟对局逻辑无关，纯展示层。
 */

export type ToastKind = 'error' | 'warn' | 'info' | 'success';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
  /** 同一条提示重复出现时累加，避免刷屏堆叠 */
  count: number;
}

export interface GameOverInfo {
  /** 'player1' | 'player2'，服务端 gameEnd 消息里的原始值 */
  winner: string;
  message: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  /** true 时确认按钮用朱红警示色 */
  danger: boolean;
  resolve: (ok: boolean) => void;
}

/** 各类提示的停留时长（毫秒），错误留久一点 */
const TOAST_DURATION: Record<ToastKind, number> = {
  error: 4500,
  warn: 4000,
  info: 3000,
  success: 3000,
};

interface UIState {
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string, title?: string) => void;
  dismissToast: (id: number) => void;

  gameOver: GameOverInfo | null;
  setGameOver: (info: GameOverInfo) => void;
  clearGameOver: () => void;

  confirmRequest: ConfirmRequest | null;
  askConfirm: (opts: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  settleConfirm: (ok: boolean) => void;

  soundEnabled: boolean;
  toggleSound: () => void;
}

let nextToastId = 1;
/** 记录每条 toast 的自动关闭定时器，重复提示时需要重置 */
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useUIStore = create<UIState>((set, get) => ({
  toasts: [],

  pushToast: (kind, message, title) => {
    const { toasts } = get();

    // 重复提示合并：同类型同内容时只累加计数并续期，不新增一条
    const existing = toasts.find(t => t.kind === kind && t.message === message && t.title === title);
    if (existing) {
      const timer = toastTimers.get(existing.id);
      if (timer) clearTimeout(timer);
      toastTimers.set(
        existing.id,
        setTimeout(() => get().dismissToast(existing.id), TOAST_DURATION[kind])
      );
      set({
        toasts: toasts.map(t => (t.id === existing.id ? { ...t, count: t.count + 1 } : t)),
      });
      return;
    }

    const id = nextToastId++;
    // 最多同时显示 4 条，超出丢弃最旧的
    const trimmed = toasts.length >= 4 ? toasts.slice(toasts.length - 3) : toasts;
    set({ toasts: [...trimmed, { id, kind, message, title, count: 1 }] });
    toastTimers.set(id, setTimeout(() => get().dismissToast(id), TOAST_DURATION[kind]));

    // 在这里统一发声：所有错误/成功提示都会有听觉反馈，
    // 不必在 14 个 toast 调用点各写一遍。info 太频繁，不发声。
    if (kind === 'error' || kind === 'warn') playSfx('error');
    else if (kind === 'success') playSfx('success');
  },

  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.delete(id);
    set({ toasts: get().toasts.filter(t => t.id !== id) });
  },

  gameOver: null,
  setGameOver: (info) => set({ gameOver: info }),
  clearGameOver: () => set({ gameOver: null }),

  confirmRequest: null,

  askConfirm: ({ title = '请确认', message, confirmText = '确定', cancelText = '取消', danger = false }) => {
    // 已有一个待回答的确认框时，直接拒绝新请求，避免互相覆盖导致 promise 悬空
    if (get().confirmRequest) return Promise.resolve(false);

    return new Promise<boolean>(resolve => {
      set({ confirmRequest: { title, message, confirmText, cancelText, danger, resolve } });
    });
  },

  settleConfirm: (ok) => {
    const req = get().confirmRequest;
    set({ confirmRequest: null });
    req?.resolve(ok);
  },

  soundEnabled: loadSoundEnabled(),

  toggleSound: () => {
    const next = !get().soundEnabled;
    set({ soundEnabled: next });
    setSfxEnabled(next);
    try {
      localStorage.setItem(SOUND_KEY, String(next));
    } catch {
      // 隐私模式下写不了，忽略
    }
    // 开启时给一声反馈，确认音量正常
    if (next) playSfx('select');
  },
}));

// 把持久化的静音状态同步给音效模块
setSfxEnabled(useUIStore.getState().soundEnabled);

/**
 * 供 React 之外的代码使用（ColyseusService 是单例，不在组件树里）。
 */
export const toast = {
  error: (message: string, title?: string) => useUIStore.getState().pushToast('error', message, title),
  warn: (message: string, title?: string) => useUIStore.getState().pushToast('warn', message, title),
  info: (message: string, title?: string) => useUIStore.getState().pushToast('info', message, title),
  success: (message: string, title?: string) => useUIStore.getState().pushToast('success', message, title),
};

/** 供 React 之外的代码弹确认框 */
export const askConfirm = (opts: Parameters<UIState['askConfirm']>[0]) =>
  useUIStore.getState().askConfirm(opts);
