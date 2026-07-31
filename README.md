# opencode_framework

> OpenCode フレームワークの実装リポジトリ(work-one) — 自走型ソフトウェア開発のための Agent ガバナンス基盤

本リポジトリは、**OpenCode フレームワークの実装とガバナンス**を保持する個人プロジェクトです。
AI Agent が自律的にタスクを遂行するための **Plugin / Skill / Tool / MCP / DB-canonical** の各層を定義し、
GitHub Actions による自動化された開発フローで運用しています。

---

## 📌 このリポジトリは何?

work-one(フレームワークの実装コードネーム)の**実稼働状態**を保持する場所です。
`AGENTS.md` が Agent セッション起動時に自動読み込みする**唯一の権威ある仕様書**で、
設計ブループリント(`blueprints/`、`docs/design/`)とは区別されます。

| 項目 | 実稼働数 / 場所 |
| --- | --- |
| **Agent** | 5(Orchestrator + 4 native: build/general/plan/explore) |
| **Plugin Entrypoint** | 5(before/after/system-dispatcher + session + tool-def-trimmer) |
| **Plugin Handler** | 43 ファイル / active チェーン 20(before 11 / after 7 / system 2) |
| **Tool(カスタム)** | 37(`.opencode/tools/*.ts`) |
| **MCP Server** | 12(`opencode.json` の `mcp` オブジェクト) |
| **Skill** | 18(`.opencode/skills/{name}/SKILL.md` 自動発見) |
| **コードベース** | CodeGraph 421 files、active `.opencode` TS 369 files / 75,218 行(`rg`、遵 gitignore) |
| **データベース** | SQLite 単一データ源 `framework-state.db`(schema v37、49 business / 50 total)、権威パス `.opencode/state/framework-state.db` |

> ℹ️ **設計ブループリント ≠ 実稼働状態**:旧来の「3 層 9 ロール」アーキテクチャ
> (Meta-Planner / Architect / Coder-BE / Coder-FE / Guardian / Arbiter / CI-CD-Agent / Super-Admin / Knowledge-Curator)
> は**設計ブループリント**であり、現在は登録されていません。`blueprints/` ディレクトリに参考として残してあります。

---

## 🏗 ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `.opencode/agents/` | Agent 定義(現在 Orchestrator.md のみ) |
| `.opencode/plugins/` | Plugin Entrypoint(before/after/system-dispatcher 等 5 ファイル) |
| `.opencode/plugin-handlers/` | 43 ファイル(active 20 個の Before/After/System Handler) |
| `.opencode/tools/` | 37 個のカスタム Tool(safe_* 系列 + Read Attestation) |
| `.opencode/skills/` | 18 個の Skill(SKILL.md 自動発見) |
| `.opencode/state/` | SQLite データ + machine 状態ファイル |
| `.opencode/context/` | 設計コンテキスト(詳細設計 / コード規約 / 要件) |
| `.opencode/commands/` | 補助コマンド定義(dispatch / compliance-gate / search-knowledge) |
| `docs/infrastructure/` | フレームワークの深度文書(10 ファイル、~6,000 行) |
| `docs/design/` | 設計仕様(admin UI / customer UI / glassmorphism / interaction patterns) |
| `docs/official_docs/` | OpenCode 公式ドキュメントの mirror |
| `blueprints/` | 旧アーキテクチャの設計ブループリント(参考用) |
| `contracts/` | API 契約定義(contract.yaml 等) |
| `.github/workflows/` | 11 個の GitHub Actions(auto-pr / cascade-close / ci / framework-ci / state-sync 等) |
| `AGENTS.md` / `RULES.md` / `MEMORY.md` | セッション共通ルール |

---

## 🔁 ワークフロー(典型例)

```
1. Agent 起動
   → AGENTS.md / RULES.md / MEMORY.md 自動ロード
   → Orchestrator がデフォルト

2. タスク受信
   → preflight-lite 最小プレチェック(リスク判定)
   → 高リスク時は compliance_gate_check へエスカレーション

3. ツール呼び出し
   → before-dispatcher → Handler Chain(11 段) → Tool 実行
   → after-dispatcher → Handler Chain(7 段) → 結果返却

4. CI / ガバナンス
   → GitHub Actions: ci / framework-ci / auto-pr / state-sync
   → state hash(`keystone`)による整合性検証
```

---

## ⚙️ 技術スタック

- **TypeScript** 6.0+
- **Bun** 1.3.14(パッケージマネージャー兼ランタイム)
- **SQLite**(フレームワーク状態、`schema v37`)
- **MCP(Model Context Protocol)** SDK 1.29+
- **GitHub Actions**(11 workflow)

---

## 🔗 関連リポジトリ

- [qoderwork](https://github.com/Cho-Geer/qoderwork) — 本フレームワークを運用する個人ワークスペース
- [booking_system_refactor](https://github.com/Cho-Geer/booking_system_refactor) — フレームワークの Booking システム reference implementation

---

## ⚠️ 注意事項

- **個人プロジェクト / 実験的**です
- 一部 Windows 環境では `.opencode/.trash-*` の残骸によりテストが失敗します(クリーンクローン推奨)
- 設計ブループリント(`blueprints/`、`docs/design/`)と実稼働状態(本 README + AGENTS.md)は**別物**です
- 商用利用は想定していません

---

## 📄 ライセンス

LICENSE ファイルは含みません。**閲覧のみ**可。再配布・改変は事前連絡 (Issue) を必要とします。

---

## 🇬🇧 English | 🇨🇳 中文

- [English version](./README.en.md)
- [中文版本](./README.zh.md)
