import type { Db } from '../db/db';
import { listSections, listSpaces, createSpace, updateSpace } from './projects';

export interface LinkedSpaceAction {
  type: 'create' | 'rename';
  name: string;
  oldName?: string;
}

/**
 * 板块空间联动同步（spec §6 逐字）：源 = 项目内 sort_order 最小的板块；仅新增与改名同步，删除不同步；
 * 置底空间不参与；同步目标 = 该项目内 link_spaces=1 的其它板块（显式排除源自身，即便源自身
 * link_spaces 被置 1）。调用方负责在「操作发生在源板块」时才调用本函数，本函数内部只按 projectId
 * 重新推导源板块与目标集合，不信任调用方传入的板块归属判断。
 *
 * create：目标板块已存在同名非置底空间时跳过（避免重复），否则新建同名非置底空间（自然排在
 * 置底空间之前，见 createSpace/listSpaces 的 pin_bottom 排序）。
 * rename：按 oldName 匹配目标板块内的非置底空间，命中则改名；未命中跳过。
 *
 * 返回实际发生同步（新建或改名成功）的板块数。项目内板块少于 2 个、或无联动目标板块时返回 0。
 */
export function syncLinkedSpaces(db: Db, projectId: number, action: LinkedSpaceAction): number {
  const run = db.transaction(() => {
    const sections = listSections(db, projectId); // 已按 sort_order 升序
    if (sections.length < 2) return 0;
    const sourceId = sections[0].id;
    const targets = sections.filter((s) => s.linkSpaces && s.id !== sourceId);
    if (targets.length === 0) return 0;

    let affected = 0;
    for (const sec of targets) {
      const spaces = listSpaces(db, sec.id);
      if (action.type === 'create') {
        const dup = spaces.some((sp) => !sp.pinBottom && sp.name === action.name);
        if (dup) continue;
        createSpace(db, { sectionId: sec.id, name: action.name });
        affected++;
      } else {
        const match = spaces.find((sp) => !sp.pinBottom && sp.name === action.oldName);
        if (!match) continue;
        updateSpace(db, match.id, { name: action.name });
        affected++;
      }
    }
    return affected;
  });
  return run();
}
