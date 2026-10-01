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
      className="p-4 md:p-5 rounded transition-all duration-300 relative"
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        border: isSelected
          ? '1px solid rgba(201,162,39,0.9)'
          : '1px solid rgba(201,162,39,0.3)',
        background: isSelected
          ? 'linear-gradient(135deg, rgba(139,26,26,0.5) 0%, rgba(26,10,0,0.95) 100%)'
          : 'linear-gradient(135deg, rgba(26,10,0,0.8) 0%, rgba(13,5,0,0.95) 100%)',
        boxShadow: isSelected
          ? '0 0 25px rgba(201,162,39,0.4), inset 0 1px 0 rgba(201,162,39,0.2)'
          : 'none',
        transform: isSelected ? 'translateY(-2px)' : 'none',
      }}
      onMouseEnter={e => {
        if (!disabled && !isSelected) {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,162,39,0.6)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 15px rgba(201,162,39,0.2)';
        }
      }}
      onMouseLeave={e => {
        if (!disabled && !isSelected) {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,162,39,0.3)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        }
      }}
    >
      {/* 选中标记 */}
      {isSelected && (
        <div className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded font-chinese tracking-wider"
          style={{ color: '#C9A227', border: '1px solid rgba(201,162,39,0.5)', background: 'rgba(139,26,26,0.4)' }}
        >
          已选
        </div>
      )}
      <h3 className="font-ancient text-xl md:text-2xl mb-3 tracking-widest" style={{ color: isSelected ? '#E8C84A' : '#C9A227' }}>
        {name}
      </h3>
      <div className="space-y-2.5">
        <div>
          <h4 className="font-chinese text-xs tracking-widest mb-1" style={{ color: 'rgba(201,162,39,0.6)' }}>一次性技能</h4>
          <p className="font-chinese text-xs leading-relaxed" style={{ color: 'rgba(245,230,200,0.75)' }}>{ability}</p>
        </div>
        <div className="border-t" style={{ borderColor: 'rgba(201,162,39,0.1)' }} />
        <div>
          <h4 className="font-chinese text-xs tracking-widest mb-1" style={{ color: 'rgba(201,162,39,0.6)' }}>被动技能</h4>
          <p className="font-chinese text-xs leading-relaxed" style={{ color: 'rgba(245,230,200,0.75)' }}>{passive}</p>
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
    isHotseat,
    myPlayerRole,
  } = useGameStore();

  // 同机轮流下没有「对手在另一端」这回事：双方都是你自己按顺序操作。
  // 所以「等待对手」这类 UI 只在真人对战时显示。
  const isVersus = isOnlineMode && !isHotseat;
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
  const waitingForOther = isVersus && !!myGeneral && !opponentGeneral;

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
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 20%, #2a0a00 0%, #0d0500 60%, #050200 100%)' }}
    >
      {/* 背景网格 */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px)'
      }} />

      <div className="relative z-10 max-w-6xl w-full">
        {/* 标题区域 */}
        <div className="text-center mb-8 md:mb-10">
          <h1 className="font-ancient text-3xl md:text-5xl mb-3 tracking-[0.3em]" style={{ color: '#C9A227', textShadow: '0 0 30px rgba(201,162,39,0.4)' }}>
            选 择 将 领
          </h1>
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="h-px w-24 bg-gradient-to-r from-transparent to-imperial-gold/40" />
            <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/40" />
            <div className="h-px w-24 bg-gradient-to-l from-transparent to-imperial-gold/40" />
          </div>
          {isOnlineMode ? (
            <div>
              <p className="font-chinese text-sm tracking-widest" style={{ color: 'rgba(201,162,39,0.6)' }}>
                你是 {myPlayerRole === 'player1' ? '玩家一' : '玩家二'}
              </p>
              {myGeneral ? (
                waitingForOther ? (
                  <p className="font-chinese text-sm mt-2" style={{ color: 'rgba(201,162,39,0.7)' }}>
                    等待对手选择中...
                  </p>
                ) : (
                  <p className="font-chinese text-sm mt-2" style={{ color: 'rgba(100,200,100,0.8)' }}>
                    双方均已选择，即将进入配兵阶段
                  </p>
                )
              ) : (
                <p className="font-chinese text-sm mt-2" style={{ color: 'rgba(245,230,200,0.6)' }}>
                  请选择你的将领
                </p>
              )}
            </div>
          ) : (
            <p className="font-chinese text-sm tracking-widest" style={{ color: 'rgba(201,162,39,0.6)' }}>
              {currentPlayer === Player.PLAYER1 ? '玩家一' : '玩家二'} 请选择将领
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <GeneralCard
            general={GeneralType.WUSHUANG}
            name="无双 (体力上限4)"
            ability="立刻获得当前已损失体力值数量的行动值，并解除本回合行动次数限制"
            passive="无法普通攻击，仅可使用扇形攻击（消耗3点行动值，攻击相邻3格120°扇形区域）。可连续掷骰触发额外攻击"
            onSelect={() => handleSelectGeneral(GeneralType.WUSHUANG)}
            isSelected={myGeneral === GeneralType.WUSHUANG}
            disabled={isVersus && !!myGeneral}
          />
          <GeneralCard
            general={GeneralType.SHENJI}
            name="神机 (体力上限3)"
            ability="直接修改一个骰子点数（不论敌我）"
            passive="可以将士兵单位组合成机关（弩车、战车）后直接部署"
            onSelect={() => handleSelectGeneral(GeneralType.SHENJI)}
            isSelected={myGeneral === GeneralType.SHENJI}
            disabled={isVersus && !!myGeneral}
          />
          <GeneralCard
            general={GeneralType.RENDE}
            name="仁德 (体力上限4)"
            ability="消耗2点将接触单位转化为己方，若上回合无击杀可对敌将使用直接获胜"
            passive="击杀时可选择避免死亡，使其成为1血中立单位。可花费行动点转化中立单位"
            onSelect={() => handleSelectGeneral(GeneralType.RENDE)}
            isSelected={myGeneral === GeneralType.RENDE}
            disabled={isVersus && !!myGeneral}
          />
          <GeneralCard
            general={GeneralType.TAIPING}
            name="太平 (体力上限3)"
            ability="豆饭：消耗3点行动值，掷d6在将军相邻空位召唤等量黄巾力士"
            passive="符水粥：回合开始可将残血步兵升为2血力士（消耗行动点）。夺天命：回合结束掷苍天/黄天骰更新天命值，若力士数超过天命值则承载扣1血。将军阵亡后力士变贼，贼相邻单位行动时受系统伤害"
            onSelect={() => handleSelectGeneral(GeneralType.TAIPING)}
            isSelected={myGeneral === GeneralType.TAIPING}
            disabled={isVersus && !!myGeneral}
          />
        </div>

        {/* 单机模式确认按钮 */}
        {!isOnlineMode && (
          <div className="flex justify-center">
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-10 py-3 rounded font-chinese tracking-widest transition-all duration-300"
              style={{
                border: canConfirm ? '1px solid rgba(201,162,39,0.7)' : '1px solid rgba(201,162,39,0.2)',
                color: canConfirm ? '#E8C84A' : 'rgba(201,162,39,0.3)',
                background: canConfirm ? 'linear-gradient(135deg, rgba(139,26,26,0.5) 0%, rgba(26,10,0,0.9) 100%)' : 'rgba(13,5,0,0.5)',
                cursor: canConfirm ? 'pointer' : 'not-allowed',
                boxShadow: canConfirm ? '0 0 20px rgba(201,162,39,0.2)' : 'none',
              }}
              onMouseEnter={e => canConfirm && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 30px rgba(201,162,39,0.4)')}
              onMouseLeave={e => canConfirm && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(201,162,39,0.2)')}
            >
              {currentPlayer === Player.PLAYER1 ? '确认（下一位选将）' : '确认（进入配兵）'}
            </button>
          </div>
        )}

        {/* 在线模式状态 */}
        {isVersus && (
          <div className="flex justify-center">
            <div className="px-6 py-2 rounded font-chinese text-sm tracking-wider"
              style={{ border: '1px solid rgba(201,162,39,0.2)', color: 'rgba(201,162,39,0.6)', background: 'rgba(13,5,0,0.5)' }}
            >
              {player1General && player2General
                ? '双方均已选择，即将进入配兵阶段'
                : player1General
                ? '玩家一已选择，等待玩家二'
                : player2General
                ? '玩家二已选择，等待玩家一'
                : '等待双方选择'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
