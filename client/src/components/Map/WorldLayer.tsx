import React, { useMemo } from 'react';
import { generateHexMap } from '../../utils/hexUtils';
import { hexPath, seamPath, boardViewBox } from '../../utils/boardGeometry';
import { WORLD } from '../../theme/boardTheme';

/**
 * 世界层：锈青铜底板 + 内凹的格子 + 凸起的铜脊缝线 + 极淡回纹
 *
 * 规格：docs/board-art-spec.md §2 §4.2
 *
 * 两条硬要求：
 *
 * 1. **只依赖 [radius, size]**，整层 memo 成一次性产物。
 *    半径 5 = 91 格 × 3 个 path（填充 / 回纹 / 内边）= 273 个节点，
 *    选中单位时重算这一层纯属浪费 —— 旧实现是 91 个 HexTile 组件各自重渲染。
 *
 * 2. **缝线单遍绘制**。逐格描边会把共享边画两遍，叠加后缝线粗细不均。
 *
 * 格子"刻进去"的做法是内边一圈上亮下暗；反过来（上暗下亮）就成了浮雕凸起。
 */
interface WorldLayerProps {
  radius: number;
  size: number;
}

export const WorldLayer: React.FC<WorldLayerProps> = React.memo(({ radius, size }) => {
  const { cells, seam, vb } = useMemo(() => {
    const map = generateHexMap(radius);
    return {
      cells: map.map((hex) => ({
        key: `${hex.q},${hex.r}`,
        d: hexPath(hex, size),
        dInner: hexPath(hex, size, 0.95),
        // 双方起始区各三排，比交战区亮一档。只用明度，不用色相。
        fill: Math.abs(hex.r) >= 3 ? WORLD.cellZone : WORLD.cellBattle,
      })),
      seam: seamPath(radius, size),
      vb: boardViewBox(radius, size),
    };
  }, [radius, size]);

  return (
    <g id="world" aria-hidden="true">
      {/* 漆盘底：中心受光 */}
      <rect
        x={vb.minX}
        y={vb.minY}
        width={vb.width}
        height={vb.height}
        fill="url(#sy-plate)"
      />

      {/* 格子本体 */}
      {cells.map((c) => (
        <path key={c.key} d={c.d} fill={c.fill} />
      ))}

      {/* 回纹：铺在格子之上、缝线之下，对比度 <3% */}
      {cells.map((c) => (
        <path key={`hui-${c.key}`} d={c.d} fill="url(#sy-hui)" />
      ))}

      {/* 凹陷的内边：上亮下暗 */}
      {cells.map((c) => (
        <path
          key={`lip-${c.key}`}
          d={c.dInner}
          fill="none"
          stroke="url(#sy-lip)"
          strokeWidth={2.6}
        />
      ))}

      {/* 凸起的铜脊：整张盘一个 path，每条边只画一次 */}
      <path
        d={seam}
        fill="none"
        stroke={WORLD.seam}
        strokeWidth={1.4}
        shapeRendering="geometricPrecision"
      />
    </g>
  );
});

WorldLayer.displayName = 'WorldLayer';

/**
 * 世界层用到的全局 defs。
 *
 * 必须由 HexMap 在 SVG 顶层渲染一次 —— 旧实现是每个格子自带一个 <defs>
 * （选中滤镜按 hex.q,hex.r 拼 id），91 个格子就有 91 份，随组件进出 DOM 反复增删。
 */
export const WorldDefs: React.FC = React.memo(() => (
  <>
    <radialGradient id="sy-plate" cx="50%" cy="42%" r="72%">
      <stop offset="0%" stopColor={WORLD.plateInner} />
      <stop offset="100%" stopColor={WORLD.plateOuter} />
    </radialGradient>

    <linearGradient id="sy-lip" x1="18%" y1="0%" x2="82%" y2="100%">
      <stop offset="0%" stopColor={WORLD.lipTop} />
      <stop offset="48%" stopColor={WORLD.lipMid} />
      <stop offset="100%" stopColor={WORLD.lipBottom} />
    </linearGradient>

    <pattern id="sy-hui" width="26" height="26" patternUnits="userSpaceOnUse">
      <path
        d="M5,5 H21 V21 H9 V13 H17"
        fill="none"
        stroke={WORLD.huiPattern}
        strokeWidth={1.4}
      />
    </pattern>
  </>
));

WorldDefs.displayName = 'WorldDefs';
