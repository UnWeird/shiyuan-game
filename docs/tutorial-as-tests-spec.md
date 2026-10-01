# 规则单测 ⇄ 新手教程：共享场景方案

## 结论

**可行，而且这个仓库的架构已经把最贵的部分做完了。**

定位：**产品是新手教程，测试是副产物。** 一份场景脚本（scenario）配两个渲染器 ——
游戏里让玩家亲手做一遍、逐条打勾；CI 里自动重放同一份脚本、断言同一组条件。
CI 变红的语义不是「规则回归」，而是**「教程在骗玩家」**。

反过来不成立：**不要为了凑测试覆盖率往场景里塞演示不出来的规则。**
那类规则（穷举、不可达的边界）留在 L1 谓词单测里。

两者的验收标准天然不同，强行让一边服务另一边会两头做坏：

| | 规则单测 | 新手教程 |
|---|---|---|
| 覆盖目标 | 边界、穷举、负例 | 一条规则的完整结算链 |
| 运行方式 | 毫秒级、无头、确定性 | 交互、等玩家、容错 |
| 好内容的样子 | 「91 格 × 3 种机关的车身都不出界」 | 「你看，最后一个被贯穿的敌人被定住了」 |

所以分三层，各司其职：

- **L1 谓词单测**（已有 43 个，**保留不动**）—— 覆盖边界与穷举，机器可读、人类不可读
- **L2 场景脚本**（本方案新增，双渲染）—— 覆盖「玩家真会遇到的情境」的完整结算链，既是教程章节又是 CI 验收
- **L3 手动探索**（已有 DevPanel 快照）—— 临时复现

---

## 一、现状盘点

### 已经具备的（这是方案成本不高的原因）

1. **规则只有一份，且测试直接驱动生产代码。** `shared/rules/queries.ts` 是纯查询层，
   `ShiyuanRoom` 的 `handleXxx` 是结算层；`server/src/__tests__/rules.test.ts` 已经在用
   `new ShiyuanRoom()`（不起 transport）直接调私有方法，不存在「测试跑的是另一份代码」的问题。

2. **整条对局流程可无头驱动 —— 已实测。** 我写了一个临时探针：`new ShiyuanRoom()` +
   一个 `{ sessionId, send }` 的假 client，依次调
   `handleSelectGeneral ×2 → handleBuildArmy ×2 → handleSetupBase ×2 → handleRollDice → handleDeployUnit ×2 → handleMoveUnit`
   全部跑通（阶段正确推进到 `deploy`，部署出 2 个单位，移动后 `actionsThisTurn=1`）。
   `this.broadcast` 在没有 transport、没有 client 的情况下**不会抛错**，不需要打桩。
   房间里也没有 `setSimulationInterval` / `this.clock` / `this.clients` 的依赖。探针已删除。

3. **客户端不需要自己算规则。** 服务端把 `validActions`（moves / attacks / attackHexes）推下来，
   教程要高亮「这一步该点哪里」直接读 `getServerMoves(unitId)` 即可，不会和服务端判定漂移。

4. **已有快照格式可当场景素材来源。** `captureState` / `restoreState`（`__version: 1`）+ DevPanel
   的存读与 `.json` 导出，意味着**可以用「打一局打到那个局面，存下来」的方式作者化场景**，
   不必手写坐标。

5. **断言需要的字段全部是已同步字段。** `hp`、`q/r/s`、`cannotMoveNextTurn`、`movementRestricted`、
   `chargeLevel`、`statusTag`、`player1ActionPoints`、`player1DestinyValue`、`battleLog`
   都在 Schema 里，死亡单位会从 `state.units` 删除。
   → **客户端能用和服务端完全相同的断言求值器验收，不需要为教程新增校验消息。**

### 四个硬约束（必须在方案里绕开）

