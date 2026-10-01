# 设计原型

这些是定方案时用来做可视对比的页面，**不是产品代码**，不参与构建。
原先放在 `client/public/` 下，但 Vite 会把 `public/` 整个拷进 `dist/`，所以挪到了这里。

| 文件 | 内容 |
|---|---|
| `dev-hex-lab.html` | 5 种棋盘格渲染方案 + 棋子质感对比（最早一轮，浅底时期） |
| `dev-piece-lab.html` | 棋子信息通道（P1–P4）+ 状态词汇 + 6 个规则暗示层 |
| `dev-board-lab.html` | 记号图例 + 4 个棋盘体系（夜战沙盘 / 水墨夜卷 / 青铜器 / 战术图层） |
| `dev-bronze-lab.html` | **定稿方案**：青铜器 3 种平面棋子材质 + 骑兵可达区 3 版 + 攻击范围 3 形态 |
| `dev-layout-lab.html` | 布局对比，真实 CSS，指标从 DOM 实测；可切视口 / 操作方式 / 棋盘朝向 |
| `dev-lab-core.js` | 公共绘制核心（几何与 `shared/utils/hexUtils.ts` 对齐） |

## 怎么打开

`dev-board-lab.html` 和 `dev-bronze-lab.html` 用 ES module 引入 `dev-lab-core.js`，
浏览器不允许从 `file://` 加载模块，所以要起一个静态服务：

```bash
cd docs/prototypes && python3 -m http.server 8777
```

然后访问 <http://localhost:8777/dev-bronze-lab.html>。
其余三个是自包含的，直接双击打开也行。

## 和实现的关系

定稿方案见 [../board-art-spec.md](../board-art-spec.md) 与 [../layout-spec.md](../layout-spec.md)。
原型里的 `dev-lab-core.js` 不是实现的依赖 —— 产品代码里对应的是
`client/src/utils/boardGeometry.ts`、`client/src/theme/boardTheme.ts`
和 `client/src/components/Map/WorldLayer.tsx`。两边都改时记得对齐几何常量。
