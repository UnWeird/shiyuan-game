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
}

export const BattleLog: React.FC<BattleLogProps> = ({ logs, maxEntries = 5 }) => {
  const recentLogs = logs.slice(-maxEntries).reverse();

  const getLogColor = (type: BattleLogEntry['type']) => {
    switch (type) {
      case 'move':
        return 'text-blue-600';
      case 'attack':
        return 'text-orange-600';
      case 'deploy':
        return 'text-green-600';
      case 'kill':
        return 'text-red-600';
      case 'ability':
        return 'text-purple-600';
      default:
        return 'text-gray-600';
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
    <div className="bg-white rounded-lg shadow-lg p-4">
      <h3 className="text-lg font-bold mb-2">战斗日志</h3>
      <div className="space-y-1 text-xs">
        {recentLogs.length === 0 ? (
          <p className="text-gray-400 italic">暂无记录</p>
        ) : (
          recentLogs.map(log => (
            <div key={log.id} className={`flex items-start gap-2 ${getLogColor(log.type)}`}>
              <span className="font-bold">{getLogIcon(log.type)}</span>
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
