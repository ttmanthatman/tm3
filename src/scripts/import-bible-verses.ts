import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// eBible VPL SQL → 阅读器经文 JSON。
// 用法: npm run bible:import-verses -- <cmncbs_vpl.zip> [output.json]
// 元数据（显示名/版权行）按译本登记在 TRANSLATIONS；新增译本时补充条目并核对 zip 校验和。
type TranslationMeta = {
  id: string;
  name: string;
  displayName: string;
  copyright?: string;
  sourceUrl: string;
  sourceFile: string;
  sha256: string;
  defaultOutput: string;
};

const TRANSLATIONS: Record<string, TranslationMeta> = {
  cmncbs: {
    id: "cmncbs",
    name: "Biblica® Open Chinese Contemporary Bible (Simplified)",
    displayName: "当代译本（简体）",
    copyright: "Biblica® 圣经当代译本™开放资源 © 1979, 2005, 2007, 2011, 2022 Biblica, Inc. · 以 CC BY-SA 4.0 授权",
    sourceUrl: "https://ebible.org/Scriptures/cmncbs_vpl.zip",
    sourceFile: "cmncbs_vpl.sql",
    sha256: "84281d645d7b2e57cb1ed099fc2a1f3dbb1b08f0079398594a2f24898fc394ac",
    defaultOutput: "src/server/bible/cmncbs.json"
  }
};

const input = process.argv[2];
if (!input) throw new Error("usage: npm run bible:import-verses -- <cmncbs_vpl.zip> [output.json]");
const archivePath = path.resolve(input);
const id = path.basename(input).match(/^([a-z0-9-]+)_vpl\.zip$/i)?.[1]?.toLowerCase() || "";
const meta = TRANSLATIONS[id];
if (!meta) throw new Error(`unknown VPL translation id: ${id || input}`);

const archive = fs.readFileSync(archivePath);
const checksum = createHash("sha256").update(archive).digest("hex");
if (checksum !== meta.sha256) {
  throw new Error(`unexpected VPL archive checksum: ${checksum} (expected ${meta.sha256})`);
}

const sql = execFileSync("unzip", ["-p", archivePath, meta.sourceFile], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024
}).replace(/^﻿/, "");

type Verse = { book: string; chapter: number; verse: number; endVerse: number; text: string; order: number };

const versePattern = /^INSERT INTO \w+ VALUES \("[^"]*","(\d+)_\d+_\d+","([A-Z1-9]{3})","(\d+)","(\d+)","(\d+)","(.*)"\);?\s*$/;
const verses: Verse[] = [];
const failures: string[] = [];
for (const line of sql.split("\n")) {
  if (!line.startsWith("INSERT INTO")) continue;
  const match = line.match(versePattern);
  if (!match) {
    failures.push(line.slice(0, 120));
    continue;
  }
  const text = match[6].trim();
  if (!text) {
    failures.push(`empty verse text: ${line.slice(0, 120)}`);
    continue;
  }
  verses.push({
    book: match[2],
    chapter: Number(match[3]),
    verse: Number(match[4]),
    endVerse: Number(match[5]),
    text,
    order: Number(match[1])
  });
}
if (failures.length) throw new Error(`VPL parse failed on ${failures.length} lines:\n${failures.slice(0, 10).join("\n")}`);
if (verses.length < 30000) throw new Error(`suspiciously low verse count: ${verses.length}`);

const result = {
  id: meta.id,
  name: meta.name,
  displayName: meta.displayName,
  ...(meta.copyright ? { copyright: meta.copyright } : {}),
  source: {
    url: meta.sourceUrl,
    format: "eBible VPL SQL",
    sourceFile: meta.sourceFile,
    sha256: meta.sha256
  },
  generatedAt: new Date().toISOString(),
  verses
};

const output = path.resolve(process.argv[3] || meta.defaultOutput);
fs.writeFileSync(output, `${JSON.stringify(result)}\n`);
console.log(`wrote ${verses.length} verses to ${output}`);
