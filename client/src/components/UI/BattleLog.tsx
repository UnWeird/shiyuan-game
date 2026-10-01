import React from 'react';

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

/** 从服务端战报文本里粗略判断类型，只用于上色 */
function inferType(message: string): BattleLogEntry['type'] {
  if (message.includes('击杀') || message.includes('阵亡') || message.includes('获胜')) return 'kill';
  if (message.includes('攻击') || message.includes('贯穿') || message.includes('投射') || message.includes('击退')) return 'attack';
  if (message.includes('移动') || message.includes('碾压')) return 'move';
  if (message.includes('部署') || message.includes('大本营')) return 'deploy';
  if (message.includes('技能') || message.includes('转化') || message.includes('招降') || message.includes('蓄力')) return 'ability';
  return 'info';
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

  /**
   * 日志颜色与全局语义一致：
   * 移动=青玉、攻击/击杀=朱红、部署/技能=金、其他=素色。
   * 原来是 Tailwind 的 blue/orange/green/purple-600，在深色底上偏暗且配色不统一。
   */
  const getLogColor = (type: BattleLogEntry['type']) => {
    switch (type) {
      case 'move':
        return '#6FCFA4'; // 青玉亮
      case 'attack':
        return '#C0392B'; // 朱红
      case 'deploy':
        return '#C9A227'; // 金
      case 'kill':
        return '#E8776A'; // 朱红亮（击杀要比普通攻击更跳）
      case 'ability':
        return '#E8C84A'; // 亮金
      default:
        return 'rgba(245,230,200,0.6)';
    }
  };

  const getLogIcon = (type: BattleLogEntry['type']) => {
    switch (type) {
      case 'move':
        return '→';
      case 'attack':
        return '⚔';
      case 'deploy':
        return '✚';
      case 'kill':
        return '✕';
      case 'ability':
        return '✦';
      default:
        return '•';
    }
  };

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
      <div className="space-y-1 text-xs font-chinese">
        {recentLogs.length === 0 ? (
          <p className="italic" style={{ color: 'rgba(201,162,39,0.3)' }}>
            暂无记录
          </p>
        ) : (
          recentLogs.map(log => (
            <div key={log.id} className="flex items-start gap-2" style={{ color: getLogColor(log.type) }}>
              <span className="font-bold">{getLogIcon(log.type)}</span>
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
