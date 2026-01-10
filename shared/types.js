"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GamePhase = exports.ActionType = exports.GeneralType = exports.Direction = exports.UnitType = exports.Player = void 0;
// 玩家
var Player;
(function (Player) {
    Player["PLAYER1"] = "player1";
    Player["PLAYER2"] = "player2";
    Player["NEUTRAL"] = "neutral";
})(Player || (exports.Player = Player = {}));
// 单位类型
var UnitType;
(function (UnitType) {
    UnitType["INFANTRY"] = "infantry";
    UnitType["CAVALRY"] = "cavalry";
    UnitType["ARCHER"] = "archer";
    UnitType["GENERAL"] = "general";
    UnitType["BALLISTA"] = "ballista";
    UnitType["CHARIOT"] = "chariot";
    UnitType["NEUTRAL_MARKER"] = "neutral_marker";
})(UnitType || (exports.UnitType = UnitType = {}));
// 方向 (六边形有6个方向，对应6条边)
// 对于 flat-top 布局的六边形
var Direction;
(function (Direction) {
    Direction[Direction["EAST"] = 0] = "EAST";
    Direction[Direction["NORTH_EAST"] = 1] = "NORTH_EAST";
    Direction[Direction["NORTH_WEST"] = 2] = "NORTH_WEST";
    Direction[Direction["WEST"] = 3] = "WEST";
    Direction[Direction["SOUTH_WEST"] = 4] = "SOUTH_WEST";
    Direction[Direction["SOUTH_EAST"] = 5] = "SOUTH_EAST";
    Direction[Direction["NORTH"] = 6] = "NORTH";
    Direction[Direction["SOUTH"] = 7] = "SOUTH";
})(Direction || (exports.Direction = Direction = {}));
// 将领类型
var GeneralType;
(function (GeneralType) {
    GeneralType["WUSHUANG"] = "wushuang";
    GeneralType["SHENJI"] = "shenji";
    GeneralType["RENDE"] = "rende";
})(GeneralType || (exports.GeneralType = GeneralType = {}));
// 行动类型
var ActionType;
(function (ActionType) {
    ActionType["DEPLOY"] = "deploy";
    ActionType["MOVE"] = "move";
    ActionType["ATTACK"] = "attack";
    ActionType["ROTATE"] = "rotate";
    ActionType["ABILITY"] = "ability";
})(ActionType || (exports.ActionType = ActionType = {}));
// 游戏阶段
var GamePhase;
(function (GamePhase) {
    GamePhase["SETUP"] = "setup";
    GamePhase["GENERAL_SELECT"] = "general_select";
    GamePhase["ARMY_BUILD"] = "army_build";
    GamePhase["BASE_SETUP"] = "base_setup";
    GamePhase["DEPLOY"] = "deploy";
    GamePhase["ACTION"] = "action";
    GamePhase["END"] = "end";
})(GamePhase || (exports.GamePhase = GamePhase = {}));
