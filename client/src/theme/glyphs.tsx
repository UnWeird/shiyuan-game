import React from 'react';
import { INFO } from './boardTheme';

/**
 * 盘面记号库
 *
 * 规格：docs/board-art-spec.md §3
 *
 * 目标是让盘面上不出现任何文字。做法不是"每条规则配一个图标"（那会变成十几个
 * 互不相关的小图，玩家要一个个认），而是**少量字根 + 组合规则**：
 *
 *   矛尖  ◇            = 攻击
 *   矛尖 + 实心        = 致命（这一下能杀）
 *   矛尖 + 划掉        = 不可攻击      ← 骑兵冲 3 格的代价
 *   矛尖 + 换琥珀      = 友伤          ← 战车冲锋带
 *   矛尖 + 倒钩        = 伤害加成      ← 骑兵冲 2 格的奖励
 *
 * 四条规则共用一个字根，玩家只需认一次。
 * 圆点 = 任何"可数的量"（行动点消耗、投石车蓄力、本营剩余步数）。
 *
 * 所有记号以原点为中心绘制，`u` 是基准尺寸（建议 hexSize * 0.5）。
 * 统一线宽 u*0.16、统一圆端，这样它们看起来是一套东西而不是一堆素材。
 */

/** 统一的笔画参数 */
const stroke = (u: number) => ({
  strokeWidth: u * 0.16,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

const pol = (r: number, deg: number): [number, number] => [
  r * Math.cos((deg * Math.PI) / 180),
  r * Math.sin((deg * Math.PI) / 180),
];

/** 环形弧段，供 rotate 与告警环复用 */
export function arcD(r: number, a0: number, a1: number): string {
  const [x0, y0] = pol(r, a0);
  const [x1, y1] = pol(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

interface GlyphProps {
  /** 基准尺寸 */
  u: number;
  color?: string;
  opacity?: number;
}

/** 否定：划掉。单独可用（已行动），也作为 blade 的修饰 */
export const Slash: React.FC<GlyphProps> = ({ u, color = INFO.muted, opacity = 1 }) => (
  <line
    x1={-u * 0.42} y1={u * 0.42} x2={u * 0.42} y2={-u * 0.42}
    stroke={color} opacity={opacity} {...stroke(u)}
  />
);

/**
 * 攻击：矛尖。
 * solid = 致命（这一下能杀）· forbid = 不可攻击 · 换成 INFO.face = 友伤
 */
export const Blade: React.FC<GlyphProps & { solid?: boolean; forbid?: boolean }> = ({
  u, color = INFO.threat, opacity = 1, solid = false, forbid = false,
}) => (
  <g opacity={opacity}>
    <path
      d={`M 0,${-u * 0.52} L ${u * 0.26},${-u * 0.04} L 0,${u * 0.5} L ${-u * 0.26},${-u * 0.04} Z`}
      fill={solid ? color : 'none'}
      stroke={color}
      {...stroke(u)}
    />
    {forbid && <Slash u={u * 1.25} color={color} />}
  </g>
);

/** 伤害加成：矛尖带倒钩。实心 + 两道钩，一眼区别于普通矛尖 */
export const Barb: React.FC<GlyphProps> = ({ u, color = INFO.face, opacity = 1 }) => (
  <g opacity={opacity}>
    <Blade u={u} color={color} solid />
    <path
      d={`M ${-u * 0.3},${-u * 0.3} L ${-u * 0.52},${-u * 0.46} M ${u * 0.3},${-u * 0.3} L ${u * 0.52},${-u * 0.46}`}
      stroke={color}
      {...stroke(u)}
    />
  </g>
);

/** 免伤 / 方阵：盾 */
export const Shield: React.FC<GlyphProps & { solid?: boolean }> = ({
  u, color = INFO.move, opacity = 1, solid = true,
}) => (
  <path
    d={`M 0,${-u * 0.5} L ${u * 0.38},${-u * 0.3} L ${u * 0.38},${u * 0.08}
        Q ${u * 0.38},${u * 0.42} 0,${u * 0.56} Q ${-u * 0.38},${u * 0.42} ${-u * 0.38},${u * 0.08}
        L ${-u * 0.38},${-u * 0.3} Z`}
    fill={solid ? color : 'none'}
    stroke={color}
    opacity={opacity}
    {...stroke(u)}
  />
);

/** 任何"可数的量"：行动点消耗、蓄力层数、剩余步数 */
export const Pips: React.FC<GlyphProps & { n: number }> = ({ n, u, color = INFO.face, opacity = 1 }) => (
  <g opacity={opacity}>
    {Array.from({ length: n }, (_, i) => (
      <circle key={i} cx={-((n - 1) * u * 0.34) / 2 + i * u * 0.34} cy={0} r={u * 0.12} fill={color} />
    ))}
  </g>
);

/** 转向：回转箭头。通常配 Pips 表示成本 */
export const Rotate: React.FC<GlyphProps> = ({ u, color = INFO.face, opacity = 1 }) => {
  const [hx, hy] = pol(u * 0.42, 70);
  return (
    <g opacity={opacity}>
      <path d={arcD(u * 0.42, -200, 70)} fill="none" stroke={color} {...stroke(u)} />
      <path
        d={`M ${hx.toFixed(2)},${hy.toFixed(2)} m ${-u * 0.2},${-u * 0.05} l ${u * 0.2},${u * 0.18} l ${u * 0.06},${-u * 0.26} Z`}
        fill={color}
      />
    </g>
  );
};

/** 大本营：牙旗。替代盘面上的「帥 / 將」两个汉字 */
export const Banner: React.FC<GlyphProps> = ({ u, color = INFO.threat, opacity = 1 }) => (
  <g opacity={opacity}>
    <line
      x1={-u * 0.26} y1={-u * 0.56} x2={-u * 0.26} y2={u * 0.56}
      stroke={color} {...stroke(u)}
    />
    <path d={`M ${-u * 0.26},${-u * 0.5} L ${u * 0.5},${-u * 0.26} L ${-u * 0.26},${u * 0.02} Z`} fill={color} />
  </g>
);

/** 强制位移：击退 / 冲锋带。从原点指向 +x，调用方自行 rotate */
export const Arrow: React.FC<GlyphProps & { length: number }> = ({
  length, u, color = INFO.face, opacity = 1,
}) => (
  <g opacity={opacity}>
    <line x1={0} y1={0} x2={length - u * 0.3} y2={0} stroke={color} {...stroke(u)} />
    <path d={`M ${length},0 L ${length - u * 0.34},${-u * 0.24} L ${length - u * 0.34},${u * 0.24} Z`} fill={color} />
  </g>
);

/**
 * 行进步数：几个尖角 = 几格，指向行进方向。
 *
 * 注意：尖角**带方向**，只适合"沿某条通道前进"这类场景。
 * 骑兵的可达区是一整片、与方向无关，那里要用色带 + 悬停记号（M2），不要用它。
 */
export const Chevron: React.FC<GlyphProps & { n: number }> = ({ n, u, color = INFO.move, opacity = 1 }) => {
  const gap = u * 0.3;
  return (
    <g opacity={opacity}>
      {Array.from({ length: n }, (_, i) => {
        const x = -((n - 1) * gap) / 2 + i * gap;
        return (
          <path
            key={i}
            d={`M ${x - u * 0.16},${-u * 0.3} L ${x + u * 0.16},0 L ${x - u * 0.16},${u * 0.3}`}
            fill="none"
            stroke={color}
            {...stroke(u)}
          />
        );
      })}
    </g>
  );
};

/** 图例用：记号 + 含义。顺序即教学顺序 —— 先立字根，再讲组合 */
export interface LegendItem {
  key: string;
  render: (u: number) => React.ReactNode;
  name: string;
  desc: string;
}

export const LEGEND_ITEMS: LegendItem[] = [
  { key: 'blade', name: '可攻击', desc: '矛尖空心。这是"攻击"的字根，下面几条都是在它上面加修饰',
    render: (u) => <Blade u={u} /> },
  { key: 'lethal', name: '可击杀', desc: '矛尖实心 —— 这一下能杀，不用自己算血量',
    render: (u) => <Blade u={u} solid /> },
  { key: 'forbid', name: '不可攻击', desc: '矛尖被划掉。骑兵冲满 3 格的代价',
    render: (u) => <Blade u={u} color={INFO.muted} forbid /> },
  { key: 'friendly', name: '友伤', desc: '同一个矛尖换成琥珀色 —— 这一刀砍到自己人（战车冲锋带）',
    render: (u) => <Blade u={u} color={INFO.face} solid /> },
  { key: 'barb', name: '伤害加成', desc: '矛尖带倒钩。骑兵冲 2 格的奖励（目标相邻己方步兵 ≥2 时会被抵消）',
    render: (u) => <Barb u={u} /> },
  { key: 'shield', name: '免伤 · 方阵', desc: '队首亮盾：这个方向背后有同向步兵，受弓箭攻击时免伤',
    render: (u) => <Shield u={u} /> },
  { key: 'rotate', name: '转向', desc: '回转箭头，旁边的圆点是要花的行动点',
    render: (u) => <g><Rotate u={u} /><g transform={`translate(0,${u * 0.78})`}><Pips n={1} u={u * 0.8} /></g></g> },
  { key: 'pips', name: '可数的量', desc: '圆点通用表示数量：行动点消耗、投石车蓄力层数、本营剩余步数',
    render: (u) => <Pips n={2} u={u} /> },
  { key: 'arrow', name: '强制位移', desc: '击退、战车冲锋带的推进方向',
    render: (u) => <g transform={`translate(${-u * 0.3},0)`}><Arrow u={u} length={u * 0.6} /></g> },
  { key: 'banner', name: '大本营', desc: '牙旗。外圈告警环的圈数 = 最近敌军还差几步碰到它',
    render: (u) => <Banner u={u} /> },
  { key: 'slash', name: '已行动', desc: '棋子压暗加斜杠：这一枚本回合不能再动了',
    render: (u) => <Slash u={u} color="rgba(255,255,255,0.6)" /> },
  { key: 'chevron', name: '行进步数', desc: '尖角数 = 走几格，指向行进方向（只用于通道型移动）',
    render: (u) => <Chevron n={2} u={u} /> },
];
