import type { QueueItem } from "./queue.js";

export interface DeliveryEvidence {
  summary: string;
}
export interface WeChatDriver {
  doctor(): Promise<string[]>;
  send(item: QueueItem): Promise<DeliveryEvidence>;
}

export class DryRunDriver implements WeChatDriver {
  constructor(private readonly write: (line: string) => void = console.log) {}

  async doctor() {
    return ["dry-run driver enabled; WeChat will not be controlled"];
  }

  async send(item: QueueItem) {
    this.write(`[dry-run] source=${item.sourceId}\n${item.formattedText}`);
    return { summary: "dry-run output written" };
  }
}
