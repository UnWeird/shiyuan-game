/**
 * 音效：全部用 Web Audio 实时合成，不引入任何音频文件。
 *
 * 为什么不用采样：棋类游戏需要的声音都是短促打击音（落子、刀击、磬、锣），
 * 合成足够像，且省掉几百 KB 二进制资产、授权问题和加载延迟。
 * 参数都在这一个文件里，想调手感直接改数字。
 *
 * 浏览器自动播放策略：AudioContext 创建后处于 suspended，
 * 必须在用户手势里 resume()。所有音效都由点击触发，故在 ensureCtx() 里顺带 resume。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** 复用一段白噪声，避免每次播放都重新填缓冲 */
let noiseBuffer: AudioBuffer | null = null;

/**
 * 主音量（0–1）。0.55 时单声峰值约 0.2（-14 dBFS），
 * 攻击这类 4 层叠加的音效峰值约 0.4，留足余量不会削波。
 */
const MASTER_VOLUME = 0.55;

let enabled = true;

/** 由 uiStore 同步静音开关 */
export function setSfxEnabled(on: boolean) {
  enabled = on;
  if (master && ctx) {
    master.gain.setTargetAtTime(on ? MASTER_VOLUME : 0, ctx.currentTime, 0.01);
  }
}

function ensureCtx() {
  if (!ctx) {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? MASTER_VOLUME : 0;
    master.connect(ctx.destination);

    // 1 秒白噪声，所有打击音的瞬态都从这里取
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, master: master!, noiseBuffer: noiseBuffer! };
}

/** 预热：首次用户手势时建好 AudioContext，避免第一声延迟 */
export function warmUpAudio() {
  ensureCtx();
}

/**
 * 噪声瞬态：打击音的「咔」
 * @param duration 时长（秒）
 * @param filterType 滤波类型，木头用 bandpass，金属用 highpass
 * @param freq 滤波中心频率
 */
function noiseHit(opts: {
  duration: number;
  gain: number;
  filterType: BiquadFilterType;
  freq: number;
  q?: number;
  delay?: number;
}) {
  const a = ensureCtx();
  if (!a) return;
  const { ctx, master, noiseBuffer } = a;
  const t0 = ctx.currentTime + (opts.delay ?? 0);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  // 随机起点，避免每次听起来完全一样
  const offset = Math.random() * (noiseBuffer.duration - opts.duration - 0.01);

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q ?? 1;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(opts.gain, t0 + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

  src.connect(filter).connect(env).connect(master);
  src.start(t0, offset, opts.duration + 0.02);
  src.stop(t0 + opts.duration + 0.02);
}

/**
 * 单个正弦/三角分音，带指数衰减。磬、锣、木头的共鸣体都用它叠出来。
 */
function tone(opts: {
  freq: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
  /** 结束频率，用于做弯音（锣的下坠感） */
  endFreq?: number;
}) {
  const a = ensureCtx();
  if (!a) return;
  const { ctx, master } = a;
  const t0 = ctx.currentTime + (opts.delay ?? 0);

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.endFreq) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.duration);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(opts.gain, t0 + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + opts.duration + 0.02);
}

/** 可用音效名 */
export type SfxName =
  | 'select'   // 选中棋子
  | 'place'    // 部署 / 落子
  | 'move'     // 移动
  | 'rotate'   // 转向
  | 'attack'   // 攻击
  | 'kill'     // 击杀
  | 'dice'     // 掷骰
  | 'turn'     // 回合切换
  | 'error'    // 非法操作
  | 'success'  // 操作成功
  | 'victory'  // 胜
  | 'defeat';  // 负

