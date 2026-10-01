import React from 'react';
import { INFO } from '../../theme/boardTheme';
import { LEGEND_ITEMS } from '../../theme/glyphs';

/**
 * 记号图例
 *
 * 规格：docs/board-art-spec.md §3
 *
 * 盘面上不出现文字的代价是得有一张图例。两件事要一起讲清楚：
 *
 *   1. **四个信息色的语义**（锁死，不会挪用）
 *   2. **记号的组合语法** —— 矛尖是字根，实心/划掉/换色/加钩分别是四条规则
 *
 * 两个入口：规则书首屏，以及对局内右栏的可折叠段（默认收起）。
 */

const COLOR_KEYS: Array<{ color: string; name: string; meaning: string }> = [
  { color: INFO.move, name: '青', meaning: '我方可移动' },
  { color: INFO.face, name: '琥珀', meaning: '朝向 · 射界 · 伤害加成 · 友伤' },
  { color: INFO.threat, name: '朱', meaning: '敌方威胁 · 可攻击 · 致命 · 本营告警' },
  { color: INFO.pick, name: '白', meaning: '当前选中 · 当前悬停' },
];

/** 把一个记号画进固定尺寸的小方框，保证图例里各条对齐 */
const Chip: React.FC<{ render: (u: number) => React.ReactNode; size?: number }> = ({
  render,
  size = 30,
}) => (
  <svg
    viewBox="-16 -16 32 32"
    width={size}
    height={size}
    style={{ display: 'block', flex: 'none' }}
    aria-hidden="true"
  >
    {render(26)}
  </svg>
);

export const LegendPanel: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="space-y-3">
    {/* 颜色语义 */}
    <div>
      <p className="text-xs font-chinese mb-1.5" style={{ color: 'rgba(201,162,39,0.55)' }}>
        颜色语义（固定，不挪用）
      </p>
      <div className={compact ? 'space-y-1' : 'grid grid-cols-2 gap-x-4 gap-y-1'}>
        {COLOR_KEYS.map((c) => (
          <div key={c.name} className="flex items-center gap-2">
            <span
              className="rounded"
              style={{ width: 14, height: 10, background: c.color, flex: 'none' }}
            />
            <span className="text-xs font-chinese font-semibold" style={{ color: '#F0D98A' }}>
              {c.name}
            </span>
            <span className="text-xs font-chinese" style={{ color: 'rgba(245,230,200,0.5)' }}>
              {c.meaning}
            </span>
          </div>
        ))}
      </div>
    </div>

    {/* 记号 */}
    <div>
      <p className="text-xs font-chinese mb-1" style={{ color: 'rgba(201,162,39,0.55)' }}>
        记号（矛尖是字根，其余是它的四种修饰）
      </p>
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {LEGEND_ITEMS.map((item) => (
            <tr key={item.key} style={{ borderBottom: '1px solid rgba(201,162,39,0.10)' }}>
              <td className="py-1 pr-2" style={{ width: 38 }}>
                <Chip render={item.render} />
              </td>
              <td
                className="py-1 pr-3 text-xs font-chinese font-semibold align-middle whitespace-nowrap"
                style={{ color: '#F0D98A', width: 78 }}
              >
                {item.name}
              </td>
              <td
                className="py-1 text-xs font-chinese align-middle"
                style={{ color: 'rgba(245,230,200,0.5)', lineHeight: 1.5 }}
              >
                {item.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default LegendPanel;
