"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@colyseus/core");
const ws_transport_1 = require("@colyseus/ws-transport");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ShiyuanRoom_1 = require("./rooms/ShiyuanRoom");
const app = (0, express_1.default)();
const port = 2567;
// 允许跨域（开发环境）
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 创建 Colyseus 服务器
const gameServer = new core_1.Server({
    transport: new ws_transport_1.WebSocketTransport({
        server: app.listen(port)
    })
});
// 注册游戏房间
gameServer.define('shiyuan_room', ShiyuanRoom_1.ShiyuanRoom);
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