1. **随机数没有接缝。** `Math.floor(Math.random() * 6) + 1` 在 `ShiyuanRoom.ts` 里有 **23 处**
   （回合掷骰、击杀奖励骰、无双二/三段、神机改骰、太平天命/豆饭）。
   没有固定骰子，**无双「≤2 才能再攻击」、太平天命结算这类章节根本没法脚本化** ——
   教程不能靠运气才演示得出分支。

2. **单位 id 不确定。** `unit_${Date.now()}_${Math.random()...}`，**10 处**。
   场景脚本无法用 id 指代单位，断言输出也没法读。

3. **Schema 字段正好用满 64 个。** 我逐个数过 `GameStateSchema`：恰好 64。
   → **教程进度绝不能加进 Schema**，必须放客户端 store + 房间的非同步私有字段
   （`private isHotseat` 已是先例）。

4. **调试日志会把输出淹掉。** `ShiyuanRoom.ts` 有 **53 处** `console.log`，
   `shared/rules/queries.ts` 还有 **6 处**（`[服务端移动验证]` 每算一次高亮就刷一屏）。
   场景 runner 跑 20 个章节的输出会完全不可读。

### 当前覆盖的真实缺口

43 个测试几乎全在**谓词**（能不能走、能不能打、消耗几点）。
**结算链基本没有覆盖**：伤害、击退连锁、掉马、击杀奖励骰、永久失骰，以及
**四个阵营的技能一条都没测**（无双扇形/鏖战、神机三种机关、仁德招降/中立、太平全部）。

git log 也印证了 bug 集中在哪：`修复多个游戏逻辑 bug：骑兵/投石车/弩车/弓箭手/散架步兵`、
`优化投石车和战车机制`、`修复步兵纵深抗击机制`、`修复骑兵体力系统`，
加上 `docs/bug-fix-1~3`（两条是投石车/弩车）。**机关是最该先铺的。**

---

## 二、方案：一份场景，两个渲染器

### 2.1 场景格式

放 `shared/scenarios/`，用 **TypeScript 模块**而不是 JSON。理由：
能被类型系统校验到真实的消息 payload 和字段名；讲解文案和断言写在一起，
**规则一改，教程文案和验收断言被迫在同一个地方同时更新** —— 这是整个方案最主要的价值。

```ts
// shared/scenarios/types.ts
export interface Scenario {
  id: string;                    // 'shenji-ballista-pierce'
  faction: 'base' | 'wushuang' | 'shenji' | 'rende' | 'taiping';
  title: string;                 // '弩车：贯穿、击退与定身'
  /** 对应规则书条文。规则改动时据此反查要改哪些场景 */
  rule: { section: string; quote: string };   // section = rulesData 的 id
  setup: Setup;
  steps: Step[];
}

export interface Step {
  /**
   * 谁来做这一步。
   *   'player' —— 教程里等玩家亲手操作（高亮 hint，做对才推进）
   *   'auto'   —— 教程里自动播放 + 旁白，玩家只看
   *
   * 'auto' 不是偷懒，是必需的：阵营细则里大量「会发生的情况」不是玩家操作的结果。
   * 要让玩家理解步兵纵深抗击，他必须是**挨打**的一方 —— 敌方弓箭手得自己动；
   * 击退连锁（knockbackInfantryChain）、战车血耗尽散架成两个步兵、战车触底把剩余
   * 血量加到行动值、回合结束的力士掉血与天命结算、黄巾贼的「作乱」反击，
   * 都没有玩家输入。CI 里两者都是 dispatch，没有区别。
   */
  actor: 'player' | 'auto';
  /** 讲解 / 旁白。每一步都必须有 —— 没有讲解的步骤不该进场景（回 L1） */
  teach: string;
  /** 要执行的动作：直接复用服务端消息名与 payload */
  act: Act;                      // { type: 'ballistaPierceAttack', ballistaId: 'bal' }
  /** 执行后必须成立的断言，同时就是教程的验收清单 */
  expect: Assertion[];
  /** 教程提示：高亮哪些格子 / 哪个按钮；不影响测试 */
  hint?: Hint;
}
```

