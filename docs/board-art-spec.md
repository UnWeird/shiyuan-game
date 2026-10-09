# 十元棋 · 棋盘美术技术方案 v1

> 状态：**规格已定，实现待排期**。本文档是交付给实现方的唯一规格来源。
> 配套可视原型（已验证可跑）：
> - `docs/prototypes/dev-bronze-lab.html` — 最终方案（棋子材质 / 可达区 / 攻击范围）
> - `docs/prototypes/dev-board-lab.html` — 棋盘体系比较 + 记号图例
> - `docs/prototypes/dev-piece-lab.html` — 棋子信息通道 + 规则暗示层
> - `docs/prototypes/dev-lab-core.js` — 几何与绘制核心，与 `shared/utils/hexUtils.ts` 对齐
>
> 这四个文件是 **dev-only 原型**，不属于产品代码。实现完成后应从 `client/public/` 移出
> （`public/` 会被打进 dist），建议迁到 `docs/prototypes/` 或删除。

---

## 0. 决议清单

| 项 | 决议 |
|---|---|
| 棋盘体系 | **青铜器**：锈青铜底板 + 格子内凹 + 凸起铜脊缝线 + 极淡回纹 |
| 棋子 | **T2 玉石嵌片**：朱玉 / 青玉平面圆片 + 金错细边，**无厚度、无投影** |
| 汉字 | **水平 + 垂直居中**，不加任何 y 偏移 |
| 移动范围 | **M2**：常态只显示三段语义色带，记号仅在悬停格放大出现，棋子旁挂三格色键 |
| 攻击范围 | **全部用格子高亮，一律不画连线**。三种形态（射线 / 相邻环 / 扇形）是同一套规则的三种应用，不是三选一 |
| 盘面文字 | **零文字**。全部用记号 + 统一图例 |
| 明度方向 | **暗底**。信息层只做加光，永不靠压暗表达状态 |

---

## 1. 三层约束（本方案最重要的一条）

渲染分三层，**各层的色彩权限互不重叠**。任何新增视觉元素，第一个问题是"它属于哪一层"。

| 层 | 内容 | 色彩权限 |
|---|---|---|
| **世界层** | 铜底板、凹格、铜脊缝线、回纹、分区、外框 | 只许用**明度**区分。饱和度上限 ~15%。禁止使用任何信息色 |
| **信息层** | 可达区色带、射界、攻击范围、威胁区、告警环、全部记号 | **只许用下表四色**，语义锁死，不得挪用 |
| **棋子层** | 玉片本体、金错边、汉字、体力弧、移动弧、朝向尖、已行动遮罩 | 阵营色**只允许出现在这一层** |

### 信息色（锁定，不可扩展）

| 色 | 值 | 语义 | 反例（禁止） |
|---|---|---|---|
| 青 | `#5BC8E8` | 我方可移动 | 不得用于"敌方"或装饰 |
| 琥珀 | `#F0B44A` | 朝向 / 射界 / 伤害加成 / 友伤预警 | 不得用于普通高亮 |
| 朱 | `#E2564B` | 敌方威胁 / 可攻击 / 致命 / 本营告警 | 不得用于玩家一阵营色（阵营色在棋子层） |
| 白 | `#FFFFFF` | 当前选中 / 当前悬停 | 不得用于其他任何状态 |

> **为什么必须暗底**：浅底下信息层只能往"更暗"走，而暗 = 禁用/失效，语义天然拧着。
> 现网 `.hex-movable` 把淡金压到 `fill-opacity: .35`，深底透上来变成脏橄榄绿、比普通格更暗，
> 这就是"可移动格看起来像偏移阴影"的根因。换皮解决不了，必须翻转明度方向。

---

## 2. 设计令牌：重写 `client/src/theme/boardTheme.ts`

现有文件是一张浅底色表，需整体替换。新结构按三层分组，**信息色单独导出且不参与主题切换**。

```ts
/** ── 世界层：青铜 ── 只有明度差，饱和度极低 */
export const WORLD = {
  plateInner: '#201E15',   // 底板径向渐变内圈
  plateOuter: '#121109',   // 底板径向渐变外圈
  cellZone:   '#23221A',   // 起始区格（亮一档）
  cellBattle: '#1C1B14',   // 交战区格（暗一档）
  seam:       'rgba(176,158,106,0.30)',  // 凸起铜脊，单遍绘制
  lipTop:     'rgba(255,228,170,0.30)',  // 凹格内边：上亮
  lipBottom:  'rgba(0,0,0,0.34)',        // 凹格内边：下暗
  huiPattern: 'rgba(255,228,170,0.028)', // 回纹，对比度必须 < 3%
} as const;

/** ── 信息层：语义锁死，禁止扩展 ── */
export const INFO = {
  move:   '#5BC8E8',
  face:   '#F0B44A',
  threat: '#E2564B',
  pick:   '#FFFFFF',
  /** 骑兵第 3 段「不可攻击」的失色档 */
  muted:  'rgba(176,196,214,0.95)',
} as const;

/** ── 棋子层：玉石材质 ── */
export const PIECE = {
  p1: { face:'#D98A74', glyph:'#6E2317' },  // 朱玉
  p2: { face:'#8FC4A6', glyph:'#1D5B42' },  // 青玉
  rim: '#C9A227',                            // 金错边（双方共用）
  neutral:  { face:'#BDB49E', glyph:'#3E3626' },
  huangjin: { face:'#D4B55E', glyph:'#4A3A10' },
} as const;
```

