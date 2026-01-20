import React, { useRef, useCallback, useState, useEffect } from 'react';
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

  // 跟踪移动状态
  const [isMoving, setIsMoving] = useState(false);
  const prevPositionRef = useRef(unit.position);

  // 跟踪旋转状态
  const [isRotating, setIsRotating] = useState(false);
  const prevDirectionRef = useRef(unit.direction);

  // 检测位置变化并触发移动动画
  useEffect(() => {
    const prevPos = prevPositionRef.current;
    const currentPos = unit.position;

    // 如果位置改变了，触发移动动画
    if (prevPos.q !== currentPos.q || prevPos.r !== currentPos.r || prevPos.s !== currentPos.s) {
      setIsMoving(true);

      // 300ms 后移除移动状态
      const timer = setTimeout(() => {
        setIsMoving(false);
      }, 300);

      prevPositionRef.current = currentPos;

      return () => clearTimeout(timer);
    }
  }, [unit.position]);

  // 检测方向变化并触发旋转动画
  useEffect(() => {
    const prevDir = prevDirectionRef.current;
    const currentDir = unit.direction;

    // 如果方向改变了，触发旋转动画
    if (prevDir !== currentDir) {
      setIsRotating(true);

      // 300ms 后移除旋转状态
      const timer = setTimeout(() => {
        setIsRotating(false);
      }, 300);

      prevDirectionRef.current = currentDir;

      return () => clearTimeout(timer);
    }
  }, [unit.direction]);

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
              cx={0}
              cy={0}
              r={size / 2}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <text
              x={0}
              y={0}
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
        const diamondPoints = `0,${-size / 2} ${size / 2},0 0,${size / 2} ${-size / 2},0`;
        return (
          <g>
            <polygon
              points={diamondPoints}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.4}
              fill={colors.text}
              fontWeight="bold"
            >
              骑
            </text>
          </g>
        );

      case UnitType.ARCHER:
        // 弓箭手 - 三角形
        const trianglePoints = `0,${-size / 2} ${size / 2},${size / 2} ${-size / 2},${size / 2}`;
        return (
          <polygon
            points={trianglePoints}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );

      case UnitType.GENERAL:
        // 将军 - 五角星
        const starPointsArray = [];
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI / 2) + (i * 2 * Math.PI / 5);
          const outerRadius = size / 2;
          const innerRadius = size / 4;

          // 外点
          starPointsArray.push(
            `${outerRadius * Math.cos(angle)},${-outerRadius * Math.sin(angle)}`
          );
          // 内点
          const innerAngle = angle + Math.PI / 5;
          starPointsArray.push(
            `${innerRadius * Math.cos(innerAngle)},${-innerRadius * Math.sin(innerAngle)}`
          );
        }
        const starPoints = starPointsArray.join(' ');
        return (
          <g>
            <polygon
              points={starPoints}
              fill={colors.primary}
              stroke={colors.stroke}
              strokeWidth={3}
            />
            <circle
              cx={0}
              cy={0}
              r={size / 4}
              fill={colors.secondary}
              stroke={colors.stroke}
              strokeWidth={2}
            />
          </g>
        );

      case UnitType.NEUTRAL_MARKER:
        // 中立单位标记 - 小圆形
        return (
          <circle
            cx={0}
            cy={0}
            r={size / 3}
            fill="#9ca3af"
            stroke="#4b5563"
            strokeWidth={2}
          />
        );

      case UnitType.BALLISTA:
        // 弩车 - 倒V形三角形（有方向指示）
        const ballistaTrianglePoints = `0,${size / 2} ${size / 2},${-size / 2} ${-size / 2},${-size / 2}`;
        return (
          <polygon
            points={ballistaTrianglePoints}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );

      case UnitType.CHARIOT:
        // 战车 - 圆形
        return (
          <circle
            cx={0}
            cy={0}
            r={size / 2}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );

      case UnitType.CATAPULT:
        // 投石车 - V形三角形（有方向指示，类似弓箭手）
        const catapultTrianglePoints = `0,${-size / 2} ${size / 2},${size / 2} ${-size / 2},${size / 2}`;
        return (
          <polygon
            points={catapultTrianglePoints}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );

      default:
        return (
          <circle
            cx={0}
            cy={0}
            r={size / 2}
            fill={colors.primary}
            stroke={colors.stroke}
            strokeWidth={3}
          />
        );
    }
  };

  // 绘制方向指示器 (弓箭手、弩车、投石车需要)
  const renderDirectionIndicator = () => {
    if (unit.type !== UnitType.ARCHER && unit.type !== UnitType.BALLISTA && unit.type !== UnitType.CATAPULT) return null;

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
        <g
          className="direction-indicator"
          transform={`rotate(${angle})`}
        >
          <line
            x1={0}
            y1={0}
            x2={arrowLength}
            y2={0}
            stroke="#dc2626"
            strokeWidth={4}
            markerEnd={`url(#arrowhead-${unit.id})`}
          />
        </g>
      </>
    );
  };

  // HP 指示器
  const renderHPIndicator = () => {
    if (unit.hp === unit.maxHp) return null; // 满血不显示

    const barWidth = size;
    const barHeight = 6;
    const barX = -barWidth / 2;
    const barY = -size / 2 - 10;

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
      className={`unit-piece ${isSelected ? 'unit-selected' : ''} ${isMoving ? 'unit-moving' : ''}`}
      transform={`translate(${center.x}, ${center.y})`}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        touchAction: 'none', // 防止默认的触摸行为（如滚动）
      }}
    >
      {/* 选中高亮 */}
      {isSelected && (
        <>
          <circle
            cx={0}
            cy={0}
            r={size / 2 + 8}
            fill="none"
            stroke="#10b981"
            strokeWidth={4}
            opacity={0.6}
          />
          <circle
            cx={0}
            cy={0}
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
