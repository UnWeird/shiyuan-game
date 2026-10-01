import type { Room } from 'colyseus.js';
import { colyseusService } from '../services/ColyseusService';

/**
 * 开发工具与服务端之间的桥。
 *
 * 刻意放在 dev/ 而不是 ColyseusService 里：ColyseusService 是生产代码，
 * 在它上面加 devXxx 方法会让 "__devSaveState" 这类字符串进到生产包。
 * 放在这里，整个 dev/ 目录在生产构建下会被完整 tree-shake。
 *
 * room 是 ColyseusService 的私有字段，这里用下标访问绕开（RoomLobby 也是这么做的）。
 */
function getRoom(): Room | null {
  return (colyseusService as unknown as { room: Room | null }).room ?? null;
}

/**
 * 向服务端索取当前局面快照。
 * 需要服务端以 SHIYUAN_DEV_TOOLS=1 启动，否则会超时。
 */
export function requestSnapshot(label?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const room = getRoom();
    if (!room) {
      reject(new Error('未连接房间'));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error('服务端无响应，确认已用 SHIYUAN_DEV_TOOLS=1 启动')),
      3000
    );
    // onMessage 返回取消订阅函数，收到一次就解绑
    const off = room.onMessage('__devSnapshot', (snapshot: Record<string, unknown>) => {
      clearTimeout(timer);
      off();
      resolve(snapshot);
    });
    room.send('__devSaveState', { label });
  });
}

/** 把快照写回服务端 */
export function loadSnapshot(snapshot: Record<string, unknown>) {
  getRoom()?.send('__devLoadState', { snapshot });
}