/** 每种音效的合成配方 */
const RECIPES: Record<SfxName, () => void> = {
  // 轻触：很短的高频木音，不能抢戏
  select: () => {
    noiseHit({ duration: 0.03, gain: 0.25, filterType: 'bandpass', freq: 2600, q: 1.5 });
    tone({ freq: 880, duration: 0.05, gain: 0.05 });
  },

  // 落子：木块撞击 —— 噪声瞬态 + 低频共鸣体
  place: () => {
    noiseHit({ duration: 0.05, gain: 0.5, filterType: 'bandpass', freq: 1500, q: 1.1 });
    tone({ freq: 196, duration: 0.14, gain: 0.3, type: 'triangle' });
    tone({ freq: 392, duration: 0.08, gain: 0.12 });
  },

  // 移动：比落子轻、闷一点
  move: () => {
    noiseHit({ duration: 0.04, gain: 0.32, filterType: 'bandpass', freq: 1100, q: 1.2 });
    tone({ freq: 165, duration: 0.11, gain: 0.2, type: 'triangle' });
  },

  // 转向：两声极短的木音，表达「咔—咔」的档位感
  rotate: () => {
    noiseHit({ duration: 0.025, gain: 0.28, filterType: 'bandpass', freq: 2000, q: 2 });
    noiseHit({ duration: 0.025, gain: 0.22, filterType: 'bandpass', freq: 2400, q: 2, delay: 0.07 });
  },

  // 攻击：金属刀击 —— 高频噪声 + 一个短促的金属余音
  attack: () => {
    noiseHit({ duration: 0.07, gain: 0.55, filterType: 'highpass', freq: 2800 });
    tone({ freq: 1760, duration: 0.12, gain: 0.14 });
    tone({ freq: 2640, duration: 0.09, gain: 0.08 });
    tone({ freq: 147, duration: 0.09, gain: 0.18, type: 'triangle' });
  },

  // 击杀：更重的闷击 + 下坠
  kill: () => {
    noiseHit({ duration: 0.12, gain: 0.55, filterType: 'lowpass', freq: 900 });
    tone({ freq: 160, endFreq: 70, duration: 0.3, gain: 0.35, type: 'triangle' });
    tone({ freq: 320, duration: 0.14, gain: 0.12 });
  },

  // 掷骰：4 声随机间隔的小木音，模拟骰子滚动
  dice: () => {
    for (let i = 0; i < 4; i++) {
      noiseHit({
        duration: 0.03,
        gain: 0.3 - i * 0.05,
        filterType: 'bandpass',
        freq: 1800 + Math.random() * 1200,
        q: 1.8,
        delay: i * 0.055 + Math.random() * 0.02,
      });
    }
  },

  // 回合切换：磬 —— 非整数倍分音是金属体的关键，整数倍会像电子音
  turn: () => {
    tone({ freq: 660, duration: 1.1, gain: 0.16 });
    tone({ freq: 660 * 2.76, duration: 0.7, gain: 0.05 });
    tone({ freq: 660 * 5.4, duration: 0.4, gain: 0.025 });
    noiseHit({ duration: 0.02, gain: 0.12, filterType: 'highpass', freq: 4000 });
  },

  // 非法操作：闷的一声「咚」，不用刺耳的蜂鸣
  error: () => {
    noiseHit({ duration: 0.06, gain: 0.3, filterType: 'lowpass', freq: 400 });
    tone({ freq: 110, endFreq: 82, duration: 0.18, gain: 0.3, type: 'triangle' });
  },

  // 操作成功：轻快的上行两音
  success: () => {
    tone({ freq: 784, duration: 0.1, gain: 0.12 });
    tone({ freq: 1175, duration: 0.14, gain: 0.1, delay: 0.08 });
  },

  // 胜：锣 + 上行磬音
  victory: () => {
    noiseHit({ duration: 0.5, gain: 0.3, filterType: 'bandpass', freq: 700, q: 0.7 });
    tone({ freq: 262, duration: 1.8, gain: 0.26, type: 'triangle' });
    tone({ freq: 392, duration: 1.5, gain: 0.18, delay: 0.1 });
    tone({ freq: 523, duration: 1.4, gain: 0.14, delay: 0.22 });
    tone({ freq: 784, duration: 1.2, gain: 0.1, delay: 0.34 });
  },

  // 负：低沉的锣，带下坠
  defeat: () => {
    noiseHit({ duration: 0.6, gain: 0.26, filterType: 'lowpass', freq: 500 });
    tone({ freq: 196, endFreq: 147, duration: 1.9, gain: 0.28, type: 'triangle' });
    tone({ freq: 233, endFreq: 175, duration: 1.5, gain: 0.14, delay: 0.12 });
  },
};

/** 同名音效的最小间隔（毫秒），防止连点时叠成噪音 */
const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  select: 60,
  move: 80,
  attack: 80,
  error: 140,
  success: 140,
};

const lastPlayed = new Map<SfxName, number>();

/** 播放音效。静音或浏览器不支持时静默返回。 */
export function playSfx(name: SfxName) {
  if (!enabled) return;

  const throttle = THROTTLE_MS[name];
  if (throttle) {
    const now = performance.now();
    const prev = lastPlayed.get(name) ?? 0;
    if (now - prev < throttle) return;
    lastPlayed.set(name, now);
  }

  try {
    RECIPES[name]();
  } catch (e) {
    // 音效失败绝不能影响对局
    console.warn('[sfx] 播放失败:', name, e);
  }
}