**注意**：`IMPERIAL` 色板仍被菜单/大厅/规则书使用，不要删。
古风浓度保留在**外框、字体、音效、结算印章**上——那些地方不承载信息。

---

## 3. 记号库：新增 `client/src/theme/glyphs.tsx`

替代盘面上所有文字。核心不是"每条规则一个图标"，而是**少量字根 + 组合规则**。

### 组合语法

```
矛尖  ◇            = 攻击
矛尖 + 实心        = 致命（这一下能杀）
矛尖 + 划掉        = 不可攻击       ← 骑兵冲 3 格的代价
矛尖 + 换琥珀      = 友伤           ← 战车冲锋带
矛尖 + 倒钩        = 伤害加成       ← 骑兵冲 2 格的奖励
```

四条规则共用一个字根，玩家只需认一次。

### API

所有函数返回以原点为中心的 SVG 片段，`u` 为基准尺寸（建议 `hexSize * 0.5`）。
统一线宽 `u * 0.16`、统一圆端 `stroke-linecap="round"`。

| 函数 | 含义 | 用在哪 |
|---|---|---|
| `chevron(n, u, c)` | 行进（n 个尖角） | 色键里标示"普通移动" |
| `blade(u, c, {solid, forbid})` | 攻击 / 致命 / 禁止 | 攻击范围、骑兵第 3 段 |
| `barb(u, c)` | 伤害加成 | 骑兵第 2 段 |
| `shield(u, c)` | 免伤 / 方阵 | 步兵阵列队首 |
| `rotate(u, c)` | 转向 | 配 `pips` 表示行动点成本 |
| `pips(n, u, c)` | 任何"可数的量" | 行动点、投石车蓄力、本营剩余步数 |
| `banner(u, c)` | 大本营 | 本营格 |
| `slash(u, c)` | 否定 / 已行动 | 棋子遮罩、禁止组合 |
| `arrow(len, u, c)` | 强制位移 | 击退、战车冲锋带 |

实现参考 `dev-lab-core.js` 的 `G` 对象，可直接移植（需从模板字符串改为 JSX / React 片段）。

### 图例组件：新增 `client/src/components/UI/LegendPanel.tsx`

13 个记号 + 一句话说明的两列表格。两个入口：

1. 规则书首屏第一节（在"棋子类型"之前）
2. 对局内可折叠侧栏（默认收起，记住用户选择）

---

## 4. 渲染架构重构

### 4.1 现状的三个结构性问题

| 问题 | 位置 | 后果 |
|---|---|---|
| **棋盘与棋子是两个重叠的 `<svg>`** | `GameBoard.tsx:1961` 的 `<HexMap>` + `GameBoard.tsx:1968` 的第二个 `<svg>` | 实测尺寸 920×664 vs 922×666 —— 两层**本来就差 2px**，任何缩放/边距改动都会放大成可见错位 |
| **状态烘进格子的 fill** | `HexTile.tsx:65-91` | 一个格子只能有一种状态；"可移动 + 敌方威胁"无法同时表达，信息层扩展不了 |
| **每个格子自带 `<defs>`** | `HexTile.tsx:99-113`（选中滤镜）、`UnitPiece.tsx:467`（每单位一个渐变） | 半径 5 = **91 个格子**，defs 随组件进出 DOM 反复增删 |

另外：`HexTile` 用 `vectorEffect: non-scaling-stroke` 逐格描边，**共享边被画两遍**，
叠加后缝线粗细不均，这是"格子边缘发脏"的来源。

### 4.2 目标结构：单 SVG + 五个层

```
<svg viewBox=…>                      ← 只有这一个 SVG
  <defs>  …全局唯一：渐变 / pattern / filter / clipPath…  </defs>

  <g id="world">      铜底板 + 凹格 + 回纹 + 单遍铜脊      ← 静态，只随 hexSize/radius 变
  <g id="info-area">  可达区色带 / 射界 / 攻击范围 / 威胁斜纹  ← 随 selectedUnit 变
  <g id="info-mark">  悬停后果记号 / 矛尖 / 盾 / 牙旗 / 告警环   ← 随 hoveredHex 变
  <g id="pieces">     棋子令牌                            ← 随 units 变
  <g id="info-top">   选中白框 / 拖拽预览 / 幽灵棋子          ← 随交互变
</svg>
```

**要求**

1. **世界层必须 memo 成一次性产物**。只依赖 `[radius, hexSize]`。
   91 个格子 × 3 个 path（填充 / 回纹 / 内边）＝ 273 个节点，不能每次 selection 变化都重算。
   建议：`useMemo` 返回一段 JSX，或直接预生成字符串用 `dangerouslySetInnerHTML` 挂进 `<g>`。
