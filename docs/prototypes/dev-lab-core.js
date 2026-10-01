/* 十元棋 · 设计实验公共核心
 * 几何与 shared/utils/hexUtils.ts 完全一致（pointy-top）。
 * 这里只负责画，不含任何游戏逻辑。
 */

/* ============ 调色：世界色 / 信息色 严格分开 ============ */
export const C = {
  p1:'#C0392B', p1d:'#7E1C15', p1lit:'#F0C9B4',
  p2:'#2FA07A', p2d:'#17543F', p2lit:'#C2E6D6',
  parch:'#F3E6CA', bone:'#E8DCC2', ink:'#0B0E12',
  /* 青铜器体系用的材质色 */
  gold:'#C9A227', goldL:'#E3C661',
  jade1:'#D98A74', jade1d:'#6E2317',   // 朱玉
  jade2:'#8FC4A6', jade2d:'#1D5B42',   // 青玉
  lac1:'#8E2B20',  lac2:'#17543F',     // 朱漆 / 青漆
  /* 信息层：固定语义，任何别的地方都不许用这四个色 */
  move:'#5BC8E8',   // 青   = 我方可移动
  face:'#F0B44A',   // 琥珀 = 朝向 / 射界 / 友伤
  threat:'#E2564B', // 朱   = 敌方威胁 / 致命
  pick:'#FFFFFF',   // 白   = 当前选中
};

/* ============ 六边形几何 ============ */
export const HS = 31, HR = 2;
export const hc = (q,r,s=HS)=>({ x:s*(Math.sqrt(3)*q + Math.sqrt(3)/2*r), y:s*1.5*r });
export const hpath = (q,r,k=1,s=HS)=>{ const c=hc(q,r,s);
  return Array.from({length:6},(_,i)=>{ const a=Math.PI/180*(60*i+30);
    return `${i?'L':'M'} ${(c.x+s*k*Math.cos(a)).toFixed(1)},${(c.y+s*k*Math.sin(a)).toFixed(1)}`;
  }).join(' ')+' Z'; };
export const hexMap = (R=HR)=>{ const o=[];
  for(let q=-R;q<=R;q++) for(let r=Math.max(-R,-q-R);r<=Math.min(R,-q+R);r++) o.push({q,r});
  return o; };
/**
 * 边 i（顶点 i → i+1，顶点角 = 60i+30）的外法线朝向 60(i+1)°，
 * 对应的邻居方向如下。用它把"边"映射到"格对"，就能用整数坐标去重。
 */
const EDGE_DIR = ['SE','SW','W','NW','NE','E'];
/**
 * 去重后的单遍缝线：共享边只画一次，彻底消除双描边脏缝。
 *
 * 去重键必须用**整数格坐标对**，不能用像素坐标。
 * 像素坐标含 √3 无理因子，两个相邻格算同一个顶点时会落在
 * 26.649999 / 26.650001 这类小数边界两侧，toFixed(1) 得到不同字符串，
 * 于是那条共享边被画两遍 —— 半径 5 时实测会漏掉 14 条（320 条 vs 应有 306 条）。
 */
export const seamPath = (R=HR,s=HS)=>{ const seen=new Set(), out=[];
  for(const {q,r} of hexMap(R)){ const c=hc(q,r,s);
    const cs=Array.from({length:6},(_,i)=>{const a=Math.PI/180*(60*i+30);
      return [c.x+s*Math.cos(a), c.y+s*Math.sin(a)];});
    for(let i=0;i<6;i++){
      const [dq,dr] = DIR[EDGE_DIR[i]];
      const me = `${q},${r}`, nb = `${q+dq},${r+dr}`;
      const k = me < nb ? `${me}|${nb}` : `${nb}|${me}`;
      if(seen.has(k)) continue;
      seen.add(k);
      const a=cs[i], b=cs[(i+1)%6];
      out.push(`M ${a[0].toFixed(2)} ${a[1].toFixed(2)} L ${b[0].toFixed(2)} ${b[1].toFixed(2)}`);
    } }
  return out.join(' '); };
