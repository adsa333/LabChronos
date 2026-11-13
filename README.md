# LabChronos

> 实验失败取证台 —— 把失败的截图和日志丢进来，生成一棵可交互的因果故障树；答 2–3 个排查问题剪枝锁定真因，并给出只改一个变量的最小对照实验。

2026 Qoder 高校创造力大赛 · StudyHack 赛道

## 状态

**M0** —— 工程骨架 + 三栏空壳，数据为占位。M1 接入 Mock 病例走通全流程。

## 快速开始

```bash
npm i
npm run dev     # http://localhost:5173
npm run build   # tsc -b && vite build
```

Node ≥ 20。Windows 下若 PowerShell 拦截 npm，改用 `npm.cmd`。

## 技术栈

React 18 · Vite 8 · TypeScript · Tailwind 3.4 · React Flow 11 · Framer Motion 11 · Lucide

## 目录与分工

| 目录 | 负责人 | 内容 |
| --- | --- | --- |
| `src/pages/` `src/components/` `src/styles/` `src/lib/scoring.ts` | A | 三栏工作台、故障树、剪枝动效、概率算法 |
| `src/types/diagnosis.ts` `src/lib/api.ts` `api/` `prompts/` `eval/` | B | 数据契约、大模型接口、Prompt 与评测 |
| `src/data/presets/` `eval/cases/` `docs/` | C | 三个内置病例、证据截图、文档物料 |

跨目录修改前先在群里说一声。分支用 `feat/a-xxx`，合并进 `main` 前必须 `npm run build` 通过。

## 三条设计约束

1. **一次诊断只调一次大模型**：模型一次性返回整棵故障树和每个选项的加减分，此后剪枝、锁定全在前端算，点选零等待，也省 API 额度。
2. **内置病例 0 延迟**：3 个病例的结果先由真实模型跑出、经 C 人工校对后存成静态 JSON，断网也能走完全流程；另保留"实时重新诊断"按钮，证明背后是真实 AI。
3. **密钥只在服务端**：Key 放 Qoder Sites Secrets，前端代码中不出现任何密钥。

## 核心算法

`src/lib/scoring.ts`：`s_h = max(5, prior_h + ΣΔ_h)`，`p_h = s_h / Σs_k`。

- 剪枝：答过至少 1 题且 `p_h < 15%` → 节点变灰、子节点收起
- 锁定：最高 `p_h ≥ 60%` 或题目全部答完，也可手动"直接锁定"
