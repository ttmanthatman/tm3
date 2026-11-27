import { z } from "zod";
import { sermonMapSchema, type SermonMap } from "@shared/sermonMap";

const topicSchema = z.object({
  id: z.string(), title: z.string(),
  children: z.record(z.array(z.unknown())).optional(),
  summaries: z.array(z.object({ range: z.string(), topicId: z.string() })).optional()
});
const sheetSchema = z.object({
  rootTopic: z.unknown(),
  relationships: z.array(z.object({ end1Id: z.string(), end2Id: z.string(), title: z.string().optional() })).optional()
});

export function readMapSheet(input: unknown): SermonMap {
  const sheet = sheetSchema.parse(input);
  const nodes: SermonMap["nodes"] = [];
  const ids = new Map<string, number>();
  const conclusions = new Map<number, number>();
  let row = 0;
  function visit(raw: unknown, column: number, branch: number, parents: number[], anchoredRow?: number): number {
    const topic = topicSchema.parse(raw);
    const id = nodes.length;
    if (id >= 300 || ids.has(topic.id)) throw new Error("导图主题重复或超过 300 个要点");
    ids.set(topic.id, id);
    const node = { id, title: topic.title, column, row, branch, parents };
    nodes.push(node);
    const children = (topic.children?.attached ?? []).map((child, index) =>
      visit(child, column + 1, id === 0 ? index + 1 : branch, [id]));
    if (children.length) node.row = (nodes[children[0]].row + nodes[children[children.length - 1]].row) / 2;
    else if (anchoredRow !== undefined) node.row = anchoredRow;
    else row++;
    for (const rawSummary of topic.children?.summary ?? []) {
      const summary = topicSchema.parse(rawSummary);
      const range = topic.summaries?.find(entry => entry.topicId === summary.id)?.range.match(/^\((\d+),(\d+)\)$/);
      const sources = range ? children.slice(Number(range[1]), Number(range[2]) + 1) : children;
      if (!sources.length) throw new Error("概要缺少来源要点");
      const existing = nodes.filter(n => n.row >= nodes[sources[0]].row && n.row <= nodes[sources[sources.length - 1]].row);
      const conclusion = visit(summary, Math.max(column + 1, ...existing.map(n => n.column)) + 1, branch, sources.map(source => conclusions.get(source) ?? source),
        (nodes[sources[0]].row + nodes[sources[sources.length - 1]].row) / 2);
      nodes[conclusion].group = id;
      if (sources.length === children.length) conclusions.set(id, conclusion);
    }
    for (const child of topic.children?.detached ?? []) visit(child, column + 2, branch, []);
    return id;
  }
  visit(sheet.rootTopic, 0, 0, []);
  const links = (sheet.relationships ?? []).map(link => ({
    from: ids.get(link.end1Id), to: ids.get(link.end2Id), label: link.title ?? ""
  })).flatMap(link => link.from === undefined || link.to === undefined ? [] : [{ ...link, from: link.from, to: link.to }]);
  return sermonMapSchema.parse({ nodes, links, focus: 0, overview: false, title: nodes[0].title });
}

export async function importXmind(file: File) {
  if (file.size > 32_000_000) throw new Error("请选择小于 32 MB 的 XMind 文件");
  const { ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entry = (await reader.getEntries()).find(entry => entry.filename === "content.json");
    if (!entry || entry.directory) throw new Error("请用新版 XMind 另存为含 content.json 的 .xmind 文件");
    if (entry.uncompressedSize > 4_000_000) throw new Error("导图内容超过 4 MB");
    const sheets: unknown = JSON.parse(await entry.getData(new TextWriter()));
    if (!Array.isArray(sheets) || !sheets.length) throw new Error("文件中没有画布");
    return sheets.map(readMapSheet);
  } finally { await reader.close(); }
}

export function revealPoint(map: SermonMap, shown: number[], focus: number): SermonMap {
  const ids = new Set(shown);
  function include(id: number) {
    if (ids.has(id)) return;
    ids.add(id);
    const node = map.nodes[id];
    if (node.group !== undefined) include(node.group);
    else node.parents.forEach(include);
  }
  include(focus);
  return { ...map, focus, overview: false, nodes: map.nodes.filter(n => ids.has(n.id)).map(n => {
      const parents = n.parents.filter(id => ids.has(id));
      return { ...n, parents: !parents.length && n.group !== undefined ? [n.group] : parents };
    }),
    links: map.links.filter(link => ids.has(link.from) && ids.has(link.to)) };
}
