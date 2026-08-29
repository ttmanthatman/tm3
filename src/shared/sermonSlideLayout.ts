import type { SermonQueueItemKind, SermonSlideLayoutDTO } from "./types.js";

/** 新幻灯片的排版默认值：经文成段，纯文字同时默认居中。 */
export function defaultSermonSlideLayout(kind: SermonQueueItemKind): SermonSlideLayoutDTO {
  return {
    paragraph: true,
    centered: kind === "text"
  };
}

/** 让旧持久化条目在没有 layout 字段时也获得当前默认排版。 */
export function resolveSermonSlideLayout(item: {
  kind: SermonQueueItemKind;
  layout?: SermonSlideLayoutDTO;
}): SermonSlideLayoutDTO {
  const defaults = defaultSermonSlideLayout(item.kind);
  return {
    paragraph: item.layout?.paragraph ?? defaults.paragraph,
    centered: item.layout?.centered ?? defaults.centered
  };
}
