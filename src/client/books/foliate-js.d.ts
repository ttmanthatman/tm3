// foliate-js 未附带类型声明；这里只声明本项目用到的最小接口。
declare module "foliate-js/view.js" {
  const View: unknown;
  export default View;
}

declare module "foliate-js/epub.js" {
  export class EPUB {
    constructor(loader: unknown);
    init(): Promise<unknown>;
  }
}

declare module "foliate-js/footnotes.js" {
  export class FootnoteHandler extends EventTarget {
    detectFootnotes: boolean;
    handle(
      book: unknown,
      event: {
        detail: { a: Element; href: string; follow: boolean };
        preventDefault(): void;
      }
    ): Promise<void> | undefined;
  }
}