2. **缝线单遍绘制**，输出单个 `<path>`。

   去重键**必须用整数格坐标对**，不能用像素坐标 —— 这是一个实测踩到的坑：
   像素坐标含 √3 无理因子，两个相邻格算同一个顶点时会落在 `26.649999 / 26.650001`
   这类小数边界两侧，`toFixed(1)` 得到不同字符串，那条共享边就被画了两遍。
   半径 5 时实测漏掉 **14 条**（留下 320 条，应为 306 条），表现为局部缝线偏粗。

   正确做法（已在 `dev-lab-core.js` 的 `seamPath()` 修好并验证）：
   顶点角为 `60i+30` 时，边 `i`（顶点 i → i+1）的外法线朝向 `60(i+1)°`，
   因此边与邻居方向的对应关系是固定的：

   ```ts
   const EDGE_DIR = ['SE','SW','W','NW','NE','E'];   // 边 i 对应的邻居方向
   // key = 两个格坐标排序后拼接，纯整数，零浮点误差
   const k = me < nb ? `${me}|${nb}` : `${nb}|${me}`;
   ```
3. **所有 `<defs>` 上提到顶层**，id 用稳定常量（`#lip` / `#hui` / `#plate` / `#hatch`），
   不再按 `unit.id` / `hex.q,r` 拼 id。
4. `HexTile` 降级为纯展示：只接 `d` 和 `fill`，不再判断状态。状态表达全部移到 info 层。
5. 删掉 `GameBoard.tsx` 里第二个 `<svg>`，棋子直接进 `#pieces` 层。

### 4.3 文件清单

| 文件 | 动作 |
|---|---|
| `client/src/theme/boardTheme.ts` | **重写**（见 §2） |
| `client/src/theme/glyphs.tsx` | **新增**（见 §3） |
| `client/src/components/Map/HexMap.tsx` | **重构**为单 SVG + 五层 |
| `client/src/components/Map/WorldLayer.tsx` | **新增**，静态铜板 |
| `client/src/components/Map/InfoLayer.tsx` | **新增**，范围 + 记号 |
| `client/src/components/Map/HexTile.tsx` | **简化**为纯 path |
| `client/src/components/Unit/UnitPiece.tsx` | **重写**为 T2 令牌（见 §5） |
| `client/src/components/UI/LegendPanel.tsx` | **新增** |
| `client/src/components/Game/GameBoard.tsx` | 删除第二个 SVG，接 hover 状态 |
| `client/src/animations.css` | 删除 `fill-opacity` 类动画，改为环透明度脉动 |

---

## 5. 棋子令牌规格（T2 玉石嵌片）

### 几何

以 `rr = hexSize * 0.45` 为令牌半径（hexSize 40 → rr 18）。全部平面，**无渐变、无投影**。

| 元素 | 几何 | 颜色 |
|---|---|---|
| 玉片本体 | `circle r=rr` | `PIECE[side].face` |
| 金错内边 | `circle r=rr*0.9`，`stroke-width=rr*0.063` | `PIECE.rim` |
| 汉字 | 见下 | `PIECE[side].glyph` |
| 体力弧 | `r=rr*1.3`，上方 104° 按体力上限等分，间隙 16° | 亮 `#F3E6CA` / 熄 `rgba(160,150,135,.3)` |
| 移动弧 | `r=rr*1.3`，下方每格一道 20° 弧，间隙 12° | `INFO.move` |
| 朝向尖 | 三角形 `rr*1.42 → rr*2.0`，半宽 `rr*0.5`，外加 `rr*0.96→rr*1.4` 连杆 | `INFO.face` |
| 蓄力点 | `cy = -rr*1.62`，`pips(n)` | `INFO.face` |
| 已行动 | `circle r=rr fill=#070A0D opacity=.58` + `slash` | — |

> **朝向尖必须画在弧之外**（弧半径 1.3rr）。原型初版画在 `0.6rr→1.44rr`，
> 被体力弧盖住，朝向几乎不可见——这是必须避开的坑。

### 汉字居中（决议项）

```tsx
<text x={0} y={0}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={rr * 0.86}
      fontWeight={600}
      fill={glyph}>{ch}</text>
```

- 水平：`textAnchor="middle"`
- 垂直：`dominantBaseline="central"` ——**不是 `"middle"`**。`middle` 是字母中线，CJK 下会偏下。
- **不加任何 `y` / `dy` 偏移**。CJK 字形的墨区本就居中于 em 框。
- 兼容性兜底：若在目标浏览器实测仍偏移，退回 `dy="0.36em"` 且不设 `dominantBaseline`，
  二者不要同时使用。

### 信息通道对照

一枚令牌承载 6 条信息，侧边栏的 `类型: archer / 生命: 2/2 / 行动: 0/2` 可整块删除
（顺带修掉现网把枚举值 `archer` 直接显示给玩家的问题）。

| 通道 | 编码 |
|---|---|
| 玉片色 | 阵营 |
| 汉字 | 兵种 |
| 上弧分段 | 体力上限 / 当前体力 |
| 下弧刻度 | 移动力 |
| 朝向尖 | 朝向（仅弓 / 弩 / 投石） |
| 压暗 + 斜杠 | 已行动 |
| 顶部圆点 | 投石车蓄力层数 |

### 骑兵掉马

汉字由「骑」换为「步」，下弧由 3 道变 1 道，上弧保留 1 段 —— 玩家能直接看懂"它降级了"。

---

## 6. 范围层规格

