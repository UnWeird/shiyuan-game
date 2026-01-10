import React from 'react';
import { GeneralType, Player } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { colyseusService } from '../../services/ColyseusService';

interface GeneralCardProps {
  general: GeneralType;
  name: string;
  ability: string;
  passive: string;
  onSelect: () => void;
  isSelected: boolean;
  disabled?: boolean;
}

const GeneralCard: React.FC<GeneralCardProps> = ({
  name,
  ability,
  passive,
  onSelect,
  isSelected,
  disabled = false,
}) => {
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      className={`
        p-6 rounded-lg border-2 transition-all duration-200
        ${disabled
          ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
          : isSelected
          ? 'border-green-500 bg-green-50 shadow-lg scale-105 cursor-pointer'
          : 'border-gray-300 bg-white hover:border-blue-400 hover:shadow-md cursor-pointer'
        }
      `}
    >
      <h3 className="text-2xl font-bold mb-2">{name}</h3>
      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-sm text-amber-600">一次性技能:</h4>
          <p className="text-sm text-gray-700">{ability}</p>
        </div>
        <div>
          <h4 className="font-semibold text-sm text-blue-600">被动技能:</h4>
          <p className="text-sm text-gray-700">{passive}</p>
        </div>
      </div>
    </div>
  );
};

export const GeneralSelect: React.FC = () => {
  const {
    currentPlayer,
    player1General,
    player2General,
    selectGeneral,
    nextPhase,
    isOnlineMode,
    myPlayerRole,
  } = useGameStore();

  const handleSelectGeneral = (general: GeneralType) => {
    if (isOnlineMode) {
      // 在线模式：发送到服务器
      colyseusService.selectGeneral(general);
    } else {
      // 单机模式：本地更新
      selectGeneral(currentPlayer, general);
    }
  };

  const handleConfirm = () => {
    // 在线模式不需要手动确认，服务器会自动切换阶段
    if (isOnlineMode) {
      return;
    }

    // 单机模式逻辑
    if (currentPlayer === Player.PLAYER1 && player1General) {
      // 切换到玩家2选将
      useGameStore.setState({ currentPlayer: Player.PLAYER2 });
    } else if (currentPlayer === Player.PLAYER2 && player2General) {
      // 两个玩家都选完了，重置为玩家1，进入配兵阶段
      useGameStore.setState({ currentPlayer: Player.PLAYER1 });
      nextPhase();
    }
  };

  // 在线模式：选将阶段两个玩家可以同时选择，不需要等待
  // 只要自己还没选完，就可以继续选
  const myGeneral = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player1General : player2General)
    : null;
  const opponentGeneral = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player2General : player1General)
    : null;

  // 单机模式用
  const canConfirm = currentPlayer === Player.PLAYER1 ? !!player1General : !!player2General;

  // 在线模式下：只有当自己已经选择后才显示等待
  const waitingForOther = isOnlineMode && !!myGeneral && !opponentGeneral;

  console.log('DEBUG GeneralSelect:', {
    isOnlineMode,
    myPlayerRole,
    myGeneral,
    opponentGeneral,
    player1General,
    player2General,
    waitingForOther
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 flex items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">选择将领</h1>
          {isOnlineMode ? (
            <div>
              <p className="text-xl text-gray-600">
                你是 {myPlayerRole === 'player1' ? '玩家1' : '玩家2'}
              </p>
              {myGeneral ? (
                waitingForOther ? (
                  <p className="text-lg text-amber-600 mt-2">
                    ⏳ 等待对手选择...（你已选择{myGeneral === 'wushuang' ? '无双' : myGeneral === 'shenji' ? '神机' : '仁德'}）
                  </p>
                ) : (
                  <p className="text-lg text-green-600 mt-2">
                    ✅ 双方都已选择完毕，即将进入配兵阶段...
                  </p>
                )
              ) : (
                <p className="text-lg text-green-600 mt-2">
                  ✨ 请选择你的将领
                </p>
              )}
            </div>
          ) : (
            <p className="text-xl text-gray-600">
              {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 请选择你的将领
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <GeneralCard
            general={GeneralType.WUSHUANG}
            name="无双 (体力上限4)"
            ability="立刻获得当前已损失体力值数量的行动值，并解除本回合行动次数限制"
            passive="无法普通攻击，仅可使用扇形攻击（消耗3点行动值，攻击相邻3格120°扇形区域）。可连续掷骰触发额外攻击"
            onSelect={() => handleSelectGeneral(GeneralType.WUSHUANG)}
            isSelected={myGeneral === GeneralType.WUSHUANG}
            disabled={isOnlineMode && !!myGeneral}
          />
          <GeneralCard
            general={GeneralType.SHENJI}
            name="神机 (体力上限3)"
            ability="直接修改一个骰子点数（不论敌我）"
            passive="可以将士兵单位组合成机关（弩车、战车）后直接部署"
            onSelect={() => handleSelectGeneral(GeneralType.SHENJI)}
            isSelected={myGeneral === GeneralType.SHENJI}
            disabled={isOnlineMode && !!myGeneral}
          />
          <GeneralCard
            general={GeneralType.RENDE}
            name="仁德 (体力上限4)"
            ability="消耗2点将接触单位转化为己方，若上回合无击杀可对敌将使用直接获胜"
            passive="击杀时可选择避免死亡，使其成为1血中立单位。可花费行动点转化中立单位"
            onSelect={() => handleSelectGeneral(GeneralType.RENDE)}
            isSelected={myGeneral === GeneralType.RENDE}
            disabled={isOnlineMode && !!myGeneral}
          />
        </div>

        {/* 单机模式才显示确认按钮 */}
        {!isOnlineMode && (
          <div className="flex justify-center">
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={`
                px-8 py-3 rounded-lg font-bold text-lg transition-all duration-200
                ${canConfirm
                  ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              {currentPlayer === Player.PLAYER1 ? '确认选择（玩家2选将）' : '确认选择（配置部队）'}
            </button>
          </div>
        )}

        {/* 在线模式显示状态信息 */}
        {isOnlineMode && (
          <div className="flex justify-center">
            <div className="bg-blue-100 border border-blue-300 rounded-lg px-6 py-3">
              <p className="text-blue-800 text-center">
                {player1General && player2General
                  ? '✅ 双方都已选择完毕，即将进入配兵阶段...'
                  : player1General
                  ? '玩家1已选择'
                  : player2General
                  ? '玩家2已选择'
                  : '等待双方选择...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