`setup` 声明式，**label 直接就是单位 id**（靠 Phase 0 的 id 接缝实现），
于是断言里 `'bal'` 既是人类可读的名字又是真 id，不需要映射表：

```ts
setup: {
  phase: 'action', currentPlayer: 'player1',
  p1: { general: 'shenji', base: [0, 5], ap: 10 },
  p2: { general: 'wushuang', base: [0, -5] },
  dice: [2, 5, 1],                       // 固定骰序，按需取用
  units: [
    { id: 'bal',  type: 'ballista', owner: 'p1', at: [0, 2], hp: 4 },
    { id: 'foe1', type: 'infantry', owner: 'p2', at: [1, 0] },
    { id: 'foe2', type: 'infantry', owner: 'p2', at: [2, -2] },
    { id: 'foe3', type: 'infantry', owner: 'p2', at: [3, -4] },
  ],
}
```

配套 `snapshotToSetup(snapshot)`：把 DevPanel 导出的 `.json` 转成上面这段，
保留「打到那个局面再存下来」的作者化流程，但入库的是可读的声明式代码而不是 64 字段的 blob
（blob 在 diff 里不可读，而且 `SNAPSHOT_VERSION` 一升就全废）。

### 2.2 断言即验收清单（方案的核心）

断言是**可序列化的数据 + 一句中文**，不是 `expect()` 调用。
这样同一个对象既能在 vitest 里变成失败信息，又能在教程里变成一行打勾项。

```ts
expect: [
  { hp:   { foe1: 1 },                why: '第一个贯穿目标掉 1 血' },
  { pos:  { foe1: [1, 1] },           why: '第一个贯穿目标被击退 1 格' },
  { dead: ['foe2'],                   why: '路径中间的目标被贯穿击杀' },
  { flag: { foe3: 'cannotMoveNextTurn' }, why: '最后一个贯穿目标被定身一回合' },
  { ap:   { p1: 9 },                  why: '贯穿消耗 1 点行动值' },
  { log:  /贯穿/,                     why: '战报记录了这次贯穿' },
]
```

还有一类断言值得单列：**「预期被拒绝」**。教新手最有效的一步往往是「你试试，会发现不行」，
而它同时就是一条负例测试 —— 这类覆盖本来以为只能留给 L1：

```ts
{ actor: 'player', teach: '先用无双点一次普通攻击试试',
  act: { type: 'attackUnit', attackerId: 'g', targetId: 'foe' },
  expect: [{ rejected: /扇形/, why: '无双将领不能普通攻击，只能用破三英' }],
  hint: { press: 'attack' } }
```

`rejected` 匹配的是服务端 `client.send("error", ...)` 的文案 —— 那是玩家真正会看到的拒绝理由，
现有测试已经在断言这些 `reason`，所以不算新增耦合（相对地，**不要**断言其他 `client.send` 消息，见 §六.3）。

求值器放 `shared/scenarios/assert.ts`，签名照 `UnitLike` 的既有套路 ——
只吃一个最小 view，两端各做一次浅映射：

```ts
export interface ScenarioView {
  units: Record<string, { type: string; owner: string; q: number; r: number; hp: number;
                          chargeLevel: number; statusTag: string; [flag: string]: unknown }>;
  ap: { p1: number; p2: number };
  destiny: { p1: number; p2: number };
  log: readonly string[];
  /** 最近一次动作被拒绝的理由（服务端 error 文案）；未被拒绝则为 undefined */
  rejected?: string;
}
export function evaluate(assertions: Assertion[], view: ScenarioView): AssertResult[];
//   AssertResult = { ok: boolean; why: string; detail?: string }
```

服务端测试传 `GameStateSchema`，客户端教程传 gameStore 的同步状态 —— 同一份判断。

### 2.3 两个渲染器

**(a) CI runner** —— `server/src/__tests__/scenarios.test.ts`