### 6.1 移动可达区（M2）

**核心原则：颜色不编码"远近"，编码"落在这里会发生什么"。**
距离本身不需要画 —— 玩家看格子就能数。

| 段 | 条件 | 底色 | 填充不透明度 | 环 |
|---|---|---|---|---|
| 1 | `steps === 1` | `INFO.move` | 0.13 | `INFO.move`，1.4px，k=0.9 |
| 2 | `steps === 2` | `INFO.face` | 0.19 | `INFO.face`，1.4px，k=0.9 |
| 3 | `steps === 3` | `INFO.muted` | 0.13 | `INFO.muted`，1.4px，k=0.9 |

对应规则：1 格无效果 / 2 格伤害 +1 / 3 格本回合不可攻击。
第 2 段最亮最诱人（是奖励），第 3 段失色（是代价）—— 明度本身就在传达价值。

**常态盘面只有色带，没有任何记号。** 记号只在交互时出现：

| 触发 | 表现 |
|---|---|
| 悬停某格 | 该格填充提到 0.40，加 `INFO.pick` 白框 2.2px；格心放大显示后果记号（第 2 段 `barb`、第 3 段 `blade{forbid}`、第 1 段无） |
| 选中单位 | 棋子左侧挂**三格色键**：三个 14×10 色块 + 对应记号，不占盘面 |

> 色键在原型里画在盘面上（`dev-bronze-lab.html` 的 M2）。
> **实装时应改为 DOM 浮层，锚定在棋子屏幕坐标旁**，不要画进 SVG —— 否则会被棋盘缩放拉变形。

### 6.2 攻击范围：三种形态，同一套规则

不是三选一，按兵种自动选用：

| 形态 | 兵种 | 覆盖格 | 表现 |
|---|---|---|---|
| **射线** | 弓箭手 / 弩车 / 投石车 | 朝向那条射线上全部格子，到棋盘边缘 | `INFO.face` 填充 0.22 + 环 1.5px。其余 3 个可选朝向用 0.05 淡色幽灵铺出；棋子旁挂 `rotate` + `pips(1)` 表示转向成本 |
| **相邻环** | 步兵 / 骑兵 / 战车 | `neighbors()` 6 格 | `INFO.threat` 填充 0.17 + 环 1.5px |
| **扇形** | 无双（120°） | 朝向方向的相邻 3 格 | `INFO.threat` 填充 0.26 + 环 1.8px |

**三种形态共用的"轻重分级"**：格子里真有敌军时加深，并在格角挂矛尖

- `blade()` 空心 = 打得到
- `blade({solid:true})` 实心 = **这一下能杀**

实心与否由服务端判定（见 §7），玩家不用自己算血量。

### 6.3 敌方威胁区

敌方下回合能打到的格子，用 **`INFO.threat` 45° 斜纹** `<pattern>` 铺底。

> 我方能打的用**实色**，我方会被打的用**斜纹** —— 同一色相靠**填充方式**区分，
> 不额外占一个颜色。这是四色约束下扩展语义的标准手段。

### 6.4 大本营

- 牙旗记号 `banner()` 画在格心，`INFO.threat`
- **同心告警环圈数 = 最近敌军剩余步数**，圈越少越危险，最内圈实心＝已贴脸
- 距离是纯几何（`hexDist`），客户端可直接算，不涉及规则

---

## 7. 数据依赖：需要服务端配合的字段 ⚠️

这是本方案**唯一的跨端风险项**。

`client/src/game/validActions.ts` 的设计意图写得很清楚：高亮与校验必须共用服务端那一份判断，
**不允许客户端再写一份规则**。因此下列信息必须由服务端下发，不得在客户端推导。

### 已有，可直接用

| 字段 | 形状 | 支撑 |
|---|---|---|
| `moves` | `Record<unitId, [q, r, steps][]>` | §6.1 三段色带（`steps` 直接就是段号）✅ |
| `attacks` | `Record<unitId, targetUnitId[]>` | §6.2 空心矛尖 ✅ |
| `attackHexes` | `Record<unitId, [q, r][]>` | §6.2 射线型覆盖格 ✅ |

### 需新增

| 字段 | 形状 | 支撑 | 优先级 |
|---|---|---|---|
| `lethal` | `Record<unitId, targetUnitId[]>`（`attacks` 的子集） | §6.2 **实心矛尖** | P1 |
| `moveFlags` | `Record<unitId, Record<"q,r", { damageUp?: boolean; noAttack?: boolean }>>` | §6.1 悬停后果记号 | P1 |
| `fanHexes` | `Record<unitId, [q, r][]>` | §6.2 无双扇形。**先确认是否已并入 `attackHexes`**，若已包含则不需新增 | P1 |
| `threatHexes` | `[q, r][]`（为**非行动方**计算） | §6.3 敌方威胁区。现有 payload 只算 `forPlayer` 一方，这是最大的一块新增服务端工作 | P2 |
| `inFormation` | `string[]`（处于步兵方阵中的 unitId） | 队首盾记号 | P2 |

**关于 `moveFlags`**：理论上客户端可以写 `steps === 2 → damageUp`，但那就是在客户端重写了一条规则，
一旦服务端改数值（比如改成"移动 2 格伤害 +2"）两边立刻漂移。
这条规则的数值住在服务端，标记也应该从服务端来。**成本很低，建议一次做对。**

