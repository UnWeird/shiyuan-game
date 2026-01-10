"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIT_HP = exports.BUDGET = exports.INITIAL_DICE = exports.MAP_RADIUS = void 0;
exports.MAP_RADIUS = 6; // 地图半径
exports.INITIAL_DICE = 4; // 初始骰子数
exports.BUDGET = {
    infantry: 0.1, // 步兵：一角
    cavalry: 0.2, // 骑兵：两角
    archer: 0.5, // 弓箭手：五角
    general: 1.0, // 将军：一元
    total: 4.0, // 总预算：4元
};
exports.UNIT_HP = {
    infantry: 1,
    cavalry: 1,
    archer: 1,
    general: 2,
    ballista: 2,
    chariot: 2,
    neutral_marker: 1,
};
