import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function deduplicateStoredUpload(input: {
  directory: string;
  candidatePath: string;
  contentHash?: string;
  preferredFileNames?: Iterable<string>;
}) {
  const candidateName = path.basename(input.candidatePath);
  const candidateStat = await fs.promises.stat(input.candidatePath);
  const candidateHash = await sha256File(input.candidatePath);
  const contentHash = input.contentHash || candidateHash;
  const preferred = new Set([...(input.preferredFileNames || [])].map((name) => path.basename(name)));
  const entries = (await fs.promises.readdir(input.directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== candidateName)
    .sort((left, right) => Number(preferred.has(right.name)) - Number(preferred.has(left.name)) || left.name.localeCompare(right.name));

  const findExactDuplicate = async (candidates: fs.Dirent[]) => {
    for (const entry of candidates) {
      const existingPath = path.join(input.directory, entry.name);
      const existingStat = await fs.promises.stat(existingPath);
      if (existingStat.size !== candidateStat.size) continue;
      if ((await sha256File(existingPath)) !== candidateHash) continue;
      return { entry, existingStat };
    }
    return null;
  };
  const preferredDuplicate = await findExactDuplicate(entries.filter((entry) => preferred.has(entry.name)));
  if (preferredDuplicate) {
    await fs.promises.unlink(input.candidatePath);
    return { duplicate: true, storedFileName: preferredDuplicate.entry.name, size: preferredDuplicate.existingStat.size, hash: contentHash };
  }

  const contentAddressed = entries.find((entry) => entry.name.startsWith(`${contentHash}.`));
  if (contentAddressed) {
    const existingStat = await fs.promises.stat(path.join(input.directory, contentAddressed.name));
    await fs.promises.unlink(input.candidatePath);
    return { duplicate: true, storedFileName: contentAddressed.name, size: existingStat.size, hash: contentHash };
  }

  const exactDuplicate = await findExactDuplicate(entries.filter((entry) => !preferred.has(entry.name)));
  if (exactDuplicate) {
    await fs.promises.unlink(input.candidatePath);
    return { duplicate: true, storedFileName: exactDuplicate.entry.name, size: exactDuplicate.existingStat.size, hash: contentHash };
  }

  const extension = path.extname(candidateName).toLowerCase() || ".bin";
  const storedFileName = `${contentHash}${extension}`;
  const storedPath = path.join(input.directory, storedFileName);
  try {
    await fs.promises.link(input.candidatePath, storedPath);
    await fs.promises.unlink(input.candidatePath);
    return { duplicate: false, storedFileName, size: candidateStat.size, hash: contentHash };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const storedStat = await fs.promises.stat(storedPath);
    if (input.contentHash) {
      if (!path.basename(storedPath).startsWith(`${contentHash}.`)) throw error;
    } else if (storedStat.size !== candidateStat.size || (await sha256File(storedPath)) !== candidateHash) throw error;
    await fs.promises.unlink(input.candidatePath);
    return { duplicate: true, storedFileName, size: storedStat.size, hash: contentHash };
  }
}
