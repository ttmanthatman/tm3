// EPUB 上传时的服务端校验与元数据提取：只读 OPF，不解全书。
// 安全约束：限制压缩包总大小与条目数，识别 Adobe Adept DRM，拒绝路径穿越。
import JSZip from "jszip";

export const BOOK_UPLOAD_MAX_BYTES = 60 * 1024 * 1024;
export const BOOK_UPLOAD_MAX_ENTRIES = 4000;

export class EpubRejectedError extends Error {}

export type EpubMeta = {
  title: string;
  author: string;
  language: string;
  coverEntry: string | null;
};

function textOf(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml);
  return match?.[1]?.trim() ?? "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function safeEntryPath(name: string): boolean {
  if (!name || name.includes("\\")) return false;
  // JSZip 会为目录生成以 / 结尾的条目（如 OEBPS/），末尾空段合法
  const parts = name.split("/");
  if (parts[parts.length - 1] === "") parts.pop();
  if (!parts.length) return false;
  return parts.every((part) => part !== ".." && part !== "" && !part.includes("\0"));
}

function coverHrefFromOpf(opf: string, opfDir: string): string | null {
  // EPUB 3: manifest item with properties="cover-image"
  const itemRe = /<item\b[^>]*>/g;
  for (const item of opf.match(itemRe) ?? []) {
    if (!/properties="[^"]*cover-image[^"]*"/.test(item)) continue;
    const href = /href="([^"]*)"/.exec(item)?.[1];
    if (href) return joinEntryPath(opfDir, decodeXmlEntities(href));
  }
  // EPUB 2: <meta name="cover" content="<item id>"/>
  const meta = /<meta\b[^>]*name="cover"[^>]*>/.exec(opf)?.[0];
  const coverId = meta ? /content="([^"]*)"/.exec(meta)?.[1] : null;
  if (coverId) {
    const item = new RegExp(`<item\\b[^>]*id="${coverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(opf)?.[0];
    const href = item ? /href="([^"]*)"/.exec(item)?.[1] : null;
    if (href) return joinEntryPath(opfDir, decodeXmlEntities(href));
  }
  // 兜底：不少 EPUB（常见于 Calibre 导出）不写 meta/properties 声明，
  // 只有 id 或文件名带 cover 的图片条目（如 id="my-cover-image"）。
  const items = opf.match(/<item\b[^>]*>/g) ?? [];
  const imageItems = items.filter((item) => /media-type="image\//.test(item));
  const byId = imageItems.find((item) => /\bid="[^"]*cover[^"]*"/i.test(item));
  const byIdHref = byId ? /href="([^"]*)"/.exec(byId)?.[1] : null;
  if (byIdHref) return joinEntryPath(opfDir, decodeXmlEntities(byIdHref));
  const byHref = imageItems.find((item) => /href="[^"]*cover[^"]*\.(jpe?g|png|gif|webp)"/i.test(item));
  const byHrefHref = byHref ? /href="([^"]*)"/.exec(byHref)?.[1] : null;
  if (byHrefHref) return joinEntryPath(opfDir, decodeXmlEntities(byHrefHref));
  return null;
}

function joinEntryPath(dir: string, href: string): string {
  const raw = href.split("#", 1)[0].split("?", 1)[0];
  const parts = [...(dir ? dir.split("/") : []), ...raw.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export async function readEpubMeta(buffer: Buffer): Promise<{ meta: EpubMeta; zip: JSZip }> {
  if (buffer.length > BOOK_UPLOAD_MAX_BYTES) throw new EpubRejectedError("图书文件超过 60MB 上限");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new EpubRejectedError("文件不是有效的 EPUB（ZIP 解压失败）");
  }
  const names = Object.keys(zip.files);
  if (names.length > BOOK_UPLOAD_MAX_ENTRIES) throw new EpubRejectedError("压缩包条目过多");
  if (names.some((name) => !safeEntryPath(name))) throw new EpubRejectedError("压缩包包含非法路径");

  const mimetype = await zip.file("mimetype")?.async("string").catch(() => "");
  if (mimetype?.trim() !== "application/epub+zip") throw new EpubRejectedError("缺少 EPUB mimetype 声明");

  const encryption = await zip.file("META-INF/encryption.xml")?.async("string").catch(() => "");
  if (encryption && encryption.includes("http://ns.adobe.com/adept")) {
    throw new EpubRejectedError("检测到 Adobe DRM 加密，无法导入（仅支持无 DRM 的 EPUB）");
  }

  const container = await zip.file("META-INF/container.xml")?.async("string").catch(() => "");
  const rootfile = container ? /full-path="([^"]*)"/.exec(container)?.[1] : null;
  if (!rootfile || !safeEntryPath(rootfile)) throw new EpubRejectedError("EPUB 缺少 OPF 包文件");

  const opf = await zip.file(rootfile)?.async("string").catch(() => "");
  if (!opf) throw new EpubRejectedError("无法读取 OPF 包文件");

  const opfDir = rootfile.split("/").slice(0, -1).join("/");
  const title = decodeXmlEntities(textOf(opf, "dc:title"));
  const author = decodeXmlEntities(textOf(opf, "dc:creator"));
  const language = textOf(opf, "dc:language");
  const coverHref = coverHrefFromOpf(opf, opfDir);
  const coverEntry = coverHref && zip.file(coverHref) ? coverHref : null;

  return {
    meta: {
      title: title || "未命名图书",
      author,
      language,
      coverEntry
    },
    zip
  };
}
