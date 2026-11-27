import { randomUUID } from "node:crypto";
import type { SermonReplayFrame, SermonReplayInfo, SermonStateDTO } from "../../shared/types.js";
import type { SermonPresentationServiceDeps } from "./presentations.js";
import { deserializeSermonState } from "./state.js";

const catalog = "sermon.replay.";
const frameKey = (id: string, index: number) => `sermon.frame.${id}.${index}`;
type Entry = SermonReplayInfo & { owner: number; viewers: number[] | "assembly" };
type Cursor = Pick<SermonReplayInfo, "id" | "title" | "started" | "count">;

export function createReplayArchive(deps: SermonPresentationServiceDeps) {
  async function entry(id: string, account: number): Promise<SermonReplayInfo | null> {
    const raw = await deps.loadSetting(catalog + id);
    if (!raw) return null;
    const { owner, viewers, ...info } = JSON.parse(raw) as Entry;
    return owner === account || viewers === "assembly" || viewers.includes(account) ? info : null;
  }
  return {
    async list(account: number) {
      const keys = await deps.listSettingKeys(catalog);
      const rows = await Promise.all(keys.map(key => entry(key.slice(catalog.length), account)));
      return rows.filter((r): r is SermonReplayInfo => r !== null).sort((a,b) => b.started - a.started);
    },
    async frame(account: number, id: string, index: number): Promise<SermonReplayFrame | null> {
      const info = await entry(id, account);
      if (!info || index >= info.count || index < 0) return null;
      const raw = await deps.loadSetting(frameKey(id,index));
      return raw ? JSON.parse(raw) as SermonReplayFrame : null;
    },
    persistence(key: string, owner: number, viewers: () => number[]) {
      let cursor: Cursor | undefined;
      let last = "";
      return {
        async load() {
          const raw = await deps.loadSetting(key);
          if (raw) {
            // Legacy working rows have no recording cursor.
            const state = deserializeSermonState(raw);
            try { cursor = (JSON.parse(raw) as { recording?: Cursor }).recording; }
            catch { cursor = undefined; }
            if (cursor && state.active) last = JSON.stringify({ item: state.queue.find(i => i.id === state.currentItemId), display: state.display });
          }
          return raw;
        },
        async save(serialized: string, state: SermonStateDTO) {
          const rows: Array<{key: string; value: string}> = [];
          const at = (deps.now?.() ?? new Date()).getTime();
          const item = state.active && state.queue.find(i => i.id === state.currentItemId);
          let next = cursor;
          let image = "";
          if (item) {
            const screen = { item, display: state.display };
            image = JSON.stringify(screen);
            if (!next || last !== image) {
              const session = next ?? { id: randomUUID(), title: item.map?.title || item.title || item.normalizedReference, started: at, count: 0 };
              rows.push({ key: frameKey(session.id, session.count), value: JSON.stringify({ ...screen, at }) });
              next = { ...session, count: session.count + 1 };
            }
          } else if (cursor) {
            const info: Entry = { ...cursor, owner, presenter: state.presenterName, ended: at, viewers: state.scope === "assembly" ? "assembly" : viewers() };
            rows.push({ key: catalog + cursor.id, value: JSON.stringify(info) });
            next = undefined;
          }
          rows.push({ key, value: next ? JSON.stringify({ ...state, recording: next }) : serialized });
          if (rows.some(row => Buffer.byteLength(row.value) > 65_535)) throw new Error("讲道内容过大，请减少队列中的内容");
          if (deps.saveSettings) await deps.saveSettings(rows);
          else for (const row of rows) await deps.saveSetting(row.key, row.value);
          cursor = next;
          last = image;
        }
      };
    }
  };
}
