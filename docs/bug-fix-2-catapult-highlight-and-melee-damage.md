# 问题2：投石车被选中时核心棋子未高亮，近身攻击伤害+1效果未触发

## 问题描述
1. **高亮问题：** 投石车成为被攻击/技能选中的对象时，其核心棋子（三角形所在位置）没有被高亮显示
2. **伤害问题：** 投石车被近身攻击时，应有的伤害+1效果没有触发

## 根本原因分析

### 问题1：核心棋子未高亮

#### 投石车的结构特点
投石车是**机关单位**，占据多个六边形格子（V形布局）：

**文件位置：** [hexUtils.ts:377-391](shared/utils/hexUtils.ts#L377-L391)

```typescript
else if (machineType === 'catapult') {
  // 投石车占用3格：V形，中心 + 左前、右前
  // 玩家1朝上（敌人在北），前方是北；玩家2朝下（敌人在南），前方是南
  if (isPlayerOne === true) {
    occupied.push(hexNeighbor(position, Direction.NORTH_WEST)); // 左前
    occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右前
  } else if (isPlayerOne === false) {
    occupied.push(hexNeighbor(position, Direction.SOUTH_WEST)); // 左前
    occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右前
  }
}
```

- **中心位置（`position`）：** 核心棋子所在，也是三角形标记的位置
- **左前/右前：** 两个扩展格子

#### 当前高亮逻辑的问题
在 [GameBoard.tsx:639-700](client/src/components/Game/GameBoard.tsx#L639-L700) 的攻击范围显示逻辑中：

**弩车的处理（有近战范围）：**
```typescript
if (selectedUnit.type === UnitType.BALLISTA) {
  const isPlayerOne = selectedUnit.owner === Player.PLAYER1;
  const shootingPath = getBallistaVerticalPath(selectedUnit.position, isPlayerOne, 5);

  // 近战范围：相邻的所有格子
  const meleeRange = hexNeighbors(selectedUnit.position);

  // 组合射击路径和近战范围
  const combinedRange = [...shootingPath, ...meleeRange];
  setHighlightedHexes(combinedRange);
  setActionMode('attack');
}
```

**投石车的处理（缺失近战范围）：**
```typescript
else if (selectedUnit.type === UnitType.CATAPULT) {
  // 只显示射击路径，没有近战范围高亮
  const shootingPath = getShootingPath(selectedUnit.position, selectedUnit.direction, 5);
  setHighlightedHexes(shootingPath);
  setActionMode('attack');
}
```

**导致的问题：**
- 当敌方单位显示攻击范围时，投石车的扩展格子（左前、右前）可能被高亮
- 但投石车的**核心格子（`position`）**没有被包含在近战攻击范围内
- 攻击者计算近战范围时，只检查自己相邻的格子，没有检查投石车占据的所有格子是否与攻击者相邻

### 问题2：近身攻击伤害+1未触发

#### 游戏规则
机关单位（弩车、战车、投石车）被近身攻击时，应该受到额外1点伤害。

#### 服务端逻辑检查
在 [ShiyuanRoom.ts:1500-1640](server/src/rooms/ShiyuanRoom.ts#L1500-L1640) 的 `handleAttackUnit` 方法中：

```typescript
// 判断攻击类型
let isMelee = false;

if (attacker.type === 'archer') {
  // 弓箭手始终是远程攻击
  isMelee = false;
} else {
  // 其他单位：检查是否相邻
  const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };
  const targetPos = { q: target.q, r: target.r, s: target.s };
  isMelee = hexDistance(attackerPos, targetPos) === 1;
}

// 计算伤害
let damage = 1;

// 近战攻击机关单位：伤害+1
if (isMelee && (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult')) {
  damage += 1;
  this.addBattleLog(`近战攻击机关单位：伤害+1`);
}
```

**问题分析：**
- `isMelee` 判定基于 `hexDistance(attackerPos, targetPos) === 1`
- 对于机关单位，`targetPos` 是其**中心位置**
- 如果攻击者与投石车的**扩展格子**相邻，但与**中心格子**不相邻（距离>1），则 `isMelee` 判定为 `false`
- **导致：** 即使攻击者在投石车旁边，也不会触发近战伤害加成

#### 弩车为什么可能正常？
弩车的处理可能有特殊逻辑，或者因为弩车的倒V形布局，使得中心位置更容易与攻击者相邻。

## 修复方案

### 修复1：客户端高亮显示

#### 步骤1：修改攻击范围显示逻辑
**文件位置：** `client/src/components/Game/GameBoard.tsx`

在 `handleShowAttacks` 方法中（约第639-700行），修改投石车的处理：

```typescript
else if (selectedUnit.type === UnitType.CATAPULT) {
  // 投石车：显示射击路径 + 近战范围
  const shootingPath = getShootingPath(selectedUnit.position, selectedUnit.direction, 5);

  // 计算近战范围：投石车所有占据格子的相邻格子
  const catapultOccupiedHexes = getMachineOccupiedHexes(
    selectedUnit.position,
    'catapult',
    selectedUnit.owner === Player.PLAYER1
  );
  const allNeighbors: HexCoord[] = [];

  // 获取所有占用格子的相邻格子（去重）
  catapultOccupiedHexes.forEach(occupiedHex => {
    const neighbors = hexNeighbors(occupiedHex);
    neighbors.forEach(neighbor => {
      // 去重：检查是否已经在列表中，且不是投石车自己占用的格子
      const isCatapultTile = catapultOccupiedHexes.some(h => hexEquals(h, neighbor));
      const alreadyAdded = allNeighbors.some(h => hexEquals(h, neighbor));
      if (!isCatapultTile && !alreadyAdded) {
        allNeighbors.push(neighbor);
      }
    });
  });

  // 组合射击路径和近战范围
  const combinedRange = [...shootingPath, ...allNeighbors];
  setHighlightedHexes(combinedRange);
  setActionMode('attack');
}
```

#### 步骤2：修改攻击目标选择逻辑
在 `onHexClick` 方法中（约第518-600行），确保投石车的所有占据格子都能被正确识别为攻击目标。

当前弩车的处理（约第520-565行）：
```typescript
if (selectedUnit.type === UnitType.BALLISTA) {
  // 检查点击位置是否与弩车的任意占用格子相邻（近战范围）
  const ballistaOccupiedHexes = getMachineOccupiedHexes(selectedUnit.position, 'ballista');
  const isAdjacentToClick = ballistaOccupiedHexes.some(ballistaHex =>
    hexDistance(ballistaHex, hex) === 1
  );

  if (isAdjacentToClick) {
    // 近战攻击：查找相邻位置的敌方单位
    const target = Object.values(units).find(u => {
      // ... 查找逻辑
    });
    // ...
  } else {
    // 贯穿攻击
    // ...
  }
}
```

**投石车应采用相同逻辑：**
```typescript
else if (selectedUnit.type === UnitType.CATAPULT) {
  // 投石车攻击处理
  const catapultOccupiedHexes = getMachineOccupiedHexes(
    selectedUnit.position,
    'catapult',
    selectedUnit.owner === Player.PLAYER1
  );

  // 检查点击位置是否与投石车的任意占用格子相邻（近战范围）
  const isAdjacentToClick = catapultOccupiedHexes.some(catapultHex =>
    hexDistance(catapultHex, hex) === 1
  );

  if (isAdjacentToClick) {
    // 近战攻击（如果有敌方单位）
    const target = Object.values(units).find(u => {
      if (u.owner === selectedUnit.owner || u.id === selectedUnit.id) return false;

      // 检查是否是机关单位
      if (isMachineUnit(u.type)) {
        const machineType = getMachineTypeStr(u.type)!;
        const isPlayerOne = u.owner === Player.PLAYER1;
        const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
        return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
      }
      // 普通单位只检查中心位置
      return hexEquals(u.position, hex);
    });

    if (target) {
      // 执行近战攻击
      if (isOnlineMode) {
        colyseusService.attackUnit(selectedUnit.id, target.id);
        addLog(`投石车近战攻击${target.type}`, 'attack');
      } else {
        if (attackUnit(selectedUnit.id, target.id)) {
          addLog(`投石车近战攻击${target.type}`, 'attack');
        }
      }
      setActionMode(null);
      setHighlightedHexes([]);
      selectUnit(null);
      return;
    }
  }

  // 如果不是近战范围，检查是否在射击路径上（远程攻击）
  const target = Object.values(units).find(u => {
    if (u.owner === selectedUnit.owner || u.id === selectedUnit.id) return false;

    if (isMachineUnit(u.type)) {
      const machineType = getMachineTypeStr(u.type)!;
      const isPlayerOne = u.owner === Player.PLAYER1;
      const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
      return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
    }
    return hexEquals(u.position, hex);
  });

  if (target) {
    // 执行远程攻击（带溅射）
    if (isOnlineMode) {
      colyseusService.attackUnit(selectedUnit.id, target.id);
      addLog(`投石车远程攻击${target.type}`, 'attack');
    } else {
      if (attackUnit(selectedUnit.id, target.id)) {
        addLog(`投石车远程攻击${target.type}`, 'attack');
      }
    }
    setActionMode(null);
    setHighlightedHexes([]);
    selectUnit(null);
  }
}
```

### 修复2：服务端近战伤害判定

#### 修改 `handleAttackUnit` 方法
**文件位置：** `server/src/rooms/ShiyuanRoom.ts`（约第1500-1540行）

将近战判定逻辑从简单的距离检查改为考虑机关单位的占据范围：

```typescript
// 判断攻击类型
let isMelee = false;

if (attacker.type === 'archer') {
  // 弓箭手始终是远程攻击
  isMelee = false;
} else {
  // 其他单位：检查攻击者是否与目标的任意占据格子相邻
  const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };

  // 获取目标占据的所有格子
  let targetOccupiedHexes: HexCoord[] = [{ q: target.q, r: target.r, s: target.s }];

  if (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult') {
    const machineType = target.type === 'ballista' ? 'ballista'
                      : target.type === 'catapult' ? 'catapult'
                      : 'chariot';
    const isTargetPlayerOne = target.owner === 'player1';
    targetOccupiedHexes = getMachineOccupiedHexes(
      { q: target.q, r: target.r, s: target.s },
      machineType,
      isTargetPlayerOne
    );
  }

  // 检查攻击者是否与目标的任意占据格子相邻
  isMelee = targetOccupiedHexes.some(targetHex =>
    hexDistance(attackerPos, targetHex) === 1
  );
}

// 计算伤害
let damage = 1;

// 近战攻击机关单位：伤害+1
if (isMelee && (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult')) {
  damage += 1;
  this.addBattleLog(`近战攻击机关单位：伤害+1`);
}
```

#### 同样修复攻击者是机关单位的情况
如果攻击者也是机关单位（如战车碾压），应该检查攻击者的任意占据格子是否与目标相邻：

```typescript
// 判断攻击类型
let isMelee = false;

if (attacker.type === 'archer') {
  // 弓箭手始终是远程攻击
  isMelee = false;
} else {
  // 获取攻击者占据的所有格子
  let attackerOccupiedHexes: HexCoord[] = [{ q: attacker.q, r: attacker.r, s: attacker.s }];

  if (attacker.type === 'ballista' || attacker.type === 'chariot' || attacker.type === 'catapult') {
    const machineType = attacker.type === 'ballista' ? 'ballista'
                      : attacker.type === 'catapult' ? 'catapult'
                      : 'chariot';
    const isAttackerPlayerOne = attacker.owner === 'player1';
    attackerOccupiedHexes = getMachineOccupiedHexes(
      { q: attacker.q, r: attacker.r, s: attacker.s },
      machineType,
      isAttackerPlayerOne
    );
  }

  // 获取目标占据的所有格子
  let targetOccupiedHexes: HexCoord[] = [{ q: target.q, r: target.r, s: target.s }];

  if (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult') {
    const machineType = target.type === 'ballista' ? 'ballista'
                      : target.type === 'catapult' ? 'catapult'
                      : 'chariot';
    const isTargetPlayerOne = target.owner === 'player1';
    targetOccupiedHexes = getMachineOccupiedHexes(
      { q: target.q, r: target.r, s: target.s },
      machineType,
      isTargetPlayerOne
    );
  }

  // 检查攻击者的任意占据格子是否与目标的任意占据格子相邻
  isMelee = attackerOccupiedHexes.some(attackerHex =>
    targetOccupiedHexes.some(targetHex =>
      hexDistance(attackerHex, targetHex) === 1
    )
  );
}

// 计算伤害
let damage = 1;

// 近战攻击机关单位：伤害+1
if (isMelee && (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult')) {
  damage += 1;
  this.addBattleLog(`近战攻击机关单位：伤害+1`);
}
```

## 测试计划

### 测试用例1：投石车被高亮显示
1. 玩家1部署步兵，玩家2部署投石车（V形布局）
2. 玩家1选中步兵，点击"攻击"按钮
3. **预期结果：**
   - 投石车的**核心格子**（中心位置）被高亮显示为橙色
   - 投石车的两个扩展格子也被高亮（如果在攻击范围内）

### 测试用例2：近战攻击投石车
1. 步兵移动到投石车的扩展格子旁边（与中心格子不相邻）
2. 步兵攻击投石车
3. **预期结果：**
   - 攻击成功
   - 战斗日志显示"近战攻击机关单位：伤害+1"
   - 投石车受到2点伤害

### 测试用例3：远程攻击投石车
1. 弓箭手在远处攻击投石车
2. **预期结果：**
   - 攻击成功
   - 投石车受到1点伤害（无近战加成）

### 测试用例4：战车碾压投石车
1. 战车移动碾压投石车的扩展格子
2. **预期结果：**
   - 触发近战伤害+1
   - 投石车受到2点伤害

## 相关文件
- `client/src/components/Game/GameBoard.tsx:639-700` - 攻击范围显示逻辑
- `client/src/components/Game/GameBoard.tsx:518-600` - 攻击目标选择逻辑
- `server/src/rooms/ShiyuanRoom.ts:1500-1640` - 服务端攻击处理逻辑
- `shared/utils/hexUtils.ts:377-391` - 投石车占据格子计算
- `shared/utils/hexUtils.ts:351-410` - `getMachineOccupiedHexes` 函数

## 优先级
**中 - Gameplay Issue**

影响游戏平衡性和用户体验，但不会导致崩溃或功能完全不可用。

## 预估工作量
- 客户端修改：20-30分钟
- 服务端修改：15-20分钟
- 测试时间：20-25分钟
- **总计：** 约60-75分钟