```ts
describe.each(allScenarios)('$faction · $title', (sc) => {
  it.each(sc.steps.map((s, i) => [i, s]))('第 %i 步', (i, step) => {
    const room = buildScenarioRoom(sc);        // 假 client + 固定骰 + 声明式 setup
    replayUpTo(room, sc, i);                   // 重放前 i 步
    dispatch(room, step.act);
    for (const r of evaluate(step.expect, toView(room.state))) {
      expect(r.ok, `${sc.title} 第${i}步：${r.why}（${r.detail}）`).toBe(true);
    }
  });
});
```

失败信息读起来是 `神机·弩车：贯穿、击退与定身 第3步：最后一个贯穿目标被定身一回合（cannotMoveNextTurn=false）`
—— 不需要看代码就知道哪条规则坏了。

**(b) 教程 runner** —— `client/src/tutorial/`

- `createRoom({ hotseat: true, tutorial: 'shenji-ballista-pierce' })`，复用现成的同机对弈通路
- 服务端在 `onCreate` 按 id **从白名单查场景、自己构建局面**
- `TutorialOverlay`：上方讲解卡（`teach`）、棋盘高亮（`hint` + `validActions`）、
  右侧验收清单（`expect` 的 `why` 逐条，完成打勾）
- `actor: 'player'` → 等玩家操作；`actor: 'auto'` → 延时自动 dispatch 并把 `teach` 当旁白播
- 每次状态 patch 后用同一个 `evaluate` 判定；全绿 → 下一步；玩家点错 → 不推进，提示但不惩罚
- 进度只存 `client/src/tutorial/tutorialStore.ts`（zustand，和 uiStore 同级）—— **不进 Schema**

**两个入口，同一套场景**（见 §四）：

- **新手教程** —— 线性必修，按顺序解锁，首次进游戏时引导进入
- **阵营演示** —— 可查阅，从菜单或 `RulesModal` 里每条规则旁的「▶ 演示」直接点进单章

后者靠 `rule.section` 匹配 `rulesData` 的条目来挂钩，于是 规则书 ↔ 教程 ↔ 测试 三者串成一条线：
改规则书的人会看到哪些章节要改，改规则的人会看到 CI 哪条亮红。

### 2.4 目录结构

```
shared/scenarios/
  types.ts            场景 / 步骤 / 断言的类型
  assert.ts           evaluate()：唯一的断言求值器
  build.ts            Setup → GameStateSchema；snapshotToSetup()
  index.ts            allScenarios 白名单（服务端据此拒绝非法 id）
  base/*.ts           基础规则章节
  wushuang/*.ts  shenji/*.ts  rende/*.ts  taiping/*.ts
server/src/__tests__/scenarios.test.ts     CI runner
client/src/tutorial/
  TutorialOverlay.tsx  tutorialStore.ts  runner.ts
```

---

## 三、Phase 0：三个前置改造（没有这步，后面做不了）

都在现有 43 个测试的保护下，机械替换，各自独立可提交。

1. **骰子接缝**（23 处）
   ```ts
   /** 掷一颗骰子。全房间唯一的随机来源，场景 runner 可替换为固定序列。 */
   protected rollD6(): number { return Math.floor(Math.random() * 6) + 1; }
   ```
2. **单位 id 接缝**（10 处）
   ```ts
   private idSeq = 0;
   protected nextUnitId(): string { return `u${++this.idSeq}`; }
   ```
   顺带让快照 diff 和战报都变可读。场景中途生成的单位（战车散架、豆饭召唤、仁德转化）
   断言用位置匹配 `{ spawned: { type: 'infantry', at: [...] } }`，比 id 更稳。
3. **日志降噪**（ShiyuanRoom 53 处 + queries.ts 6 处）
   统一走 `const DEBUG = process.env.SHIYUAN_DEBUG === '1'` 的 `dlog()`。
   `queries.ts` 里那 6 处尤其该关 —— 它每算一次高亮就刷屏。

