import React, { useMemo, useState, useCallback } from 'react';
import { HexCoord } from '../../types';
import { generateHexMap, hexToPixel, hexEquals } from '../../utils/hexUtils';
import { hexPath, boardViewBox } from '../../utils/boardGeometry';
import { HexTile } from './HexTile';
import { WorldLayer, WorldDefs } from './WorldLayer';
import { useGameStore } from '../../stores/gameStore';
import { INFO, INFO_FILL, PIECE, PIECE_FONT } from '../../theme/boardTheme';
import { Banner, Blade, Barb, Shield } from '../../theme/glyphs';

/**
 * 棋盘：整个对局**唯一**的 SVG，分五层。
 *
 * 规格：docs/board-art-spec.md §4.2
 *
 * 旧实现是两个互相重叠的 <svg>（这一个画棋盘，GameBoard 里另一个画棋子），
 * 实测尺寸 920×664 vs 922×666 —— 两层本来就差 2px，任何缩放或边距改动都会
 * 把它放大成可见错位。现在棋子作为 children 进 #pieces 层，只剩一个 SVG。
 *
 * 层序（后面的盖前面的）：
 *   #world      铜板，静态，只依赖 [radius, size]
 *   #info-area  范围填充（可移动等），加光，永不压暗
 *   #info-mark  标记（步数、大本营）
 *   #hit        透明点击热区 —— 必须在填充之上才收得到点击
 *   #pieces     棋子（children）
 *   #info-top   选中框，pointer-events: none，不挡点击
 */
interface HexMapProps {
  radius: number;
  hexSize: number;
  onHexClick?: (hex: HexCoord) => void;
  /**
   * 可达/可攻击格。`damageUp` / `noAttack` 由服务端在 validActions 里下发
   * （见 shared/rules/queries.ts 的 MOVE_FLAG_*），客户端不自己按 steps 推。
   */
  highlightedHexes?: (HexCoord & { steps?: number; damageUp?: boolean; noAttack?: boolean })[];
  /**
   * 高亮的语义。移动用青、攻击用朱 ——
   * 原来两者都走同一套填充，攻击范围显示成"可移动"的青色，是实打实的误导。
   */
  highlightKind?: 'move' | 'attack';
  /** 范围内有敌军的格子，挂一个空心矛尖（打得到） */
  threatHexes?: HexCoord[];
  /**
   * 其中能一击击杀的格子，矛尖改实心。
   * 由服务端的 lethal 字段推出，不在客户端判血量。
   */
  lethalHexes?: HexCoord[];
  /**
   * 敌方下回合能打到的格子，铺朱色斜纹。
   * 我方能打的用**实色**、我方会被打的用**斜纹** ——
   * 同一个色相靠填充方式区分，不额外占一个信息色。
   */
  enemyThreatHexes?: HexCoord[];
  /** 被纵深抗击保护着的单位位置，画一个盾 */
  shieldedHexes?: HexCoord[];
  /** 伤害飘字。由 useDamageFeed 差分单位体力得到 */
  damageFlashes?: ReadonlyArray<{
    key: string;
    position: HexCoord;
    amount: number;
    kind: 'damage' | 'death';
  }>;
  /**
   * 整盘旋转的角度，目前只用 0 或 90（竖屏）。
   *
   * 这是**纯渲染旋转** —— 六边形坐标、方向枚举、起始区判定、机关占位
   * 一行都没改。实现见组件内的说明。
   */
  rotate?: 0 | 90;
  /** 棋子与其它随对局变化的叠加层，由 GameBoard 提供 */
  children?: React.ReactNode;
}

