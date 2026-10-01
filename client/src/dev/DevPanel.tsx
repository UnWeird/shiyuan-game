import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { toast } from '../stores/uiStore';
import { loadSnapshot, requestSnapshot } from './devBridge';
import {
  deleteSnapshot,
  downloadSnapshot,
  importSnapshotFile,
  listSnapshots,
  saveSnapshot,
  type Snapshot,
} from './snapshots';

/**
 * 开发面板：存 / 读对局局面。Ctrl+Shift+D 开关。
 * 只在 import.meta.env.DEV 下挂载（见 App.tsx），生产构建不包含。
 *
 * 在线模式的快照来自服务端（需服务端以 SHIYUAN_DEV_TOOLS=1 启动），
 * 单机模式的快照来自客户端 gameStore。两者不能交叉载入。
 */
export const DevPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isOnlineMode = useGameStore(s => s.isOnlineMode);
  const phase = useGameStore(s => s.phase);
  const turn = useGameStore(s => s.turn);

  const refresh = useCallback(() => setSnapshots(listSnapshots()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 把存读接口挂到 window，方便在控制台直接构造局面。
  // 放在 DevPanel 里而不是 main.tsx：这样整条引用链都在 dev/ 内，生产构建不会带上。
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__dev = { requestSnapshot, loadSnapshot };
  }, []);

  // Ctrl+Shift+D 开关面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSave = async () => {
    setBusy(true);
    try {
      // 同机对弈现在也是服务端房间，快照统一取服务端权威状态，
      // 不再有「本地 store 快照」这种第二种格式。
      const data = await requestSnapshot(label);
      const { error } = saveSnapshot(label, 'online', data);
      if (error) toast.error(error, '保存失败');
      else toast.success('已保存局面快照');
      setLabel('');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = (snap: Snapshot) => {
    if (!isOnlineMode) {
      toast.error('请先进入对局（同机对弈或联网对战）再载入局面');
      return;
    }
    if (snap.mode === 'local') {
      // 旧版本存下来的本地 store 快照，字段结构和服务端不同，载入只会得到坏局面
      toast.error('这是旧版单机快照，格式已不再支持，请重新保存');
      return;
    }
    loadSnapshot(snap.data);
    // 结果由服务端回 info / error 消息告知
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { error } = await importSnapshotFile(file);
    if (error) toast.error(error, '导入失败');
    else {
      toast.success('已导入快照');
      refresh();
    }
    e.target.value = '';
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="开发面板 (Ctrl+Shift+D)"
        className="fixed bottom-2 left-2 z-[120] px-2 py-1 rounded text-[10px] font-mono opacity-40 hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(13,5,0,0.9)', border: '1px solid rgba(201,162,39,0.4)', color: '#C9A227' }}
      >
        DEV
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-2 left-2 z-[120] w-[330px] rounded-lg p-3 text-xs"
      style={{
        background: 'linear-gradient(180deg, rgba(20,14,7,0.97) 0%, rgba(8,4,0,0.98) 100%)',
        border: '1px solid rgba(201,162,39,0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono tracking-wider" style={{ color: '#C9A227' }}>
          DEV · 局面存读
        </span>
        <button onClick={() => setOpen(false)} className="px-1.5 font-mono" style={{ color: 'rgba(201,162,39,0.6)' }}>
          ✕
        </button>
      </div>

      {/* 当前状态 */}
      <div className="mb-2 font-mono text-[10px]" style={{ color: 'rgba(245,230,200,0.5)' }}>
        {isOnlineMode ? '联网模式（快照来自服务端）' : '单机模式（快照来自本地 store）'}
        <br />
        阶段 {phase} · 回合 {turn}
      </div>

      {/* 保存 */}
      <div className="flex gap-1.5 mb-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSave(); }}
          placeholder="局面名，如 投石车蓄满2层"
          className="flex-1 px-2 py-1 rounded font-chinese"
          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(201,162,39,0.3)', color: '#EADCBD' }}
        />
        <button
          onClick={handleSave}
          disabled={busy}
          className="btn-sy btn-sy-gold px-2.5 py-1 rounded whitespace-nowrap"
        >
          {busy ? '…' : '存档'}
        </button>
      </div>

      {/* 导入 */}
      <div className="flex gap-1.5 mb-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="btn-sy btn-sy-ghost flex-1 px-2 py-1 rounded"
        >
          从文件导入
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
      </div>

      {/* 列表 */}
      {snapshots.length === 0 ? (
        <p className="font-mono text-[10px] py-2 text-center" style={{ color: 'rgba(201,162,39,0.3)' }}>
          还没有存档
        </p>
      ) : (
        <div className="space-y-1">
          {snapshots.map(s => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded"
              style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(201,162,39,0.18)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate font-chinese" style={{ color: '#EADCBD' }}>
                  {s.label}
                </div>
                <div className="font-mono text-[9px]" style={{ color: 'rgba(245,230,200,0.35)' }}>
                  {s.mode === 'online' ? '局面' : '旧版单机'} ·{' '}
                  {new Date(s.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button onClick={() => handleLoad(s)} className="btn-sy btn-sy-jade px-2 py-0.5 rounded text-[10px]">
                载入
              </button>
              <button onClick={() => downloadSnapshot(s)} title="下载为 .json" className="btn-sy btn-sy-ghost px-1.5 py-0.5 rounded text-[10px]">
                ↓
              </button>
              <button
                onClick={() => { deleteSnapshot(s.id); refresh(); }}
                title="删除"
                className="btn-sy btn-sy-red px-1.5 py-0.5 rounded text-[10px]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 font-mono text-[9px] leading-relaxed" style={{ color: 'rgba(245,230,200,0.3)' }}>
        联网存读需服务端带 SHIYUAN_DEV_TOOLS=1 启动。
        载入不会重置组件内的临时 UI 状态（如扇形攻击选择中），必要时刷新页面后再载入。
      </p>
    </div>
  );
};

export default DevPanel;
