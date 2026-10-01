import React, { useRef, useCallback } from 'react';
import { HexCoord } from '../../types';
import { hexPath } from '../../utils/boardGeometry';

/**
 * 单个格子的**点击热区**。
 *
 * 规格：docs/board-art-spec.md §4.2 要求 4
 *
 * 这个组件以前既画外观又判断状态（普通/选中/高亮/部署区/大本营各一套 fill+stroke），
 * 导致一个格子只能表达一种状态 —— "可移动 + 敌方威胁"没法同时画出来，信息层扩展不了。
 *
 * 现在它只负责交互：一块透明的 path，外观全部交给 WorldLayer 与 InfoLayer。
 */
interface HexTileProps {
  hex: HexCoord;
  size: number;
  onClick?: (hex: HexCoord) => void;
  /** 鼠标进入/离开这一格。M2 的后果记号只画在当前悬停的那一格上 */
  onHover?: (hex: HexCoord | null) => void;
}

export const HexTile: React.FC<HexTileProps> = React.memo(({ hex, size, onClick, onHover }) => {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onClick) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }, [onClick]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!onClick || !touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = Math.abs(t.clientX - touchStart.current.x);
    const dy = Math.abs(t.clientY - touchStart.current.y);
    // 有明显滑动就不算点击，避免拖动棋盘时误触
    if (dx < 10 && dy < 10) {
      e.preventDefault(); // 否则紧随的 click 会再触发一次
      onClick(hex);
    }
    touchStart.current = null;
  }, [onClick, hex]);

  const handleEnter = useCallback(() => { onHover?.(hex); }, [onHover, hex]);
  const handleLeave = useCallback(() => { onHover?.(null); }, [onHover]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onClick) return;
    if (e.detail === 0) return; // 由触摸合成的 click，已在 touchEnd 处理过
    onClick(hex);
  }, [onClick, hex]);

  return (
    <path
      d={hexPath(hex, size)}
      fill="transparent"
      stroke="none"
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        touchAction: 'none',
      }}
    />
  );
});

HexTile.displayName = 'HexTile';
