/**
 * 六边形工具函数 —— 统一从 shared/utils/hexUtils.ts 再导出
 *
 * 这里原来是 shared 版本的一份 484 行拷贝，且已经开始分歧：
 * shared 多了 tryKnockback / knockbackInfantryChain / getCatapultSplashTargets 三个函数，
 * 服务端用 shared 版、客户端用这份拷贝，同一条规则要改两处，改漏一处就是一个 bug。
 *
 * 保留这个文件（而不是全局改 import 路径）是为了不动二十多处调用点；
 * 它现在只是一层转发，没有自己的实现。
 */
export * from '../../../shared/utils/hexUtils';
