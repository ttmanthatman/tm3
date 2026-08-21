import fs from "node:fs";
import path from "node:path";

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class RelayProcessLock {
  private held = false;
  private readonly lockDirectory: string;

  constructor(databasePath: string) {
    this.lockDirectory = `${databasePath}.run-lock`;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.lockDirectory), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.mkdirSync(this.lockDirectory);
        fs.writeFileSync(path.join(this.lockDirectory, "pid"), `${process.pid}\n`, { mode: 0o600 });
        this.held = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let pid = Number.NaN;
        try {
          pid = Number(fs.readFileSync(path.join(this.lockDirectory, "pid"), "utf8").trim());
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError;
        }
        if (processIsAlive(pid)) throw new Error(`Another relay process is already running with PID ${pid}`);
        fs.rmSync(this.lockDirectory, { recursive: true, force: true });
      }
    }
    throw new Error("Unable to acquire the relay process lock");
  }

  release() {
    if (!this.held) return;
    fs.rmSync(this.lockDirectory, { recursive: true, force: true });
    this.held = false;
  }
}
