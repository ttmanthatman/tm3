import { wechatEmojiByToken } from "../composer/wechatEmoji";

// Only decorate text in already-rendered message HTML. Never interpret tokens
// inside URLs, code, or attributes, and only create images from our catalog.
export function renderWechatEmojiHtml(html: string): string {
  if (!html.includes("[")) return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest("a, code, pre, script, style")
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent || "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/\[[^\[\]\s]+\]/g)) {
      const emoji = wechatEmojiByToken.get(match[0]);
      if (!emoji) continue;
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const image = document.createElement("img");
      image.className = "wechat-emoji";
      image.src = emoji.src;
      image.alt = emoji.token;
      image.title = emoji.name;
      image.width = 28;
      image.height = 28;
      image.draggable = false;
      fragment.append(image);
      cursor = match.index + match[0].length;
    }
    if (!cursor) continue;
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  return root.innerHTML;
}
