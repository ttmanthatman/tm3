import { ref, type Ref } from "vue";
import type { MessageDTO, MusicPlaylistSourceKind, MusicTrackDTO } from "@shared/types";
import { musicMentionPayload, type LinkifyMessageHtml } from "./messageRendering";

interface UseMusicMentionRenderingOptions {
  linkifyMessageHtml: LinkifyMessageHtml;
  musicTracks: Ref<MusicTrackDTO[]>;
  currentMusicTrackId: Ref<number | null>;
  musicPlaying: Ref<boolean>;
  pauseMusic: (immediate?: boolean) => void;
  selectMusicTrack: (track: MusicTrackDTO) => void;
  musicSourceKind: Ref<MusicPlaylistSourceKind>;
  selectedMusicPlaylistId: Ref<number | null>;
  musicPlayerExpanded: Ref<boolean>;
  musicManagerOpen: Ref<boolean>;
}

export function useMusicMentionRendering(options: UseMusicMentionRenderingOptions) {
  const expandedMusicBackgroundMessageIds = ref<Set<number>>(new Set());

  function musicMentionTitle(message: MessageDTO) {
    const payload = musicMentionPayload(message);
    if (!payload) return "歌曲";
    return options.musicTracks.value.find((track) => track.id === payload.musicTrackId)?.title || payload.musicTrackTitle;
  }

  function musicMentionTextHtml(message: MessageDTO) {
    const payload = musicMentionPayload(message);
    const title = musicMentionTitle(message);
    const root = document.createElement("div");
    root.innerHTML = message.content || "";
    const plainText = (root.textContent || "").trim();
    const legacyPlaceholders = new Set([`提及歌曲：${title}`, `提及歌曲：${payload?.musicTrackTitle || title}`]);
    const makeTitle = () => {
      const strong = document.createElement("strong");
      strong.className = "music-mention-title";
      strong.textContent = title;
      return strong;
    };
    if (!plainText || legacyPlaceholders.has(plainText)) {
      root.replaceChildren(makeTitle());
      return root.innerHTML;
    }
    const markers = [...new Set([`@@${payload?.musicTrackTitle || ""}`, `@@${title}`].filter((marker) => marker.length > 2))];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let replaced = false;
    while (walker.nextNode() && !replaced) {
      const node = walker.currentNode as Text;
      const text = node.textContent || "";
      for (const marker of markers) {
        const index = text.indexOf(marker);
        if (index < 0) continue;
        const fragment = document.createDocumentFragment();
        fragment.append(document.createTextNode(text.slice(0, index)), makeTitle(), document.createTextNode(text.slice(index + marker.length)));
        node.replaceWith(fragment);
        replaced = true;
        break;
      }
    }
    if (!replaced) root.prepend(makeTitle(), document.createTextNode(" "));
    return options.linkifyMessageHtml(root.innerHTML);
  }

  function isMentionedMusicPlaying(message: MessageDTO) {
    const payload = musicMentionPayload(message);
    return !!payload && options.currentMusicTrackId.value === payload.musicTrackId && options.musicPlaying.value;
  }

  async function toggleMentionedMusic(message: MessageDTO) {
    const payload = musicMentionPayload(message);
    if (!payload) return;
    const track = options.musicTracks.value.find((item) => item.id === payload.musicTrackId);
    if (!track) {
      alert("这首歌曲已被删除或暂时不可用");
      return;
    }
    if (options.currentMusicTrackId.value === track.id && options.musicPlaying.value) {
      options.pauseMusic(true);
      return;
    }
    options.musicSourceKind.value = "library";
    options.selectedMusicPlaylistId.value = null;
    options.musicPlayerExpanded.value = true;
    options.musicManagerOpen.value = false;
    options.selectMusicTrack(track);
  }

  function musicMentionBackground(message: MessageDTO) {
    const payload = musicMentionPayload(message);
    if (!payload) return "";
    return options.musicTracks.value.find((track) => track.id === payload.musicTrackId)?.background?.trim() || "";
  }

  function isMusicMentionBackgroundExpanded(message: MessageDTO) {
    return expandedMusicBackgroundMessageIds.value.has(message.id);
  }

  function toggleMusicMentionBackground(message: MessageDTO) {
    const next = new Set(expandedMusicBackgroundMessageIds.value);
    if (next.has(message.id)) next.delete(message.id);
    else next.add(message.id);
    expandedMusicBackgroundMessageIds.value = next;
  }

  return {
    expandedMusicBackgroundMessageIds,
    musicMentionTitle,
    musicMentionTextHtml,
    isMentionedMusicPlaying,
    toggleMentionedMusic,
    musicMentionBackground,
    isMusicMentionBackgroundExpanded,
    toggleMusicMentionBackground
  };
}