---

## 8. 必须删除的东西

### 8.1 反语义动画（本次重构的直接起因）

`client/src/animations.css` 中所有靠 `fill-opacity` 变暗表达状态的规则，全部删除：

| 规则 | 问题 |
|---|---|
| `.hex-movable` / `@keyframes hex-breathe-move` | `fill-opacity: .3 → .6`，深底透上来变脏橄榄绿，比普通格更暗 |
| `.hex-attackable` / `@keyframes hex-pulse-attack` | 同上 |
| `.fan-attack-hex` / `@keyframes fan-attack-pulse` | 同上 |
| `.hex-hover:hover { fill-opacity: .8 !important }` | **悬停让格子变暗**，和"可交互"的语义相反 |

替换为：**底色恒定不透明，只脉动环（ring）的 `opacity`**。

```css
@keyframes ring-pulse { 0%,100% { opacity:.55 } 50% { opacity:1 } }
.info-ring { animation: ring-pulse 2s ease-in-out infinite; }
```

### 8.2 死代码（已验证 0 引用）

`animations.css` 里定义了但**从未被任何组件使用**的 13 个类：

```
hex-attackable   fan-attack-hex   shake-on-hit     damage-number    heal-number
deploy-zone-active   deploy-zone-gold   turn-transition   dice-rolling
dice-selected   dice-clickable   panel-card   loading-spinner
```

其中 `damage-number` / `shake-on-hit` / `dice-rolling` / `turn-transition` 是**有价值但没接上**的反馈
（伤害飘字、受击抖动、骰子投掷、回合切换闪光）。建议：**接上而不是删掉**，零新美术成本的体验提升。
其余（`panel-card` / `loading-spinner` / `deploy-zone-*` / `dice-*`）确认无用后删除。

### 8.3 一个无效动画

```css
.unit-selected { animation: pulse-glow 1.5s infinite; }  /* 动画的是 box-shadow */
```

`box-shadow` **不作用于 SVG 图形元素**（只作用于 SVG 根元素）。
`.unit-selected` 挂在 `UnitPiece` 的 `<g>` 上，所以这个动画**完全没有效果**。
现在看到的脉动来自 `UnitPiece.tsx:485` 那两个带 `animate-pulse` 的 `<circle>`。
删掉 `pulse-glow`，选中反馈统一由 info-top 层的白框负责。

### 8.4 两个顺带修掉的 bug

| 问题 | 位置 |
|---|---|
| ~~**`taiping.svg` 缺失**~~ → 已补 | 原来 `client/public/generals/` 只有 rende / shenji / wushuang，玩家选「太平」时头像 404（靠 onError 隐藏，位置是空的）。新图沿用另外三张的结构，取黄巾的土黄 `#ca8a04`，避开朱红/靛蓝/翠绿 |
| **棋盘尺寸被锁死，宽屏下不变大** | 真正的来源是 `GameBoard.tsx:1436` 的 `max-w-7xl`（1280px）+ `GameBoard.tsx:1954` 的硬编码 `height: '700px'`。实测 1440 与 1920 两种视口下棋盘尺寸**完全相同**。详见布局方案 |
| **`client/src/App.css` 是死文件** | 全项目没有任何地方 `import './App.css'`，其中的 `#root { max-width: 1280px }` 从未生效（实测 `#root` 的 computed `max-width` 为 `none`）。应直接删除该文件，避免误导 |
| **「类型/生命/行动」是纯黑字写在近黑面板上** | `GameBoard.tsx:1937-1940` 三个 `<p>` 没有任何颜色类，继承浏览器默认 `rgb(0,0,0)`，实测对比度 **1.04:1**（AA 要求 4.5:1），等于不可见。同时 `{selectedUnit.type}` 直接把枚举值 `archer` / `general` 显示给玩家 |

---

## 9. 分期

| 期 | 内容 | 依赖 | 效果 |
|---|---|---|---|
| **P0** | §4 单 SVG 五层重构 + §2 令牌表 + §5 T2 棋子 + §8.1 删反语义动画 + §8.3/8.4 | **无服务端改动** | "偏移阴影"消失，棋盘棋子整体换新 |
| **P1** | §6.1 M2 色带 + §6.2 攻击三形态 + §3 记号库与图例 | `lethal` / `moveFlags` / 确认 `fanHexes` | 盘面零文字，规则开始自解释 |
| **P2** | §6.3 威胁区 + §6.4 本营告警环 + 方阵盾 + 接上 §8.2 四个反馈动画 | `threatHexes` / `inFormation` | 画面替说明书说话 |

P0 完整可独立上线，不需要等服务端。

---

## 9.1 P0 实现记录（已完成）

