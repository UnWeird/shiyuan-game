#!/bin/bash

# 十元棋游戏 - 一键部署脚本
# 适用于 Ubuntu 服务器

set -e  # 遇到错误立即退出

echo "======================================"
echo "🎮 开始部署十元棋游戏"
echo "======================================"

# 1. 拉取最新代码
echo ""
echo "📥 Step 1: 拉取最新代码..."
git pull

# 2. 构建服务器
echo ""
echo "🔨 Step 2: 构建服务器..."
cd server
npm install
npm run build

# 3. 重启服务器进程
echo ""
echo "🔄 Step 3: 重启服务器进程..."
pm2 delete shiyuan-server 2>/dev/null || true
pm2 start lib/server/src/index.js --name shiyuan-server
pm2 save

# 4. 构建客户端
echo ""
echo "🔨 Step 4: 构建客户端..."
cd ../client
npm install
npm run build

# 5. 重启客户端进程
echo ""
echo "🔄 Step 5: 重启客户端进程..."
pm2 delete shiyuan-client 2>/dev/null || true
pm2 start npx --name shiyuan-client -- serve -s dist -p 8080
pm2 save

# 6. 显示进程状态
echo ""
echo "✅ 部署完成！"
echo ""
echo "📊 当前进程状态："
pm2 list

echo ""
echo "======================================"
echo "🎉 部署成功！"
echo "======================================"
echo "🌐 客户端: http://your-server-ip:8080"
echo "📡 服务器: ws://your-server-ip:2567"
echo ""
echo "💡 查看日志："
echo "   pm2 logs shiyuan-server  # 服务器日志"
echo "   pm2 logs shiyuan-client  # 客户端日志"
echo ""
