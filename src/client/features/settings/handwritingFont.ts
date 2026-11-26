import { readonly, ref } from "vue";

const FAMILY = "ReadingCommentHandwriting";
const FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const MAX_BYTES = 30 * 1024 * 1024;
const fileName = ref("");
const busy = ref(false);
const error = ref("");
let activeFace: FontFace | null = null;
let initialization: Promise<void> | undefined;

export const handwritingFont = { fileName: readonly(fileName), busy: readonly(busy), error: readonly(error) };

async function storedFont(mode: IDBTransactionMode, file?: File | null): Promise<File | undefined> {
  if (typeof indexedDB === "undefined") throw new Error("当前浏览器不支持本机字体保存");
  // Store bytes instead of an uploaded File's backing handle for WebKit support.
  const record = file ? { name: file.name, bytes: await file.arrayBuffer() } : null;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("team-chat-reading-font", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("font");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本机字体存储，请检查浏览器存储权限"));
  });
  try {
    return await new Promise<File | undefined>((resolve, reject) => {
      const transaction = database.transaction("font", mode);
      const store = transaction.objectStore("font");
      const request = mode === "readonly" ? store.get("handwriting") : record ? store.put(record, "handwriting") : store.delete("handwriting");
      let result: File | undefined;
      request.onsuccess = () => {
        if (mode === "readonly" && request.result) result = new File([request.result.bytes], request.result.name);
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(new Error("字体保存失败，请检查本机存储空间与权限"));
    });
  } finally { database.close(); }
}

async function loadFont(file: File) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error("请选择 TTF、OTF、WOFF 或 WOFF2 字体文件");
  if (!file.size || file.size > MAX_BYTES) throw new Error("字体文件不能为空，大小不能超过 30 MB");
  if (typeof FontFace === "undefined") throw new Error("当前浏览器不支持自定义字体");
  try { return await new FontFace(FAMILY, await file.arrayBuffer()).load(); }
  catch { throw new Error("无法读取这个字体，请选择有效的字体文件；原字体已保留"); }
}

function activateFont(face: FontFace | null, name = "") {
  if (activeFace) document.fonts.delete(activeFace);
  activeFace = face;
  if (face) document.fonts.add(face);
  document.documentElement.style.setProperty("--reading-comment-font", face ? `"${FAMILY}", ${FALLBACK}` : FALLBACK);
  fileName.value = name;
}

export function initializeHandwritingFont(): Promise<void> {
  return initialization ??= (async () => {
    busy.value = true;
    try {
      const file = await storedFont("readonly");
      if (file) activateFont(await loadFont(file), file.name);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "本机手写字体读取失败，请重新上传";
    } finally { busy.value = false; }
  })();
}

export async function setHandwritingFont(file: File | null): Promise<boolean> {
  await initializeHandwritingFont();
  if (busy.value) return false;
  busy.value = true;
  error.value = "";
  try {
    const face = file ? await loadFont(file) : null;
    // Commit storage first so a failed replacement keeps the previous font active.
    await storedFont("readwrite", file);
    activateFont(face, file?.name);
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "字体保存失败，请重试";
    return false;
  } finally { busy.value = false; }
}