---

## 四、章节清单

两层，共 20 章，**全部都要能演示**。选章与排序的判据是「新手会在哪卡住」，
而不是「哪条规则没测过」—— 后者是 L1 的事。

### 第一层：新手教程（线性必修，5 章）

打完能上手一局。只覆盖所有阵营共通的部分，不碰任何将领技能。

| # | 章节 | 覆盖 |
|---|---|---|
| 1 | 骰子与行动点 | 基础 1 颗 + 每 2 元 1 颗；部署阶段先手不限、后手 `1 + ⌊先手部署元数⌋`；行动点怎么花 |
| 2 | 部署与移动 | 起始区限制；每单位每回合 2 次行动、每种 1 次；骑兵最多 3 格 |
| 3 | 攻击 · 射程 · 转向 | 近战相邻判定；弓箭手射程 = 3 + 距己方基线（越靠前越远）；友军挡路额外 +1 点；转向耗行动；非将领打将领耗 2 点 |
| 4 | 兵种相克 | 骑兵移动 2 格伤害 +1 / 3 格不能攻击 / 掉血掉马变 1 血步兵；步兵抗骑（与 ≥3 己方步兵相邻免 +1）；纵深抗击（免伤 + 队尾击退 1 格 + 下回合不能朝攻击者方向移动）|
| 5 | 胜利与失败 | 触碰大本营判胜；将军被杀永久 -1 骰；骰子数归零判负 |

第 4 章几乎全是 `actor: 'auto'` 的挨打演示 —— 相克效果只有当玩家是防守方时才看得见。

### 第二层：阵营演示（可查阅，15 章）

每章独立、可单点、无前置。入口：菜单 + `RulesModal` 每条规则旁的「▶ 演示」。

**无双 3 章**
1. 破三英 —— 120° 扇形、消耗 3 点；**开场先让玩家点一次普通攻击吃拒绝**（`rejected`）
2. 连段掷骰 —— 二段 2 点掷 ≤2 可续、三段 1 点掷 =1 可续；固定骰把两个分支都演一遍
3. 鏖战 —— 按已损失体力给行动值 + 解除「每种行动 1 次」（已有谓词测试，直接升级成章节）

**神机 4 章**（历史 bug 最密集，建议第一个做）
1. 弩车 —— 固定朝向、贯穿带友伤、首个击退 / 末个定身、近战受伤 +1、4 血整体、贯穿 ≥3 损毁给重投骰
2. 战车 —— 碾压 2 格带友伤、每碾死 -1 血、血耗尽散架成 2 个步兵、撞机关互毁、触底把剩余血量加到行动值
3. 投石车 —— 朝向直线射击、蓄力 0 / 1 / 2 层的三种溅射形状、每回合行动上限
4. 百炼与借天机 —— 机关组合部署与库存扣减；改一个骰子点数（不论敌我）

**仁德 3 章**
1. 招降 —— 2 点转化接触单位；上两回合无击杀时可对敌将使用 → 直接判胜
2. 以德服人 —— 击杀时改判为 1 血中立；中立单位会挡住弓箭与弩箭
3. 费用翻倍 —— 转化中立 1→2→4→8；对方击杀中立则重置为 1

**太平 5 章**
1. 黄巾力士 —— 2 血；回合结束未行动 -1 血；1 血不能攻击但不死
2. 符水粥 —— 回合开始按距太平由近到远转化残血步兵，每个 1 点，**必须全转完才能做别的**
3. 夺天命 —— 初始 5；回合结束 `天命 += 黄天 - 苍天`；力士超载 → 太平 -1 血（必须固定骰）
4. 豆饭 —— 3 点、掷骰、相邻空位召唤等量力士、每回合一次
5. 起义 —— 太平死 → 力士变贼；贼不能主动攻击、会「作乱」反击、被杀返还击杀者 1 点、击杀不给太平骰子

### 明确不做的两条

