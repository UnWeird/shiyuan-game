/**
 * 棋盘 / 棋子 / 信息层 的设计令牌
 *
 * 规格：docs/board-art-spec.md §1 §2 §5
 *
 * 核心约束是三层，各层的色彩权限互不重叠：
 *
 *   世界层  铜底板、凹格、铜脊、回纹、分区   —— 只许用明度区分，禁止使用任何信息色
 *   信息层  可达区、射界、攻击范围、威胁、告警 —— 只许用 INFO 四色，语义锁死
 *   棋子层  玉片、金错边、汉字、体力弧、朝向   —— 阵营色只允许出现在这一层
 *
 * 为什么棋盘必须是暗底：浅底下信息层只能往"更暗"走，而暗 = 禁用/失效，语义天然拧着。
 * 旧实现把淡金高亮压到 fill-opacity .35，深底透上来变成比普通格更暗的脏橄榄绿，
 * 玩家看到的是"每个格子甩了个偏移阴影"。换皮解决不了，只能翻转明度方向。
 */

import { UnitType } from '../types';

/**
 * imperial 色板：菜单 / 大厅 / 规则书 / 结算仍在用，不要删。
 * 古风浓度保留在这些不承载信息的地方；棋盘内部交给可读性。
 */
export const IMPERIAL = {
  red: '#8B1A1A',
  redLight: '#C0392B',
  gold: '#C9A227',
  goldLight: '#E8C84A',
  goldDark: '#8B6914',
  ink: '#0D0D0D',
  parchment: '#F5E6C8',
  parchmentDark: '#D4B896',
  jade: '#2E6B4F',
} as const;

/* ══════════════════════ 世界层：青铜 ══════════════════════ */

/** 只有明度差，饱和度极低，绝不与信息层抢注意力 */
export const WORLD = {
  /** 底板径向渐变（内亮外暗，给棋盘一个中心受光） */
  plateInner: '#262319',
  plateOuter: '#14130C',
  /**
   * 格子只有明度差，不用色相。
   * 这两个值在实机 1440×900 上调过：原来的 #23221A / #1C1B14 在满屏尺寸下
   * 中部格线读不出来（棋盘像一块黑板），各提一档后网格清楚、又不至于抢走信息层。
   */
  cellZone: '#302C21',
  cellBattle: '#262319',
  /** 凸起的铜脊缝线。整张盘只画一遍，见 utils/boardGeometry.ts */
  seam: 'rgba(192,172,118,0.42)',
  /** 凹格内边：上亮下暗 = 刻进去；反过来就成了浮雕凸起 */
  lipTop: 'rgba(255,228,170,0.30)',
  lipMid: 'rgba(255,228,170,0.04)',
  lipBottom: 'rgba(0,0,0,0.34)',
  /** 回纹底纹，对比度必须压在 3% 以下，否则会糊住棋子 */
  huiPattern: 'rgba(255,228,170,0.028)',
  /** 棋盘外框 */
  frame: 'rgba(176,158,106,0.35)',
} as const;

/* ══════════════════════ 信息层：四色锁死 ══════════════════════ */

/**
 * 语义固定，禁止扩展，也禁止挪用：
 *   move   只表示"我方可移动"
 *   face   只表示"朝向 / 射界 / 伤害加成 / 友伤预警"
 *   threat 只表示"敌方威胁 / 可攻击 / 致命 / 本营告警"
 *   pick   只表示"当前选中 / 当前悬停"
 *
 * 需要在四色内扩展语义时，改**填充方式**（实色 vs 斜纹）而不是加新颜色。
 */
export const INFO = {
  move: '#5BC8E8',
  face: '#F0B44A',
  threat: '#E2564B',
  pick: '#FFFFFF',
  /** 骑兵第 3 段「本回合不可攻击」的失色档 */
  muted: 'rgba(176,196,214,0.95)',
} as const;

/** 信息层填充的不透明度档位：底色恒定不透明，只脉动描边 */
export const INFO_FILL = {
  /** 可移动 / 射界等"可以做的事" */
  able: 0.16,
  /** 鼠标悬停的那一格 */
  hover: 0.4,
  /** 范围内真有目标 */
  occupied: 0.34,
} as const;