| 验收项 | 结果 |
|---|---|
| 棋盘 SVG 数量 | **1**（改前 2 个重叠，差 2px） |
| `<defs>` 子节点数 | **3**，与格子数/单位数无关（改前每格一份选中滤镜、每单位一份渐变） |
| 世界层节点数 | 274 = 91×3 + 1 条缝线，`React.memo` 只依赖 `[radius, size]` |
| 缝线边数 | R=1→30 / 2→72 / 3→132 / 5→**306**，与 `6N−(9R²+3R)` 精确相符，有回归测试 |
| 棋子汉字居中 | 水平/垂直偏移实测 **0.000px** |
| 「类型/生命/行动」对比度 | **16.4:1**（改前 1.04:1），且枚举值 `archer` 已换成「弓箭手」 |
| `fill-opacity` 动画 | 已全部删除 |
| 测试 | 87 passed（新增 13 条几何测试） |

**P0 范围内的偏差，均已记录原因：**

1. **移动力下弧的数据来源改了。** 规格里写的是"下弧 = 移动力"，但 `shared/rules/queries.ts`
   里没有「兵种移动力」常量 —— 那个数值散在 `getValidMoves` 的逻辑里。
   在客户端另写一张移动力表就是 §7 警告的那种漂移，所以改成从服务端已下发的
   `validActions.moves` 取 `max(steps)`，语义变成"此刻还能走几格"。
   零重复、零额外计算；代价是敌方单位和已行动单位不显示下弧。

2. **「已行动」同样由 `validActions` 推出**（`actionsThisTurn > 0` 且无合法移动、无合法攻击），
   不猜每个兵种的行动上限。

3. **步数提示仍是小圆点**，只是从深色改成信息色。M2 的三段色带 + 悬停记号属 P1，
   需要服务端的 `moveFlags`。

4. **大本营用了 2 个 `<text>`（帥 / 將）**，所以"盘面零文字"这条在 P0 还没完全达成；
   §3 的 `banner` 牙旗记号属 P1。

5. **§8.2 的死 CSS 类**已在 P1 处理：
   - 删掉确认无用的 `panel-card` / `loading-spinner` / `dice-selected` / `dice-clickable` /
     `deploy-zone-active` / `deploy-zone-gold` 及其仅被它们使用的 keyframes
   - **接上**了 `dice-rolling`（投骰子转一圈，依赖骰子点数的内容而非颗数，
     这样神机改点数 / 重掷也会转）与 `turn-transition`（回合切换闪光）
   - `turn-flash` 的 keyframes 原来动画的是 `background-color`，而 HUD 的背景是内联
     `linear-gradient`（近乎不透明的 background-image）会把它整个盖住 ——
     也就是说当年即使接上了也看不见。改成动画 `filter: brightness()`，
     它不和 background / box-shadow 抢，内联样式也压不住
   - **伤害飘字与受击抖动已接上**（见下）

6. **记号库 `theme/glyphs.tsx` 未建**（P1）。P0 的朝向尖是棋子自身的一部分，不走记号库。

## 9.2 P1 实现记录（不依赖服务端的部分已完成）

| 项 | 状态 |
|---|---|
| §3 记号库 `theme/glyphs.tsx` | ✅ 12 个记号，统一线宽 `u*0.16` / 统一圆端 |
| §3 图例 `components/UI/LegendPanel.tsx` | ✅ 颜色语义 4 条 + 记号 12 条；挂在右栏可折叠段（折叠 50px） |
| 大本营改牙旗记号 | ✅ **盘面零文字达成** —— 16 个单位对应 16 个 `<text>`，再无其它文字节点 |
| 攻击范围独立配色 | ✅ 移动走青、攻击走朱。原来两者共用同一套填充，攻击范围显示成"可移动"的青色 |
| 范围内敌军加深 + 矛尖 | ✅ 用已有的 `attacks` 推出，矛尖画在格子右上角不压棋子 |

### §6.1 M2 色带：已完成（含服务端字段）

服务端的 `validActions.moves` 从 `[q, r, steps]` 扩成 **`[q, r, steps, flags]`**，
`flags` 是位掩码，常量定义在 `shared/rules/queries.ts`，两端共用：

```ts
export const MOVE_FLAG_DAMAGE_UP = 1;   // 伤害 +1
export const MOVE_FLAG_NO_ATTACK = 2;   // 本回合不能攻击
```

**只有骑兵会带标记。** 这一点是读代码确认的，不是推测：`handleMove` 只对
`type === 'cavalry'` 记 `moveDistance`，`handleAttack` 的冲锋加成也只判 cavalry。
战车虽然规则书写「如骑兵般移动」，服务端并不给它记 `moveDistance`，
所以**不能一视同仁** —— 这是本节最容易写错的地方。

客户端据此上色（不按 steps 自己推）：

| 段 | 色 | 含义 |
|---|---|---|
| 普通 | 青 `INFO.move` | 普通移动 |
| `damageUp` | 琥珀 `INFO.face` | 伤害 +1（奖励，所以是最亮的一档） |
| `noAttack` | 冷白 `INFO.muted` | 本回合不可攻击（代价，所以是失色的一档） |

实测一个骑兵的 14 个可达格自动分成 2 / 5 / 7 三段。
悬停某格时该格填充由 0.16 提到 0.40 + 白框 + 放大显示后果记号（倒钩 / 划掉的矛尖），
常态盘面不出现任何记号。

一处措辞要诚实：`damageUp` 是**"有机会 +1"** —— 目标相邻己方步兵 ≥2 时「步兵护卫」
会抵消这个加成（`handleAttack` 里的分支）。图例已照此措辞。