export const DIR = { E:[1,0], NE:[1,-1], NW:[0,-1], W:[-1,0], SW:[-1,1], SE:[0,1] };
export const DEG = { E:0, NE:-60, NW:-120, W:180, SW:120, SE:60 };
export const ray = (q,r,d,n=3)=>Array.from({length:n},(_,i)=>
  ({ q:q+DIR[d][0]*(i+1), r:r+DIR[d][1]*(i+1) }));
export const onBoard = (h,R=HR)=>
  Math.abs(h.q)<=R && Math.abs(h.r)<=R && Math.abs(-h.q-h.r)<=R;
export const hexDist = (a,b)=>
  (Math.abs(a.q-b.q) + Math.abs(a.r-b.r) + Math.abs((-a.q-a.r)-(-b.q-b.r)))/2;
/** 距离 c 不超过 n 格的所有格子（不含自己），按距离分桶 —— 骑兵的真实可达区 */
export const bands = (c,n,R=HR)=>{
  const out = Array.from({length:n},()=>[]);
  for(const h of hexMap(R)){ const d = hexDist(c,h);
    if(d>=1 && d<=n) out[d-1].push(h); }
  return out;
};
/** 相邻 6 格（近战攻击范围） */
export const neighbors = (c,R=HR)=>Object.values(DIR)
  .map(([dq,dr])=>({q:c.q+dq, r:c.r+dr})).filter(h=>onBoard(h,R));
/** 以 c 为顶点、朝 d 方向的 120° 扇形相邻 3 格（无双） */
export const fan = (c,d,R=HR)=>{
  const order = ['E','NE','NW','W','SW','SE'], i = order.indexOf(d);
  return [order[(i+5)%6], order[i], order[(i+1)%6]]
    .map(k=>({q:c.q+DIR[k][0], r:c.r+DIR[k][1]})).filter(h=>onBoard(h,R));
};