/* ══════════════════════ 棋子层：玉石嵌片 ══════════════════════ */

export interface PieceSkin {
  /** 玉片本体 */
  face: string;
  /** 汉字（阴刻感，用玉的深色） */
  glyph: string;
}

/** 朱玉 / 青玉：用玉的明度而不是饱和原色，暖铜底上才不打架 */
export const PIECE = {
  player1: { face: '#D98A74', glyph: '#6E2317' } as PieceSkin,
  player2: { face: '#8FC4A6', glyph: '#1D5B42' } as PieceSkin,
  neutral: { face: '#BDB49E', glyph: '#3E3626' } as PieceSkin,
  huangjinLishi: { face: '#D4B55E', glyph: '#4A3A10' } as PieceSkin,
  huangjinZei: { face: '#A08A4C', glyph: '#33280C' } as PieceSkin,
  /** 金错边，双方共用 —— 把棋子和铜板缝成一体 */
  rim: '#C9A227',
  /** 体力弧：亮 = 还有，熄 = 已失去 */
  hpLit: '#F3E6CA',
  hpDim: 'rgba(160,150,135,0.30)',
  /** 已行动的压暗遮罩 */
  spentVeil: '#070A0D',
} as const;

/** 棋子上的汉字统一用衬线体：小字号下比毛笔体易读 */
export const PIECE_FONT = '"Noto Serif SC", serif';

/**
 * 兵种 → 棋子上的汉字。
 *
 * 旧实现里弓箭手 / 将军 / 三种机关 / 中立标记**都没有字**，
 * 只靠形状（三角 / 五角星 / 倒三角 / 圆）区分，小尺寸下根本分不出来。
 * 现在统一成"圆玉片 + 一个汉字"，形状不再承载信息。
 */
export const UNIT_GLYPH: Record<UnitType, string> = {
  [UnitType.INFANTRY]: '步',
  [UnitType.CAVALRY]: '骑',
  [UnitType.ARCHER]: '弓',
  [UnitType.GENERAL]: '将',
  [UnitType.BALLISTA]: '弩',
  [UnitType.CHARIOT]: '车',
  [UnitType.CATAPULT]: '投',
  [UnitType.NEUTRAL_MARKER]: '中',
  [UnitType.HUANGJIN_LISHI]: '力',
  [UnitType.HUANGJIN_ZEI]: '贼',
};

/**
 * 兵种中文名，用于「选中单位」面板。
 *
 * 旧实现直接把枚举值显示给玩家（面板上写着 `类型: archer`）。
 */
export const UNIT_NAME: Record<UnitType, string> = {
  [UnitType.INFANTRY]: '步兵',
  [UnitType.CAVALRY]: '骑兵',
  [UnitType.ARCHER]: '弓箭手',
  [UnitType.GENERAL]: '将军',
  [UnitType.BALLISTA]: '弩车',
  [UnitType.CHARIOT]: '战车',
  [UnitType.CATAPULT]: '投石车',
  [UnitType.NEUTRAL_MARKER]: '中立单位',
  [UnitType.HUANGJIN_LISHI]: '黄巾力士',
  [UnitType.HUANGJIN_ZEI]: '黄巾贼',
};

/** 有朝向的兵种：朝向尖只画在这三种上 */
export const DIRECTIONAL_UNITS: ReadonlySet<UnitType> = new Set([
  UnitType.ARCHER,
  UnitType.BALLISTA,
  UnitType.CATAPULT,
]);

/* ══════════════════════ 棋盘几何 ══════════════════════ */

/**
 * 棋盘 viewBox 的长宽比，布局用它算棋盘容器尺寸（见 docs/layout-spec.md §3.1）。
 *
 * 半径 5 的 pointy-top 图：宽 = size·√3·(2R+1)，高 = size·(3R+2)
 *   → 40·√3·11 = 762.1 ... 实际 viewBox 还带 1 格 padding，见 HexMap。
 * 这里只固化比值，避免布局和渲染各算一遍。
 */
export const BOARD_ASPECT = 772.8203230275508 / 680;
