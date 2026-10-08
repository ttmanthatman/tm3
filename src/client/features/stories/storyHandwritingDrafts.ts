import {
  createHandwritingDraftRepository,
  createIndexedDbHandwritingDraftStorage,
  type HandwritingDraftStorage
} from "../handwriting/handwritingDrafts";

const prefix = "story-reply:";

// Reuse the handwriting store without letting story/reply IDs collide with
// chat actor/channel IDs. Within this namespace actorId is the story and
// channelId is the parent comment (zero for a reply to the story itself).
export function createStoryHandwritingDraftRepository(storage: HandwritingDraftStorage = createIndexedDbHandwritingDraftStorage()) {
  return createHandwritingDraftRepository({
    async list() {
      return (await storage.list()).filter((row) => row.key.startsWith(prefix)).map((row) => ({ ...row, actorId: -row.actorId, key: row.key.slice(prefix.length) }));
    },
    put: (row) => storage.put({ ...row, actorId: -row.actorId, key: `${prefix}${row.key}` }),
    delete: (key) => storage.delete(`${prefix}${key}`)
  });
}