### §6.2「可击杀」实心矛尖：已完成（含伤害预测重构）

`depthDefenseTriggered` 那 91 行里，**判定是纯的，副作用才是脏的**。
按这条缝把它拆开，抽出四个纯查询到 `shared/rules/queries.ts`：

| 函数 | 作用 |
|---|---|
| `findRearInfantrySupport(a, t, units)` | 纵深抗击的支援队列（要求**连续**，遇空格即停） |
| `isDepthDefended(a, t, units)` | 上面那个队列是否非空 |
| `adjacentFriendlyInfantryCount(t, units)` | ≥2 时「步兵护卫」抵消骑兵冲锋加成 |
| `predictDamage(a, t, units)` | 基础 1 + 冲锋加成 − 纵深抗击，三者合成 |
| `isLethal(a, t, units)` | `predictDamage >= target.hp` |

`handleAttack` 现在也走这几个函数 —— 击退仍然用 `findRearInfantrySupport` 返回的队列，
预测只用「队列非空」这个布尔值。**一份实现，两个用途**，不存在第二份伤害计算。

服务端把 `lethal`（`attacks` 的子集）加进 validActions，客户端据此把矛尖画成实心。
`validActionsFingerprint` 本来就含 `u.hp`，所以掉血会自动触发重算。

配 **21 个单元测试**（`server/src/__tests__/damagePrediction.test.ts`），
锁住几个最容易写错的点：加成只在**恰好** 2 格时触发、战车不算、
护卫必须是**己方步兵**且 ≥2、纵深抗击要求连续且仅「弓箭手打步兵」。

实机验证（hotseat 实打）：

| 验证点 | 结果 |
|---|---|
| 冷白段 = 本回合不可攻击 | 战报「骑兵移动3格，本回合无法攻击」 |
| 琥珀段 = 伤害 +1 | 战报「骑兵冲锋：伤害+1」→ 造成 2 点 |
| 攻击范围朱色 | 实测 `#E2564B`，不再是移动的青色 |
| **实心**矛尖 | 「步兵被击杀」，场上单位 8→7 |
| **空心**矛尖 | 造成 1 点，目标剩 1 血（棋子体力弧同步变 1 段） |

### 顺手修掉的一个操作障碍

攻击的落点判定在格子层，而棋子的圆盘正好盖住格心 —— 原来点敌方棋子
`handleUnitClick` 直接 `return`，玩家必须瞄准格子**边缘**那一圈才点得到
（实测要偏离格心约 0.38 个格高）。现在攻击/转化这类定向模式下，
点敌方棋子会转发给 `handleHexClick`，合法性判断仍在它内部。

### §6.3 敌方威胁斜纹 + 方阵盾：已完成

决定了「validActions 也要算非行动方」之后，两项一起落了。

**关键取舍：不新写射程推导。** `getThreatHexes` 只负责枚举候选格，
「能不能打到」的答案全部交给 `checkAttackLegality` —— 也就是服务端校验用的那一份。
自己再实现一遍「近战 1 格 / 弓手 3+基线 / 投石车朝向 5 格」就又多了一份会漂移的实现，
而威胁提示一旦算错是**比没有更糟**的（它会骗玩家说某格安全）。

代价是每个敌方单位要对全图 91 格逐格问一次 ≈ 1800 次调用，
只在 `validActionsFingerprint` 变化时重算，实测开销可忽略。

两个必须注意的点：

1. **预测要用"刷新过"的单位。** `checkAttackLegality` 头几行闸的是本回合状态
   （`hasAttacked` / `actionsThisTurn`），而威胁问的是「下回合他能打到哪」。
   不刷新的话刚攻击过的敌人会被算成零威胁。
2. **不含战车碾压。** 战车没有攻击动作，它靠移动把路上单位直接击杀，
   威胁范围等于可达移动路径 —— 那需要新推导一套规则。所以这张图是
   **偏保守的**：少报不多报，不会骗玩家说某格安全。

方阵盾没有发一个含糊的 `inFormation` 布尔值。「在方阵里」不是绝对属性 ——
纵深抗击只在**特定方向**被弓箭手打时触发。所以 `getDepthDefendedUnitIds`
回答的是一个具体问题：「场上是否真有某个敌方弓箭手，打它时会被纵深抗击免掉伤害」。

实现中查出一条之前没写进规格的规则细节：**纵深抗击只沿六边形的三条轴线生效**。
`getAxisLineFromTarget` 在 source/target 不同轴时直接返回空数组 —— 也就是说
并排的步兵（同一横排）不构成方阵，必须沿火线方向前后相叠。
这恰好说明这条规则为什么玩家发现不了，也是把它画出来最有价值的地方。

渲染：我方能打的用**实色**，我方会被打的用**朱色斜纹**（45°，与六边形的边都不平行，
不会被误读成格线）。同一色相靠填充方式区分，不额外占一个信息色。

实机验证：双方各 11 个单位时威胁斜纹铺出 42 格，位置与敌方弓手射程覆盖区一致。

