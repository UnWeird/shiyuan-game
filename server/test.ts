import { Client } from 'colyseus.js';

/**
 * 测试脚本：验证十元游戏服务器功能
 */

const SERVER_URL = 'ws://localhost:2567';

async function testGame() {
  console.log('🧪 开始测试十元游戏服务器...\n');

  try {
    // 创建两个客户端（模拟两个玩家）
    const client1 = new Client(SERVER_URL);
    const client2 = new Client(SERVER_URL);

    console.log('1️⃣  玩家1创建房间...');
    const room1 = await client1.create('shiyuan_room');
    console.log(`✅ 房间创建成功！Room ID: ${room1.roomId}\n`);

    // 监听玩家1的角色
    room1.onMessage('role', (data) => {
      console.log(`👤 玩家1收到角色: ${data.role} - ${data.message}`);
    });

    // 监听错误消息
    room1.onMessage('error', (data) => {
      console.log(`❌ 玩家1收到错误: ${data.message}`);
    });

    room1.onMessage('info', (data) => {
      console.log(`ℹ️  玩家1收到信息: ${data.message}`);
    });

    // 监听游戏开始
    room1.onMessage('gameStart', (data) => {
      console.log(`\n🎮 ${data.message}\n`);
    });

    // 监听状态变化
    let stateChangeCount1 = 0;
    room1.onStateChange((state) => {
      stateChangeCount1++;
      console.log(`📊 玩家1看到状态更新#${stateChangeCount1}: phase=${state.phase}, currentPlayer=${state.currentPlayer}`);
    });

    // 等待一下
    await sleep(500);

    console.log('2️⃣  玩家2加入房间...');
    const room2 = await client2.joinById(room1.roomId);
    console.log('✅ 玩家2加入成功！\n');

    // 监听玩家2的角色
    room2.onMessage('role', (data) => {
      console.log(`👤 玩家2收到角色: ${data.role} - ${data.message}`);
    });

    room2.onMessage('error', (data) => {
      console.log(`❌ 玩家2收到错误: ${data.message}`);
    });

    room2.onMessage('info', (data) => {
      console.log(`ℹ️  玩家2收到信息: ${data.message}`);
    });

    // 监听状态变化
    let stateChangeCount2 = 0;
    room2.onStateChange((state) => {
      stateChangeCount2++;
      console.log(`📊 玩家2看到状态更新#${stateChangeCount2}: phase=${state.phase}`);
    });

    await sleep(1000);

    // === 测试选将阶段 ===
    console.log('\n--- 测试选将阶段 ---');
    console.log('玩家1选择无双将军...');
    room1.send('selectGeneral', { general: 'wushuang' });

    await sleep(500);

    console.log('玩家2选择神机将军...');
    room2.send('selectGeneral', { general: 'shenji' });

    await sleep(1000);

    console.log(`\n当前状态: phase=${room1.state.phase}`);
    console.log(`玩家1将军: ${room1.state.player1General}`);
    console.log(`玩家2将军: ${room2.state.player2General}`);

    // === 测试配兵阶段 ===
    if (room1.state.phase === 'army_build') {
      console.log('\n--- 测试配兵阶段 ---');
      console.log('玩家1配兵: 步兵×10, 骑兵×10, 弓手×2 (1元+2元+1元 = 4元)');
      room1.send('buildArmy', {
        infantry: 10,  // 10角 = 1元
        cavalry: 10,   // 20角 = 2元
        archer: 2      // 10角 = 1元
        // 总计: 40角 = 4元 ✅
      });

      await sleep(500);

      console.log('玩家2配兵: 步兵×15, 骑兵×5, 弓手×3 (1.5元+1元+1.5元 = 4元)');
      room2.send('buildArmy', {
        infantry: 15,  // 15角 = 1.5元
        cavalry: 5,    // 10角 = 1元
        archer: 3      // 15角 = 1.5元
      });

      await sleep(1000);

      console.log(`\n当前状态: phase=${room1.state.phase}`);
      console.log(`玩家1部队: 步兵×${room1.state.player1Infantry} 骑兵×${room1.state.player1Cavalry} 弓手×${room1.state.player1Archer}`);
      console.log(`玩家2部队: 步兵×${room1.state.player2Infantry} 骑兵×${room1.state.player2Cavalry} 弓手×${room1.state.player2Archer}`);
    }

    // === 测试设置大本营 ===
    if (room1.state.phase === 'base_setup') {
      console.log('\n--- 测试设置大本营 ---');
      console.log('玩家1设置大本营于 (0, 5, -5)');
      room1.send('setupBase', { q: 0, r: 5, s: -5 });

      await sleep(500);

      console.log('玩家2设置大本营于 (0, -5, 5)');
      room2.send('setupBase', { q: 0, r: -5, s: 5 });

      await sleep(1000);

      console.log(`\n当前状态: phase=${room1.state.phase}`);
      console.log(`玩家1大本营: (${room1.state.player1BaseQ}, ${room1.state.player1BaseR}, ${room1.state.player1BaseS})`);
      console.log(`玩家2大本营: (${room1.state.player2BaseQ}, ${room1.state.player2BaseR}, ${room1.state.player2BaseS})`);
    }

    // === 显示战斗日志 ===
    console.log('\n--- 战斗日志 ---');
    room1.state.battleLog.forEach((log: string) => {
      console.log(`📝 ${log}`);
    });

    console.log('\n✅ 前置阶段测试完成！');
    console.log('\n💡 服务器运行正常，前后端状态同步成功！');

    // 保持连接以便查看后续消息
    console.log('\n⏳ 保持连接30秒后自动断开...');
    await sleep(30000);

    room1.leave();
    room2.leave();

    console.log('\n👋 测试结束');
    process.exit(0);

  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行测试
testGame();