export const HexMap: React.FC<HexMapProps> = React.memo(({
  radius,
  hexSize,
  onHexClick,
  highlightedHexes = [],
  highlightKind = 'move',
  threatHexes = [],
  lethalHexes = [],
  enemyThreatHexes = [],
  shieldedHexes = [],
  damageFlashes = [],
  rotate = 0,
  children,
}) => {
  const { player1Base, player2Base, selectedUnitId, units } = useGameStore();

  const hexes = useMemo(() => generateHexMap(radius), [radius]);
  const vb = useMemo(() => {
    const box = boardViewBox(radius, hexSize);
    // 棋盘以原点为中心，旋转 90° 后外接框只是长宽互换
    if (rotate === 90) {
      return { minX: box.minY, minY: box.minX, width: box.height, height: box.width };
    }
    return box;
  }, [radius, hexSize, rotate]);

  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;
  const rangeColor = highlightKind === 'attack' ? INFO.threat : INFO.move;

  /* 悬停：M2 的"记号只在当前悬停的那一格出现"。
   * 常态盘面只有三段色带，18 格同时挂记号会太满。 */
  const [hovered, setHovered] = useState<string | null>(null);
  const handleHover = useCallback((hex: HexCoord | null) => {
    setHovered(hex ? `${hex.q},${hex.r}` : null);
  }, []);

  /**
   * 一格的颜色不编码"远近"，而是编码"落在这里会发生什么"：
   *   青   普通移动
   *   琥珀 伤害 +1（骑兵冲 2 格的奖励，所以是最亮最诱人的一档）
   *   冷白 本回合不可攻击（代价，所以是失色的一档）
   * 距离本身不画 —— 玩家看格子就能数。
   */
  /**
   * 竖屏时整盘转 90°，但有些东西必须保持**屏幕朝上**：汉字、体力弧、
   * 各种记号、飘字。做法是整盘套一个 rotate(R)，这些元素各自再 rotate(-R) 抵消。
   *
   * 这样做的好处是六边形坐标、Direction 枚举、起始区判定、机关占位
   * **一行都不用改** —— 朝向尖不抵消，它跟着棋盘转才是对的（朝向本身是六边形方向）。
   */
  const upright = rotate ? ` rotate(${-rotate})` : '';

  const isLethalHex = (h: HexCoord) =>
    lethalHexes.some(l => l.q === h.q && l.r === h.r);

  const tileColor = (h: { damageUp?: boolean; noAttack?: boolean }) =>
    highlightKind === 'attack' ? INFO.threat
      : h.noAttack ? INFO.muted
      : h.damageUp ? INFO.face
      : INFO.move;

  /**
   * 大本营：双环 + 牙旗记号，画在格子下沿，棋子站上去也遮不住。
   *
   * 原来是「帥 / 將」两个汉字。改成记号是为了达成"盘面零文字" ——
   * 汉字在盘面上有两个问题：缩放到 hexSize 30 时笔画糊成一团，
   * 而且它和棋子上的汉字是同一套视觉语言，玩家分不清哪个是地标哪个是单位。
   * 见 docs/board-art-spec.md §3
   */
  const renderBase = (base: HexCoord, key: string) => {
    const c = hexToPixel(base, hexSize);
    const color = INFO.threat;
    return (
      <g key={key}>
        <path d={hexPath(base, hexSize, 1)} fill={color} opacity={0.14} />
        <path d={hexPath(base, hexSize, 0.99)} fill="none" stroke={color} strokeWidth={2.4} />
        <path d={hexPath(base, hexSize, 0.8)} fill="none" stroke={color} strokeWidth={1} opacity={0.75} />
        <g transform={`translate(${c.x}, ${c.y + hexSize * 0.58})${upright}`}>
          <Banner u={hexSize * 0.42} color={color} />
        </g>
      </g>
    );
  };

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
      className="rounded"
      style={{ display: 'block', touchAction: 'none' }}
    >
      {/* 全局 defs：只在这里定义一次，id 用稳定常量 */}
      <defs>
        <WorldDefs />
        {/* 敌方威胁区的斜纹。45° 让它和六边形的边都不平行，不会被误读成格线 */}
        <pattern
          id="sy-threat-hatch"
          width={7}
          height={7}
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line x1={0} y1={0} x2={0} y2={7} stroke={INFO.threat} strokeWidth={2.2} opacity={0.4} />
        </pattern>
      </defs>

      <g transform={rotate ? `rotate(${rotate})` : undefined}>
      <WorldLayer radius={radius} size={hexSize} />

      {/* ── 信息层：范围填充 ── */}
      <g id="info-area" pointerEvents="none">
        {/* 威胁区铺在可行动范围**之下**：范围是「我要做什么」，威胁是「背景风险」 */}
        {enemyThreatHexes.map((h) => (
          <path key={`th-${h.q},${h.r}`} d={hexPath(h, hexSize)} fill="url(#sy-threat-hatch)" />
        ))}
        {highlightedHexes.map((h) => {
          const c = tileColor(h);
          const isHovered = hovered === `${h.q},${h.r}`;
          return (
            <g key={`hl-${h.q},${h.r}`}>
              <path
                d={hexPath(h, hexSize)}
                fill={c}
                opacity={isHovered ? INFO_FILL.hover : INFO_FILL.able}
              />
              <path
                className={isHovered ? undefined : 'info-ring'}
                d={hexPath(h, hexSize, 0.9)}
                fill="none"
                stroke={isHovered ? INFO.pick : c}
                strokeWidth={isHovered ? 2.2 : 1.6}
              />
            </g>
          );
        })}
        {/* 范围内真有敌军的格子：加深 + 挂矛尖，把"打得到"和"这一圈是范围"分开 */}
        {threatHexes.map((h) => (
          <path
            key={`th-${h.q},${h.r}`}
            d={hexPath(h, hexSize)}
            fill={INFO.threat}
            opacity={INFO_FILL.occupied - INFO_FILL.able}
          />
        ))}
      </g>

      {/* ── 信息层：标记 ── */}
      <g id="info-mark" pointerEvents="none">
        {player1Base && renderBase(player1Base, 'base1')}
        {player2Base && renderBase(player2Base, 'base2')}

        {/* 范围内的敌军：矛尖记号画在格子右上角，不压住棋子 */}
        {threatHexes.map((h) => {
          const c = hexToPixel(h, hexSize);
          return (
            <g key={`bl-${h.q},${h.r}`} transform={`translate(${c.x + hexSize * 0.58}, ${c.y - hexSize * 0.52})${upright}`}>
              {/* 空心 = 打得到，实心 = 这一下能杀。同一个字根，一个修饰 */}
              <Blade u={hexSize * 0.4} solid={isLethalHex(h)} />
            </g>
          );
        })}

        {/* 纵深抗击的盾：画在格子上沿，表示「这个方向背后有人顶着」 */}
        {shieldedHexes.map((h) => {
          const c = hexToPixel(h, hexSize);
          return (
            <g key={`sh-${h.q},${h.r}`} transform={`translate(${c.x - hexSize * 0.58}, ${c.y - hexSize * 0.52})${upright}`}>
              <Shield u={hexSize * 0.42} />
            </g>
          );
        })}

        {/* 悬停格的后果记号：只画当前这一格，放大显示。
          * 常态盘面不出现任何记号 —— 这是 M2 相对 M1（每格都挂记号）的取舍。 */}
        {highlightedHexes.map((h) => {
          if (hovered !== `${h.q},${h.r}`) return null;
          if (!h.damageUp && !h.noAttack) return null;
          const c = hexToPixel(h, hexSize);
          return (
            <g key={`hv-${h.q},${h.r}`} transform={`translate(${c.x}, ${c.y + hexSize * 0.5})${upright}`}>
              {h.noAttack
                ? <Blade u={hexSize * 0.5} color={INFO.muted} forbid />
                : <Barb u={hexSize * 0.5} />}
            </g>
          );
        })}

        {/* 步数提示：旧实现是深色小点（在浅底上还行，暗底上等于看不见），改成信息色 */}
        {highlightedHexes.map((h) => {
          if (!h.steps || h.steps < 1) return null;
          const c = hexToPixel(h, hexSize);
          const r = hexSize * 0.075;
          const gap = hexSize * 0.22;
          const offset = ((h.steps - 1) * gap) / 2;
          return (
            <g key={`st-${h.q},${h.r}`}>
              {Array.from({ length: h.steps }).map((_, i) => (
                <circle
                  key={i}
                  cx={c.x - offset + i * gap}
                  cy={c.y + hexSize * 0.42}
                  r={r}
                  fill={tileColor(h)}
                />
              ))}
            </g>
          );
        })}
      </g>

      {/* ── 点击热区：在填充之上、棋子之下 ── */}
      <g id="hit">
        {hexes.map((hex) => (
          <HexTile
            key={`${hex.q},${hex.r}`}
            hex={hex}
            size={hexSize}
            onClick={onHexClick}
            onHover={handleHover}
          />
        ))}
      </g>

      {/* ── 棋子层 ── */}
      <g id="pieces">{children}</g>

      {/* ── 最上层：选中框 + 伤害飘字。不填色，棋子不被吃掉 ── */}
      <g id="info-top" pointerEvents="none">
        {/* 飘字：外层属性定位，内层做 CSS 动画 —— CSS transform 会覆盖
            SVG 的 transform 属性，两者混在一个节点上飘字会从棋盘原点飞出去 */}
        {damageFlashes.map((f) => {
          const c = hexToPixel(f.position, hexSize);
          const lethal = f.kind === 'death';
          return (
            <g key={f.key} transform={`translate(${c.x}, ${c.y - hexSize * 0.3})${upright}`}>
              <g className="sy-damage-float">
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={hexSize * (lethal ? 0.58 : 0.48)}
                  fontFamily={PIECE_FONT}
                  fontWeight={700}
                  fill={INFO.threat}
                  stroke="rgba(0,0,0,0.65)"
                  strokeWidth={hexSize * 0.055}
                  paintOrder="stroke"
                >
                  {lethal ? '✕' : `−${f.amount}`}
                </text>
              </g>
            </g>
          );
        })}

        {selectedUnit && (
          <>
            <path
              d={hexPath(selectedUnit.position, hexSize, 0.96)}
              fill="none"
              stroke={INFO.pick}
              strokeWidth={2.6}
            />
            <path
              d={hexPath(selectedUnit.position, hexSize, 0.8)}
              fill="none"
              stroke={PIECE.rim}
              strokeWidth={1}
              opacity={0.6}
            />
          </>
        )}
      </g>
      </g>
    </svg>
  );
});

HexMap.displayName = 'HexMap';