/* ============ 小工具 ============ */
export const pol = (r,deg)=>[r*Math.cos(deg*Math.PI/180), r*Math.sin(deg*Math.PI/180)];
export const arc = (r,a0,a1,w,color,op=1)=>{
  const [x0,y0]=pol(r,a0), [x1,y1]=pol(r,a1), big=(a1-a0)>180?1:0;
  return `<path d="M ${x0.toFixed(1)},${y0.toFixed(1)} A ${r},${r} 0 ${big} 1 ${x1.toFixed(1)},${y1.toFixed(1)}"
    fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
};
export const tileFill = (q,r,c,op=1,s=HS)=>
  `<path d="${hpath(q,r,1,s)}" fill="${c}" opacity="${op}"/>`;
export const tileRing = (q,r,c,w=2,k=.88,s=HS)=>
  `<path d="${hpath(q,r,k,s)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
export const at = (x,y,inner,rot=0,sc=1)=>
  `<g transform="translate(${(+x).toFixed(1)},${(+y).toFixed(1)})${rot?` rotate(${rot})`:''}${sc!==1?` scale(${sc})`:''}">${inner}</g>`;

/* ============ 图形记号（替代盘面文字） ============
 * 同一套笔画语法：统一线宽、统一圆端、只用四个信息色。
 * 所有记号都以原点为中心绘制，u = 基准尺寸。
 */
export const G = {
  /** 行进步数：几格就几个尖角，指向行进方向。替代「1 / 2 / 3」 */
  chevron: (n,u,c,op=1)=>{ const w=u*.22, gp=u*.3;
    return Array.from({length:n},(_,i)=>{ const x=-((n-1)*gp)/2 + i*gp;
      return `<path d="M ${x-u*.16},${-u*.3} L ${x+u*.16},0 L ${x-u*.16},${u*.3}"
        fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"
        stroke-linejoin="round" opacity="${op}"/>`; }).join(''); },

  /** 攻击：矛尖。outline=可攻击，solid=致命，加 slash=不可攻击 */
  blade: (u,c,{solid=false,forbid=false}={})=>{
    const b = `<path d="M 0,${-u*.52} L ${u*.26},${-u*.04} L 0,${u*.5} L ${-u*.26},${-u*.04} Z"
      fill="${solid?c:'none'}" stroke="${c}" stroke-width="${u*.17}" stroke-linejoin="round"/>`;
    return b + (forbid? G.slash(u*1.25,c) : ''); },

  /** 免伤 / 方阵：盾 */
  shield: (u,c,solid=true)=>`<path d="M 0,${-u*.5} L ${u*.38},${-u*.3} L ${u*.38},${u*.08}
    Q ${u*.38},${u*.42} 0,${u*.56} Q ${-u*.38},${u*.42} ${-u*.38},${u*.08}
    L ${-u*.38},${-u*.3} Z" fill="${solid?c:'none'}" stroke="${c}" stroke-width="${u*.15}"
    stroke-linejoin="round"/>`,

  /** 转向：回转箭头。配 pips 表示耗费的行动点 */
  rotate: (u,c)=>`${arc(u*.42,-200,70,u*.17,c)}
    <path d="M ${(u*.42*Math.cos(70*Math.PI/180)).toFixed(1)},${(u*.42*Math.sin(70*Math.PI/180)).toFixed(1)}
      m ${-u*.2},${-u*.05} l ${u*.2},${u*.18} l ${u*.06},${-u*.26} Z" fill="${c}"/>`,

  /** 可数资源：行动点 / 蓄力层 */
  pips: (n,u,c,op=1)=>Array.from({length:n},(_,i)=>
    `<circle cx="${(-((n-1)*u*.34)/2 + i*u*.34).toFixed(1)}" cy="0" r="${u*.12}"
      fill="${c}" opacity="${op}"/>`).join(''),

  /** 大本营：牙旗 */
  banner: (u,c)=>`<line x1="${-u*.26}" y1="${-u*.56}" x2="${-u*.26}" y2="${u*.56}"
      stroke="${c}" stroke-width="${u*.15}" stroke-linecap="round"/>
    <path d="M ${-u*.26},${-u*.5} L ${u*.5},${-u*.26} L ${-u*.26},${u*.02} Z"
      fill="${c}"/>`,

  /** 否定 / 已行动 */
  slash: (u,c)=>`<line x1="${-u*.42}" y1="${u*.42}" x2="${u*.42}" y2="${-u*.42}"
    stroke="${c}" stroke-width="${u*.16}" stroke-linecap="round"/>`,

  /** 强制位移：击退 / 冲锋带 */
  arrow: (len,u,c,op=1)=>`<line x1="0" y1="0" x2="${len-u*.3}" y2="0" stroke="${c}"
      stroke-width="${u*.16}" stroke-linecap="round" opacity="${op}"/>
    <path d="M ${len},0 L ${len-u*.34},${-u*.24} L ${len-u*.34},${u*.24} Z" fill="${c}" opacity="${op}"/>`,

  /** 伤害加成：矛尖上的倒钩 */
  barb: (u,c)=>G.blade(u,c,{solid:true}) +
    `<path d="M ${-u*.3},${-u*.3} L ${-u*.52},${-u*.46} M ${u*.3},${-u*.3} L ${u*.52},${-u*.46}"
      stroke="${c}" stroke-width="${u*.15}" stroke-linecap="round"/>`,
};

/* ============ 棋子令牌（P3 / P4） ============ */
let _uid = 0;
/**
 * token(o)
 *  variant 'flat'(P3) | 'solid'(P4) | 'old'(现状对照)
 *  skin    'dark'(深底浅字·深盘用) | 'light'(浅底深字·水墨夜卷用)
 *  ch 汉字 · side 'p1'|'p2' · hp/maxHp · move · facing(deg|null) · spent · charge
 */
export function token(o){
  const { x=0, y=0, rr=26, variant='flat', skin='dark', ch='步', side='p1',
          hp=2, maxHp=2, move=1, facing=null, spent=false, charge=0 } = o;
  const uid = `tk${++_uid}`;
  const base = side==='p1'? C.p1 : C.p2;
  const deep = side==='p1'? C.p1d : C.p2d;
  const lit  = side==='p1'? C.p1lit : C.p2lit;
  const one = side==='p1';
  /* 皮肤表：face=盘面, glyphC=字, rimC=圈, rimW=圈粗细倍数
   * 全部平面，没有渐变也没有投影方向 —— 靠材质色与明度分离，不靠厚度。 */
  const SKIN = {
    dark:   { face:base,                glyphC:C.parch,                 rimC:'rgba(0,0,0,.28)' },
    light:  { face:C.bone,              glyphC:deep,                    rimC:base },
    bone:   { face:C.bone,              glyphC:deep,                    rimC:base, rimW:1.4 },
    jade:   { face:one?C.jade1:C.jade2, glyphC:one?C.jade1d:C.jade2d,   rimC:C.gold, rimW:.9 },
    lacquer:{ face:one?C.lac1:C.lac2,   glyphC:C.goldL,                 rimC:C.gold, rimW:1.2 },
  }[skin] || { face:base, glyphC:C.parch, rimC:'rgba(0,0,0,.28)' };
  const face = SKIN.face, glyphC = SKIN.glyphC, rimC = SKIN.rimC, rimW = SKIN.rimW ?? 1;
  let g = '';

  if(variant==='old'){
    return `<defs><radialGradient id="${uid}" cx="35%" cy="28%" r="78%">
        <stop offset="0%" stop-color="${lit}"/><stop offset="100%" stop-color="${deep}"/>
      </radialGradient></defs>
      ${at(x,y,`<circle r="${rr}" fill="url(#${uid})" stroke="${deep}" stroke-width="${rr*.12}"/>
        <text y="1" text-anchor="middle" dominant-baseline="middle" font-size="${rr}"
          fill="${C.parch}" font-weight="700">${ch}</text>`)}`;
  }

  /* 朝向：画在体力/移动弧之外的独立尖角，避免被弧挡住（弧半径 1.3rr） */
  if(facing!==null)
    g += at(0,0,
      `<path d="M ${rr*1.42},${-rr*.5} L ${rr*2.0},0 L ${rr*1.42},${rr*.5} Z"
             fill="${C.face}" stroke="rgba(0,0,0,.35)" stroke-width="${rr*.05}"/>
       <line x1="${rr*.96}" y1="0" x2="${rr*1.4}" y2="0" stroke="${C.face}"
             stroke-width="${rr*.16}" stroke-linecap="butt"/>`, facing);

  if(variant==='solid'){
    g += `<ellipse cy="${rr*.78}" rx="${rr*1.02}" ry="${rr*.24}" fill="rgba(0,0,0,.5)"/>
      <circle cy="${rr*.34}" r="${rr}" fill="${skin==='light'?'#B9AC90':deep}"/>
      <rect x="${-rr}" y="0" width="${rr*2}" height="${rr*.34}" fill="${skin==='light'?'#B9AC90':deep}"/>
      <circle r="${rr}" fill="${face}"/>
      <circle r="${rr}" fill="none" stroke="${rimC}" stroke-width="${rr*.09}"/>`;
  } else {
    g += `<circle r="${rr}" fill="${face}"/>
      <circle r="${rr*.9}" fill="none" stroke="${rimC}" stroke-width="${rr*.07*rimW}"/>`;
  }

  /* 汉字水平 + 垂直居中：text-anchor 管水平，dominant-baseline="central" 管垂直。
     不加任何 y 偏移 —— CJK 字形的墨区本就居中于 em 框，"middle" 是字母中线、会偏下。 */
  g += `<text x="0" y="0" text-anchor="middle" dominant-baseline="central"
    font-size="${rr*.86}" fill="${glyphC}" font-weight="600">${ch}</text>`;

  /* 上弧 = 体力刻度 */
  const TOT=104, gp=16, span=(TOT+gp)/maxHp - gp, st=-90-TOT/2;
  for(let i=0;i<maxHp;i++)
    g += arc(rr*1.3, st+i*(span+gp), st+i*(span+gp)+span, rr*.2,
             i<hp? C.parch : 'rgba(160,150,135,.3)');
  /* 下弧 = 移动力刻度 */
  const MT=20, mg=12, ms=90 - ((move*MT+(move-1)*mg) - MT)/2;
  for(let i=0;i<move;i++) g += arc(rr*1.3, ms-i*(MT+mg)-MT/2, ms-i*(MT+mg)+MT/2, rr*.2, C.move);
  /* 蓄力层 */
  if(charge) g += at(0,-rr*1.62, G.pips(charge, rr*1.1, C.face));
  /* 已行动 */
  if(spent) g += `<circle r="${rr}" fill="#070A0D" opacity=".58"/>
    ${at(0,0,G.slash(rr*1.5,'rgba(255,255,255,.55)'))}`;

  return at(x,y,g);
}
