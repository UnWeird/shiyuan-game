import { useEffect, useState } from 'react';

/**
 * 视口宽度断点 Hook
 *
 * 这里刻意只看视口宽度，不做 UA 嗅探、不看是否支持触摸。
 *
 * 原来的实现是 `UA 命中手机关键词 || (宽度 < 768 && 支持触摸)`，用来切整套布局，
 * 结果有两个真实问题：
 *
 *   1. 桌面浏览器把窗口拖窄（分屏到 500px）—— 宽度够窄但没有触摸能力，
 *      判定为「非移动」，于是 4 栏网格挤在 500px 里，侧栏被压成一字一行。
 *   2. iPad 横屏 1024px 以上 —— UA 里有 ipad，判定为「移动」，
 *      于是大屏上用单栏窄布局。
 *
 * 也就是说：同样宽的窗口，会因为设备有没有触摸屏而给出不同布局。
 * 布局该由可用宽度决定，跟设备类型无关。
 *
 * 真正需要区分触摸的地方（点击热区、hover 行为）应当单独判断，
 * 而不是复用布局断点 —— 目前所有调用点都是布局/尺寸，没有这种需求。
 */
export function useIsNarrowScreen(breakpoint: number = 768): boolean {
  // 初始值直接读一次，避免首帧用错布局再闪一下
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsNarrow(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [breakpoint]);

  return isNarrow;
}

/**
 * 对局界面能不能摆一条右侧栏。
 *
 * 这是**另一个断点**，不要和 useIsNarrowScreen(768) 复用 —— 两者语义不同：
 *   768  「视口窄不窄」：决定格子尺寸、内边距、点击热区这类细节
 *   1024 「摆不摆得下侧栏」：决定棋盘和面板是并排还是上下堆叠
 *
 * 为什么是 1024：右栏下限 264px。在 820px 视口下并排摆，棋盘列只剩 516px，
 * 棋盘被宽度卡在 482×424，而此时视口有 1180 的高度完全用不上 ——
 * 实测比堆叠布局的 780×686 小了 24% 面积。
 * 见 docs/layout-spec.md §3.4
 */
export function useHasSideRail(): boolean {
  return !useIsNarrowScreen(1024);
}

/**
 * 竖屏：视口高大于宽。
 *
 * 用来决定棋盘是否旋转 90°（见 docs/layout-spec.md §3.6）。
 * 棋盘 viewBox 是 772.8 × 680，**宽大于高** —— 放在竖屏上只能按宽度缩，
 * 高度方向大量浪费。转 90° 之后长宽比从 1.137 变成 0.88，正好贴合竖屏。
 * 实测 375×812 下棋盘面积 +29%（359×316 → 359×408）。
 */
export function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  );

  useEffect(() => {
    // 直接比视口宽高，不用 `(orientation: portrait)` 媒体特性 ——
    // 它在桌面浏览器的视口模拟下不随模拟尺寸更新（实测把 375×812 改回 1440×900
    // 之后 mql.matches 仍是 true，棋盘卡在旋转状态）。
    // 而且这里要的本来就是「视口是不是竖的」，和设备朝向无关。
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return portrait;
}

/**
 * 兼容旧名字。语义已改为「视口是否窄」，与设备类型无关。
 * @deprecated 请直接用 useIsNarrowScreen，名字更准确
 */
export const useIsMobile = useIsNarrowScreen;