顺手修掉一个**渲染时读 store 不订阅**的隐患：`enemyThreatHexes` / `depthDefended`
是在 render 期间读的，原来用的是不订阅的 `getServer*` 普通函数 ——
validActions 到达时若没有别的状态同时变化，组件不会重渲染，威胁区会晚一帧。
改成 `useValidActionsStore(state => ...)` 订阅。
（其余 `getServer*` 只在事件处理里调用，拿当次最新值就够，保持原样。）

**一处验证缺口**：方阵盾的实机渲染没观察到 —— 需要敌方弓手与目标**同轴**，
脚本化部署没凑出这种局面。规则本身有 7 个测试覆盖（含 payload 级的同轴/不同轴对照），
渲染走的是与威胁斜纹完全相同的 store→组件→`#info-mark` 路径，该路径已实机验证。

§6.2 无双扇形**不需要服务端字段** —— 扇形方向由玩家在客户端选，
`getFanShapedHexes` 已在 `shared/utils/hexUtils.ts`，客户端本来就导入了。

**一处验证缺口**：攻击范围的朱色分支在实机里**没跑到** ——
双方初始阵列相距 5 排以上，没有单位能攻击，而把棋子走到接触需要十几个回合。
该分支已通过类型检查，逻辑是一行三元（`highlightKind === 'attack' ? INFO.threat : INFO.move`），
但下次有接触局面时应当复验一次。

## 9.3 伤害反馈（原 §8.2 的遗留项）

`@keyframes damage-float` 与 `shake` 在 animations.css 里写好却从没被引用 ——
掉血在界面上**毫无表现**，玩家只能从战报文字里读到。现在接上了。

**走客户端 diff，不走服务端事件。** 服务端 `hp -=` 有 8 处（普通攻击、弩车贯穿、
投石车溅射、无双扇形、太平承载…），逐个加广播容易漏，而且那条路径是结算逻辑最密的地方。
改成差分 gameStore 的单位快照：

- 自动覆盖**所有**伤害来源，包括以后新加的
- 零服务端改动
- 单位被击杀（从 map 消失）也能捕获，用它**上一帧**的位置放一次 `✕`

差分逻辑抽成纯函数 `diffDamage(prev, next, keyGen)`，10 个单测锁住两个坑：
首帧只建基线（否则进对局时全场都被当成刚掉血）、死亡位置只能取上一帧。

### 两个 SVG 专属的坑

1. **CSS `transform` 会覆盖 SVG 的 transform 属性。** 棋子根节点挂着
   `transform="translate(x,y)"`，直接给它加抖动动画会让棋子跳回棋盘原点。
   所以抖动和飘字都作用在**内层** `<g>`，外层只管定位。
2. 需要 `transform-box: fill-box` + `transform-origin: center`，
   否则 SVG 元素的变换原点是用户坐标系原点（棋盘中心），棋子会绕棋盘中心甩出去。

实机验证：普通一刀 → 飘 `−1` + 抖动，`animationName` 实测为 `sy-damage-float`；
致命一刀 → 实心矛尖预测在先，打下去飘 `✕`，场上单位 18 → 17；
两者都在超时后被清理掉，没有节点泄漏。

## 10. 验收标准（可自动化检查的部分）

> ⚠️ **跑类型检查要用 `npx tsc -b`，不要用 `npx tsc --noEmit -p tsconfig.json`。**
> `client/tsconfig.json` 是 `{ "files": [], "references": [...] }` 的空壳，
> 带 `-p` 的那条命令**什么都不检查就退出 0**。本次实现中途就是靠 `tsc -b`
> 才发现一个 `Cannot find module` 的错误路径（import 深度多了一级）。
> `npm run build`（vite）也不做类型检查，不能当作类型安全网。

| # | 检查项 | 方法 |
|---|---|---|
| 1 | 棋盘 SVG 内**没有任何 `<text>` 节点**（图例面板是 DOM，不在此列） | `boardSvg.querySelectorAll('text')` 中只允许棋子汉字 |
| 2 | 全项目**不存在 `fill-opacity` 动画** | `grep -rn "fill-opacity" client/src/*.css` 应只剩静态值 |
| 3 | DOM 里**只有一个棋盘 SVG** | `GameBoard` 内 `svg` 计数 === 1 |
| 4 | `<defs>` 子节点数量**与格子数 / 单位数无关**（常数） | 部署 0 个单位与 24 个单位时 defs 数量相同 |
| 5 | 信息层用色**只来自 `INFO` 四色 + muted** | 对 `#info-area` / `#info-mark` 内所有 `fill`/`stroke` 取值做白名单断言 |
| 6 | 棋子汉字**居中偏差 < 1px** | `text.getBBox()` 中心与令牌圆心比较 |
| 7 | **世界层在 selection 变化时不重渲染** | React Profiler：点击单位后 `WorldLayer` 的 render 次数为 0 |
| 8 | 缝线**每条边只画一次** | `seamPath(R)` 输出的 `M` 段数 === `6N − (9R² + 3R)`，其中 `N = 3R²+3R+1`。已验证：R=1→30、R=2→72、R=3→132、**R=5→306** |

---

## 附：布局

布局已单独成文：**[layout-spec.md](layout-spec.md)**。
两份文档有一处交集 —— 棋盘的长宽比 `772.82 : 680 = 1.1365`
既决定 §4.2 世界层的绘制范围，也决定布局里棋盘容器的尺寸公式，改动时需同步。
