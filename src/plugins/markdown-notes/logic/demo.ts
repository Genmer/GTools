import type { NotesState } from './notes'

// demo 态（initialCommand === 'demo'）固定示例数据：id/时间戳写死保证截图与新手引导稳定，不落盘
const T_MEETING = Date.UTC(2026, 8, 24, 10, 30)
const T_READING = Date.UTC(2026, 8, 23, 21, 12)

export const DEMO_SELECTED_ID = 'demo-note-meeting'

export function demoNotesState(): NotesState {
  return {
    lastNoteId: DEMO_SELECTED_ID,
    seq: 2,
    notes: [
      {
        id: DEMO_SELECTED_ID,
        title: '四期 UI 评审纪要',
        content: `# 四期 UI 评审纪要

9/24 与设计对齐 uTools 视觉复刻范围，结论如下。

## 决议

- [x] 主窗宽度提到 800px，圆角 12px
- [x] 列表行高 46px，hover 才显底色
- [ ] 三主题（light / dark / glass）逐一走查
- [ ] 截图产物归档到 \`.zcode/screenshots/\`

## 遗留问题

> 玻璃主题下 \`--bg\` 为透明，层级只能靠 \`--bg-raised\` 拉开。

| 模块 | 负责人 | 截止 |
| --- | --- | --- |
| shell 空态网格 | 阿珂 | 9/25 |
| markdown-notes | 老周 | 9/25 |

（待补充：玻璃主题的投影参数）
`,
        createdAt: T_MEETING,
        updatedAt: T_MEETING
      },
      {
        id: 'demo-note-reading',
        title: '读书摘录 · 卡片笔记写作法',
        content: `# 读书摘录 · 《卡片笔记写作法》

> 写作不是从零开始，而是把已有的笔记组织起来。

## 三类卡片

1. 闪念笔记：随手记，48 小时内处理掉
2. 文献笔记：用自己的话转述，不摘抄原文
3. 永久笔记：一张卡片只写一个想法

## 行动

- 每天睡前整理当天闪念（约 10 分钟）
- 每周回顾一次永久笔记的连接关系
`,
        createdAt: T_READING,
        updatedAt: T_READING
      }
    ]
  }
}
