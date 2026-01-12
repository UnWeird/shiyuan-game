import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import cors from 'cors';
import { ShiyuanRoom } from './rooms/ShiyuanRoom';

const app = express();
const port = Number(process.env.PORT) || 2567;
const host = process.env.HOST || '0.0.0.0';  // 允许外网访问

// 允许跨域（开发环境）
app.use(cors());
app.use(express.json());

// 创建 Colyseus 服务器
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: app.listen(port, host)
  })
});

// 注册游戏房间
gameServer.define('shiyuan_room', ShiyuanRoom);

console.log(`
🎮 十元游戏服务器启动成功！
📡 WebSocket: ws://localhost:${port}
🌐 HTTP: http://localhost:${port}
`);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  gameServer.gracefullyShutdown(false);
});
