# ADR-0006 前端技术栈

- 状态：已采纳（2026-10-15）

## 决定
React 19 + TypeScript + Vite；状态管理 zustand；样式用 CSS Modules + 设计 token（CSS 变量）；Markdown 用 react-markdown + remark-gfm；字体用 @fontsource-variable。

## 禁止
- UI 组件库（MUI、Ant Design、Chakra、shadcn/ui 等）和图标库：会把界面拉回"模板感"。
- Tailwind 等原子类方案：设计 token 要集中在 tokens.css 管控，原子类会让裸值散落各处。
- CSS-in-JS 运行时方案。

新增依赖需要在任务单里说明理由，由项目所有者确认。
