import React from 'react';
import { INFO, PIECE } from '../../theme/boardTheme';
import { Arrow, Banner, Blade, Pips, Shield } from '../../theme/glyphs';

interface BattleLogEntry {
  id: string;
  message: string;
  type: 'move' | 'attack' | 'deploy' | 'kill' | 'info' | 'ability';
  timestamp: number;
}

interface BattleLogProps {
  logs: BattleLogEntry[];
  maxEntries?: number;
  /**
   * 服务端权威战报（字符串数组）。给了就优先用它。
   *
   * 在线模式下本地 logs 是「指令发出时猜的」，服务端拒绝了也不会撤回，
   * 而服务端自己记了一份真实战报（含击杀、击退、技能结算），以前完全没同步下来。
   */
  serverLogs?: string[];
}

/** 从服务端战报文本里粗略判断类型，只用于上色与选记号 */
function inferType(message: string): BattleLogEntry['type'] {
  if (message.includes('击杀') || message.includes('阵亡') || message.includes('获胜')) return 'kill';
  if (message.includes('攻击') || message.includes('贯穿') || message.includes('投射') || message.includes('击退')) return 'attack';
  if (message.includes('移动') || message.includes('碾压')) return 'move';
  if (message.includes('部署') || message.includes('大本营')) return 'deploy';
  if (message.includes('技能') || message.includes('转化') || message.includes('招降') || message.includes('蓄力')) return 'ability';
  return 'info';
}

/** 回合分隔行（服务端写成 `--- 第2回合 - 玩家1 ---`），当成分隔符而不是普通条目 */
const isDivider = (message: string) => /^-{2,}|-{2,}$/.test(message.trim());

/** 把回合分隔行里的装饰横线剥掉，只留文字 */
const dividerText = (message: string) => message.replace(/-{2,}/g, '').trim();

/**
 * 哪一方做的。
 * 用来在条目左侧画一道阵营色竖条 —— 原来整条战报只有类型色，
 * 扫一眼分不出是自己干的还是对手干的。
 */
function inferSide(message: string): 'p1' | 'p2' | null {
  const p1 = /玩家\s*[1一]/.test(message);
  const p2 = /玩家\s*[2二]/.test(message);
  if (p1 && !p2) return 'p1';
  if (p2 && !p1) return 'p2';
  return null; // 两方都提到（例如「玩家1的骑兵攻击了玩家2的步兵」）就不强行归属
}

const TYPE_COLOR: Record<BattleLogEntry['type'], string> = {
  move: INFO.move,
  attack: INFO.threat,
  kill: '#E8776A',
  deploy: '#C9A227',
  ability: '#E8C84A',
  info: 'rgba(245,230,200,0.6)',
};

/**
 * 条目前的记号，复用棋盘上那套字根（theme/glyphs）。
 *
 * 原来用的是 `⚔ ✚ ✕ → ✦ •` 这些 Unicode 符号 —— 跨字体渲染不一致，
 * 而且和盘面上的记号是两套视觉语言。现在战报里的矛尖就是盘面上的矛尖。
 */
function LogMark({ type }: { type: BattleLogEntry['type'] }) {
  const u = 22;
  const c = TYPE_COLOR[type];
  const body = (() => {
    switch (type) {
      case 'attack':
        return <Blade u={u} color={c} />;
      case 'kill':
        return <Blade u={u} color={c} solid />;
      case 'move':
        return <g transform={`translate(${-u * 0.3},0)`}><Arrow u={u} length={u * 0.6} color={c} /></g>;
      case 'deploy':
        return <Banner u={u} color={c} />;
      case 'ability':
        return <Shield u={u} color={c} />;
      default:
        return <Pips n={1} u={u} color={c} />;
    }
  })();
  return (
    <svg viewBox="-14 -14 28 28" width={14} height={14} aria-hidden="true"
         style={{ display: 'block', flex: 'none', marginTop: '0.15em' }}>
      {body}
    </svg>
  );
}

export const BattleLog: React.FC<BattleLogProps> = ({ logs, maxEntries = 5, serverLogs }) => {
  const entries: BattleLogEntry[] = serverLogs
    ? serverLogs.map((message, i) => ({
        id: `server-${i}`,
        message,
        type: inferType(message),
        timestamp: 0,
      }))
    : logs;

  const recentLogs = entries.slice(-maxEntries).reverse();

  return (
    <div
      className="rounded-lg p-4"
      style={{
        // 原来是 bg-white，在深色古风界面里是一整块白，全程都在屏幕上
        background: 'linear-gradient(180deg, rgba(26,18,9,0.88) 0%, rgba(13,5,0,0.94) 100%)',
        border: '1px solid rgba(201,162,39,0.28)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-chinese text-sm tracking-[0.2em]" style={{ color: '#C9A227' }}>
          战报
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-imperial-gold/40 to-transparent" />
      </div>

      <div className="text-xs font-chinese">
        {recentLogs.length === 0 ? (
          <p className="italic" style={{ color: 'rgba(201,162,39,0.3)' }}>
            暂无记录
          </p>
        ) : (
          recentLogs.map((log, i) => {
            if (isDivider(log.message)) {
              return (
                <div key={log.id} className="flex items-center gap-2 py-1.5" aria-label="回合分隔">
                  <span className="h-px flex-1" style={{ background: 'rgba(201,162,39,0.22)' }} />
                  <span style={{ color: 'rgba(201,162,39,0.55)', letterSpacing: '0.12em' }}>
                    {dividerText(log.message)}
                  </span>
                  <span className="h-px flex-1" style={{ background: 'rgba(201,162,39,0.22)' }} />
                </div>
              );
            }

            const side = inferSide(log.message);
            const stripe = side === 'p1' ? PIECE.player1.face
              : side === 'p2' ? PIECE.player2.face
              : 'transparent';
            return (
              <div
                key={log.id}
                className="flex items-start gap-2 py-0.5 pl-2"
                style={{
                  color: TYPE_COLOR[log.type],
                  // 最新一条亮一点，往下逐条压暗：扫一眼就知道哪条刚发生
                  opacity: i === 0 ? 1 : 0.72,
                  borderLeft: `2px solid ${stripe}`,
                }}
              >
                <LogMark type={log.type} />
                <span style={{ lineHeight: 1.55 }}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
