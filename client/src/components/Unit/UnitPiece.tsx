import React, { useRef, useCallback } from 'react';
import { Unit, UnitType, Player, Direction } from '../../types';
import { hexToPixel } from '../../utils/hexUtils';

interface UnitPieceProps {
  unit: Unit;
  hexSize: number;
  onClick?: (unit: Unit) => void;
  isSelected?: boolean;
}

export const UnitPiece: React.FC<UnitPieceProps> = ({
  unit,
  hexSize,
  onClick,
  isSelected = false,
}) => {
  const center = hexToPixel(unit.position, hexSize);
  const size = hexSize * 0.7; // 增大单位尺寸

  // 处理触摸事件（移动端兜底）
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onClick) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, [onClick]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!onClick || !touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

    // 只有在没有明显滑动的情况下才触发点击（防止误触）
    if (deltaX < 10 && deltaY < 10) {
      e.preventDefault(); // 防止触发 click 事件导致双重触发
      onClick(unit);
    }

    touchStartRef.current = null;
  }, [onClick, unit]);

  const handleClick = useCallback(() => {
    if (!onClick) return;
    onClick(unit);
  }, [onClick, unit]);

  // 根据玩家确定颜色
  const getUnitColor = () => {
    if (unit.owner === Player.PLAYER1) {
      return {
        primary: '#f59e0b',   // 橙色
        secondary: '#fbbf24', // 浅橙
        stroke: '#92400e',    // 深橙
        text: '#ffffff',
      };
    } else if (unit.owner === Player.PLAYER2) {
      return {
        primary: '#3b82f6',   // 蓝色
        secondary: '#60a5fa', // 浅蓝
        stroke: '#1e3a8a',    // 深蓝
        text: '#ffffff',
      };
    } else {
      return {
        primary: '#9ca3af',
        secondary: '#d1d5db',
        stroke: '#4b5563',
        text: '#ffffff',
      };
    }
  };

  const colors = getUnitColor();

  // 根据单位类型绘制不同形状
  const renderUnitShape = () => {
    switch (unit.type) {
      case UnitType.INFANTRY:
        // 步兵 - 圆形
        return (
          <g>
            <circle
              cx={center.x}
              cy={center.y}
              r={size / 2}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.5}
              fill={colors.text}
              fontWeight="bold"
            >
              步
            </text>
          </g>
        );

      case UnitType.CAVALRY:
        // 骑兵 - 菱形
        const diamondPoints = `
          ${center.x},${center.y - size / 2}
          ${center.x + size / 2},${center.y}
          ${center.x},${center.y + size / 2}
          ${center.x - size / 2},${center.y}
        `;
        return (
          <g>
            <polygon
              points={diamondPoints}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.5}
              fill={colors.text}
              fontWeight="bold"
            >
              骑
            </text>
          </g>
        );

      case UnitType.ARCHER:
        // 弓箭手 - 三角形
        const trianglePoints = `
          ${center.x},${center.y - size / 2}
          ${center.x + size / 2},${center.y + size / 2}
          ${center.x - size / 2},${center.y + size / 2}
        `;
        return (
          <g>
            <polygon
              points={trianglePoints}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <text
              x={center.x}
              y={center.y + size * 0.1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.45}
              fill={colors.text}
              fontWeight="bold"
            >
              弓
            </text>
          </g>
        );

      case UnitType.GENERAL:
        // 将军 - 五角星
        const starPoints = [];
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI / 2) + (i * 2 * Math.PI / 5);
          const outerRadius = size / 2;
          const innerRadius = size / 4;

          // 外点
          starPoints.push(
            `${center.x + outerRadius * Math.cos(angle)},${center.y - outerRadius * Math.sin(angle)}`
          );
          // 内点
          const innerAngle = angle + Math.PI / 5;
          starPoints.push(
            `${center.x + innerRadius * Math.cos(innerAngle)},${center.y - innerRadius * Math.sin(innerAngle)}`
          );
        }
        return (
          <g>
            <polygon
              points={starPoints.join(' ')}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <circle
              cx={center.x}
              cy={center.y}
              r={size / 4}
              fill={colors.secondary}
              stroke={colors.stroke}
              strokeWidth={2}
            />
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.35}
              fill={colors.text}
              fontWeight="bold"
            >
              将
            </text>
          </g>
        );

      case UnitType.NEUTRAL_MARKER:
        // 中立单位标记 - 小圆形带"中"字
        return (
          <g>
            <circle
              cx={center.x}
              cy={center.y}
              r={size / 3}
              fill="#9ca3af"
              stroke="#4b5563"
              strokeWidth={2}
            />
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.35}
              fill="#ffffff"
              fontWeight="bold"
            >
              中
            </text>
          </g>
        );

      default:
        return (
          <circle
            cx={center.x}
            cy={center.y}
            r={size / 2}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );
    }
  };

  // 绘制方向指示器 (弓箭手需要)
  const renderDirectionIndicator = () => {
    if (unit.type !== UnitType.ARCHER && unit.type !== UnitType.BALLISTA) return null;

    // 对于 flat-top 六边形，6个边的角度 + 正北/正南
    const angleMap: Record<Direction, number> = {
      [Direction.EAST]: 0,          // 东 (正右)
      [Direction.NORTH_EAST]: -60,  // 东北
      [Direction.NORTH_WEST]: -120, // 西北
      [Direction.WEST]: 180,        // 西 (正左)
      [Direction.SOUTH_WEST]: 120,  // 西南
      [Direction.SOUTH_EAST]: 60,   // 东南
      [Direction.NORTH]: -90,       // 北 (正上)
      [Direction.SOUTH]: 90,        // 南 (正下)
    };

    const angle = angleMap[unit.direction];
    const arrowLength = size * 0.8;
    const arrowX = center.x + Math.cos((angle * Math.PI) / 180) * arrowLength;
    const arrowY = center.y + Math.sin((angle * Math.PI) / 180) * arrowLength;

    return (
      <>
        <defs>
          <marker
            id={`arrowhead-${unit.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#dc2626" />
          </marker>
        </defs>
        <line
          x1={center.x}
          y1={center.y}
          x2={arrowX}
          y2={arrowY}
          stroke="#dc2626"
          strokeWidth={4}
          markerEnd={`url(#arrowhead-${unit.id})`}
        />
      </>
    );
  };

  // HP 指示器
  const renderHPIndicator = () => {
    if (unit.hp === unit.maxHp) return null; // 满血不显示

    const barWidth = size;
    const barHeight = 6;
    const barX = center.x - barWidth / 2;
    const barY = center.y - size / 2 - 10;

    return (
      <g>
        {/* 背景 */}
        <rect
          x={barX}
          y={barY}
          width={barWidth}
          height={barHeight}
          fill="#1f2937"
          rx={3}
        />
        {/* HP */}
        <rect
          x={barX + 1}
          y={barY + 1}
          width={(barWidth - 2) * (unit.hp / unit.maxHp)}
          height={barHeight - 2}
          fill="#ef4444"
          rx={2}
        />
      </g>
    );
  };

  return (
    <g
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`unit-piece ${isSelected ? 'unit-selected' : ''}`}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        touchAction: 'none', // 防止默认的触摸行为（如滚动）
      }}
    >
      {/* 选中高亮 */}
      {isSelected && (
        <>
          <circle
            cx={center.x}
            cy={center.y}
            r={size / 2 + 8}
            fill="none"
            stroke="#10b981"
            strokeWidth={4}
            opacity={0.6}
          />
          <circle
            cx={center.x}
            cy={center.y}
            r={size / 2 + 8}
            fill="none"
            stroke="#10b981"
            strokeWidth={4}
            className="animate-pulse"
          />
        </>
      )}

      {/* 单位主体 */}
      {renderUnitShape()}

      {/* 方向指示器 */}
      {renderDirectionIndicator()}

      {/* HP 指示器 */}
      {renderHPIndicator()}
    </g>
  );
};
