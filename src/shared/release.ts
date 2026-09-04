export const APP_VERSION = "1.16.1";

export const RELEASE_DATE = "2026-09-04";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "图书室阅读器修复与增强：EPUB 导入新增封面页兜底识别——spine 第一页若只有一张图（无 cover 声明也认得出），导入即用作封面；正文内的目录/章节链接可以直接点击跳转（此前被点按层挡住）；滚动版式下滚到章末继续滚动可正常翻入下一章；分页/滚动切换不再残留顶栏（切到滚动自动隐藏，滚动时向下隐藏、向上显示，点按中部也可切换）；阅读设置新增「行距」「边距」调节，随账号设备本地保存。"
] as const;
