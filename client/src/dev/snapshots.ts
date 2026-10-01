/**
 * 开发工具：局面快照的存取
 *
 * 解决的是「为了验一个中局 bug，得开两个窗口从选将开始打十分钟」。
 * 存下来的快照可以下载成 .json 文件，当作 bug 复现用例长期保留，
 * 之后写自动化测试时可以直接拿这些文件当 fixture。
 *
 * 整个 dev/ 目录只在 import.meta.env.DEV 下被引用，生产构建会被 tree-shake。
 */

const STORAGE_KEY = 'sy_devSnapshots';
/** 最多保留的快照数，避免把 localStorage 撑满 */
const MAX_SNAPSHOTS = 20;

export type SnapshotMode = 'online' | 'local';

export interface Snapshot {
  id: string;
  label: string;
  savedAt: string;
  /**
   * online = 服务端 schema 的原始 JSON；local = 客户端 gameStore 的状态。
   * 两者字段结构不同，不能交叉载入。
   */
  mode: SnapshotMode;
  data: Record<string, unknown>;
}

export function listSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: Snapshot[]): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '写入 localStorage 失败';
  }
}

/** 保存一个快照，返回错误信息（成功时为 null） */
export function saveSnapshot(
  label: string,
  mode: SnapshotMode,
  data: Record<string, unknown>
): { snapshot: Snapshot; error: string | null } {
  const snapshot: Snapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || `未命名 ${new Date().toLocaleString('zh-CN')}`,
    savedAt: new Date().toISOString(),
    mode,
    data,
  };
  // 新的放最前，超出上限丢弃最旧的
  const list = [snapshot, ...listSnapshots()].slice(0, MAX_SNAPSHOTS);
  return { snapshot, error: persist(list) };
}

export function deleteSnapshot(id: string) {
  persist(listSnapshots().filter(s => s.id !== id));
}

/** 下载成 .json 文件，便于提交到仓库当复现用例 */
export function downloadSnapshot(snapshot: Snapshot) {
  const safe = snapshot.label.replace(/[^\w一-鿿-]+/g, '_').slice(0, 40);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shiyuan-${safe}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 从文件读入快照并存进列表 */
export async function importSnapshotFile(file: File): Promise<{ snapshot?: Snapshot; error?: string }> {
  try {
    const parsed = JSON.parse(await file.text());
    // 支持两种输入：本工具导出的完整 Snapshot，或裸的服务端快照
    if (parsed && typeof parsed === 'object' && 'data' in parsed && 'mode' in parsed) {
      const s = parsed as Snapshot;
      const { snapshot, error } = saveSnapshot(s.label ?? file.name, s.mode, s.data);
      return error ? { error } : { snapshot };
    }
    if (parsed && typeof parsed === 'object' && '__version' in parsed) {
      const { snapshot, error } = saveSnapshot(file.name, 'online', parsed);
      return error ? { error } : { snapshot };
    }
    return { error: '无法识别的文件格式' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '解析失败' };
  }
}

