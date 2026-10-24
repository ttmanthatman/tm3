import { z } from "zod";
import { zoomAnnouncementPayload } from "../../shared/zoom.js";
import { WORLD_EXPLORATION_THROTTLE_MS, type WorldExplorerDTO } from "../../shared/worldExploration.js";

interface Dependencies {
  refreshAuth: () => Promise<{ accountId: number; isGuest?: boolean } | null>;
  loadMessage: (id: number) => Promise<{ channelId: number; type: string; payload: unknown } | null>;
  canAccessChannel: (accountId: number, channelId: number) => Promise<boolean>;
  profile: () => WorldExplorerDTO | undefined;
  connected: () => boolean;
  broadcast: (profile: WorldExplorerDTO) => void;
  now?: () => number;
}

export function createZoomExplorationHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  let lastPublished: number | null = null;
  const schema = z.object({ messageId: z.number().int().positive().max(2_147_483_647) }).strict();
  return async (data: unknown) => {
    const body = schema.safeParse(data);
    if (!body.success || (lastPublished !== null && now() - lastPublished < WORLD_EXPLORATION_THROTTLE_MS)) return;
    lastPublished = now();
    const auth = await deps.refreshAuth();
    if (!auth || auth.isGuest) return;
    const message = await deps.loadMessage(body.data.messageId);
    if (!message || message.type !== "system" || zoomAnnouncementPayload(message.payload)?.status !== "inactive") return;
    if (!await deps.canAccessChannel(auth.accountId, message.channelId)) return;
    const profile = deps.profile();
    if (!deps.connected() || profile?.accountId !== auth.accountId) return;
    deps.broadcast({ accountId: profile.accountId, displayName: profile.displayName });
  };
}