规则书里这两条真实对局中构造不出来，**不进场景、也不硬塞 CI**（要测就写 L1 谓词测试）：

- 中立单位把地图彻底划分成两边 → 判平局
- 双太平：共享天命值 / 指挥权 / 6 点血池；力士与贼触碰大本营不算胜利

---

## 五、分期

| 阶段 | 内容 | 粒度 |
|---|---|---|
| 0 | 三个接缝（骰子 / id / 日志） | 半天，机械 |
| 1 | DSL + `assert.ts` + `build.ts` + CI runner + 新手教程 5 章的脚本（先只跑 CI） | 1–2 天 |
| 2 | `TutorialOverlay` + `tutorialStart` + **新手教程可玩** | 1–2 天 |
| 3 | 神机 4 章 | 1 天 |
| 4 | 无双 3 章 + 仁德 3 章 | 1 天 |
| 5 | 太平 5 章 | 1 天 |
| 6 | 阵营演示入口 + `RulesModal` 的「▶ 演示」 | 半天 |

两个有意义的交付点：**Phase 1 结束**结算链第一次进 CI（还没有任何 UI）；
**Phase 2 结束**新手教程可玩，这是第一个能给人看的东西。Phase 3~5 每个阵营独立上线、互不阻塞。

---

## 六、风险与边界

1. **不要把场景当成唯一的测试。** 场景是按「新手会卡在哪」选的，不是按覆盖率选的，
   所以**穷举型覆盖必然留在外面** —— 「91 格 × 3 种机关的车身都不出界」演示不出来，
   但它抓到过真 bug（480 个落点里 60 个车身伸出棋盘）。
   L1 的 43 个谓词测试保留并继续新增，**不要改写它们**；
   发现某条规则值得测但演不出来 → 写 L1，不要为它在场景格式里开后门。

2. **不要让场景把实现里的 bug 固化成规则。** 每个场景强制填 `rule: { section, quote }` 指向规则书原文；
   评审以**规则书**为准，不以当前代码行为为准。写场景时发现实现与规则书不符 —— 那正是这件事的收益。

3. **断言只看 state + battleLog，不要断言 `client.send` 的具体消息。**
   结算逻辑和 `client.send` 深度耦合（`queries.ts` 的注释已明说这是另一次重构），
   断言消息会让任何 UI 调整碎掉一片测试。例外：`error` 的拒绝理由是玩家可见文案，
   值得断言（现有测试已经在断言 `reason`）。

4. **`tutorialStart` 绝不能变成第二个 `__devLoadState`。**
   `__devLoadState` 接受客户端传来的任意状态，必须继续锁在 `SHIYUAN_DEV_TOOLS=1` 后面。
   教程入口只接受一个**场景 id**，局面由服务端按白名单自建；并且只在
   `isHotseat && isTutorial` 的房间里允许，防止有人重置一局正在进行的联网对战。
   这样它可以安全地在正式环境开启。

5. **教程的容错是额外工作量，别低估。** 玩家会点错、会乱点、会在半截刷新页面。
   第一版的策略定死：不推进、不惩罚、不回滚，只提示；
   「载入不会重置组件内临时 UI 状态」这个已知限制（见 DevPanel 提示）对教程同样适用，
   章节切换走重建房间，不走局面覆盖。

6. **不要再抄一份规则文案。** `teach` 写「怎么看懂这一步」，
   规则条文本身由 `rule.section` 引用 `rulesData`，避免第三份会漂移的规则描述
   （现在已经有 `GAMEPLAY.md` 和 `rulesData.ts` 两份）。

7. **教程当产品之后，最大的工作量不是代码而是文案。** 20 章 × 平均 5 步 ≈ 100 条
   `teach` 加上百余条 `why`，都要写得让没读过规则书的人看懂。
   §五的工时估的是代码；文案建议按章节增量写，别攒到最后，
   也别指望能从 `rulesData.ts` 直接复制 —— 规则书是给查的，教程是给第一次看的。
