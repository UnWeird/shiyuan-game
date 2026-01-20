# 问题1：投石车蓄力失败导致异常断开连接

## 问题描述
用户点击投石车的"蓄力"按钮后，蓄力操作失败，客户端收到异常断开连接的消息（code: 4002），随后自动触发重连机制，显示"重连成功"。

## 错误日志
```
离开房间, code: 4002
⚠️ 异常断开连接，尝试重连...
🔄 尝试重连... {roomId: 'aY32CZl3O', reconnectionToken: 'aY32CZl3O:jqLWTli4e'}
✅ 重连成功！
[CLIENT DEBUG] 同步状态 - currentPlayer从服务器: player1, 我的角色: player1
```

## 根本原因分析

### 1. 服务端未实现消息处理器
在 `server/src/rooms/ShiyuanRoom.ts` 的 `registerMessageHandlers()` 方法中，**没有注册 `catapultCharge` 消息的处理器**。

**当前代码位置：** [ShiyuanRoom.ts:174-290](server/src/rooms/ShiyuanRoom.ts#L174-L290)

已注册的消息处理器包括：
- `selectGeneral`
- `buildArmy`
- `setupBase`
- `deployUnit`
- `finishDeploy`
- `rollDice`
- `rerollDice`
- `moveUnit`
- `attackUnit`
- `rotateUnit`
- `endTurn`
- `wushuangFanAttackStart` ~ `wushuangCancel`
- `wushuangAbility`
- `shenjiDeployMachine`
- `shenjiModifyDice`
- `ballistaPierceAttack`
- `ballistaMeleeAttack`
- `rendeConvertAdjacent` ~ `rendeSpareAsNeutral`
- `surrender`

**缺失的处理器：**
- ❌ `catapultCharge` - 投石车蓄力

### 2. 客户端发送了未处理的消息
在客户端 [ColyseusService.ts:541-544](client/src/services/ColyseusService.ts#L541-L544)：
```typescript
catapultCharge(unitId: string) {
  if (!this.room) return;
  this.room.send('catapultCharge', { catapultId: unitId });
}
```

客户端在 [GameBoard.tsx:2111](client/src/components/Game/GameBoard.tsx#L2111) 调用此方法：
```typescript
colyseusService.catapultCharge(selectedUnit.id);
```

### 3. Colyseus 的错误处理机制
当服务端收到未注册的消息类型时，Colyseus 可能：
1. 抛出未处理的异常
2. 触发房间错误（code 4002 通常表示服务端错误）
3. 导致客户端被服务端主动断开连接

## 修复方案

### 步骤1：在服务端注册消息处理器
**文件位置：** `server/src/rooms/ShiyuanRoom.ts`

在 `registerMessageHandlers()` 方法中添加：
```typescript
// === 投石车蓄力 ===
this.onMessage("catapultCharge", (client, data) => {
  this.handleCatapultCharge(client, data);
});
```

**插入位置建议：** 在 `shenjiModifyDice` 之后，`ballistaPierceAttack` 之前（约第260行）。

### 步骤2：实现 `handleCatapultCharge` 方法
在 `ShiyuanRoom` 类中添加处理方法（建议位置：约第2800行，弩车攻击相关方法之后）：

```typescript
/**
 * 处理投石车蓄力
 */
private handleCatapultCharge(client: Client, data: { catapultId: string }) {
  const role = this.getPlayerRole(client);
  if (!role) return;

  // 验证是否是当前玩家
  if (role !== this.state.currentPlayer) {
    client.send("error", { message: "不是你的回合" });
    return;
  }

  // 验证阶段（只能在行动阶段蓄力）
  if (this.state.phase !== "action") {
    client.send("error", { message: "当前阶段不能蓄力" });
    return;
  }

  // 查找投石车
  const catapult = this.state.units.get(data.catapultId);
  if (!catapult) {
    client.send("error", { message: "投石车不存在" });
    return;
  }

  // 验证单位类型
  if (catapult.type !== 'catapult') {
    client.send("error", { message: "该单位不是投石车" });
    return;
  }

  // 验证所有权
  if (catapult.owner !== role) {
    client.send("error", { message: "这不是你的投石车" });
    return;
  }

  // 验证是否已行动
  if (catapult.hasActedThisTurn) {
    client.send("error", { message: "投石车本回合已行动" });
    return;
  }

  // 验证蓄力层数（最多2层）
  const currentCharge = catapult.chargeLevel || 0;
  if (currentCharge >= 2) {
    client.send("error", { message: "投石车已达到最大蓄力层数" });
    return;
  }

  // 检查行动点是否足够（蓄力消耗1点行动点）
  const currentActionPoints = role === "player1"
    ? this.state.player1ActionPoints
    : this.state.player2ActionPoints;

  if (currentActionPoints < 1) {
    client.send("error", { message: "行动点不足" });
    return;
  }

  // 执行蓄力
  catapult.chargeLevel = currentCharge + 1;
  catapult.hasActedThisTurn = true;
  catapult.actionsThisTurn = (catapult.actionsThisTurn || 0) + 1;

  // 消耗行动点
  if (role === "player1") {
    this.state.player1ActionPoints -= 1;
  } else {
    this.state.player2ActionPoints -= 1;
  }

  this.addBattleLog(`${role}的投石车蓄力成功，当前层数：${catapult.chargeLevel}/2`);
  client.send("info", { message: `投石车蓄力成功 (${catapult.chargeLevel}/2)` });

  console.log(`[DEBUG] 投石车蓄力 - catapultId: ${data.catapultId}, chargeLevel: ${catapult.chargeLevel}`);
}
```

### 步骤3：验证蓄力功能
在 `handleAttackUnit` 方法中，已经实现了投石车的溅射逻辑（约第1648-1700行）：
```typescript
// === 投石车溅射伤害 ===
if (attacker.type === 'catapult') {
  const chargeLevel = attacker.chargeLevel || 0;

  if (chargeLevel > 0) {
    // 获取溅射目标格子
    const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };
    const targetPos = { q: target.q, r: target.r, s: target.s };
    const splashHexes = getCatapultSplashTargets(attackerPos, targetPos, chargeLevel, 5);

    if (splashHexes.length > 0) {
      this.addBattleLog(`投石车溅射效果触发！蓄力层数：${chargeLevel}`);

      // 对每个溅射格子上的单位造成1点伤害
      for (const splashHex of splashHexes) {
        // ... 溅射逻辑
      }
    }

    // 攻击后清除蓄力层数
    attacker.chargeLevel = 0;
  }
}
```

**注意：** 确保攻击后正确清除蓄力层数。

## 测试计划

### 测试用例1：正常蓄力
1. 在线模式下部署投石车
2. 点击投石车的"蓄力"按钮
3. **预期结果：**
   - 蓄力成功，显示蓄力层数 (1/2)
   - 行动点减少1
   - 不会触发断开连接

### 测试用例2：最大蓄力层数
1. 投石车已蓄力到2层
2. 尝试再次蓄力
3. **预期结果：**
   - 提示"投石车已达到最大蓄力层数"
   - 不消耗行动点

### 测试用例3：行动点不足
1. 当前行动点为0
2. 尝试蓄力
3. **预期结果：**
   - 提示"行动点不足"
   - 蓄力失败

### 测试用例4：蓄力后攻击
1. 投石车蓄力1层
2. 攻击敌方单位
3. **预期结果：**
   - 触发溅射效果
   - 蓄力层数清零

## 相关文件
- `server/src/rooms/ShiyuanRoom.ts` - 服务端房间逻辑（需修改）
- `client/src/services/ColyseusService.ts:541-544` - 客户端蓄力方法调用
- `client/src/components/Game/GameBoard.tsx:2103-2131` - 客户端蓄力按钮UI
- `shared/utils/hexUtils.ts` - 溅射范围计算（`getCatapultSplashTargets`）

## 优先级
**高 - Critical Bug**

此 bug 导致游戏功能完全不可用且触发异常重连，影响用户体验。

## 预估工作量
- 实现时间：15-20分钟
- 测试时间：10-15分钟
- **总计：** 约30分钟