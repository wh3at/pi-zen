# pi のツール表示を最小化できる範囲（調査ノート）

- 対象: [「piの拡張APIでツール表示をどこまで置き換えられるか」](https://github.com/wh3at/pi-zen/issues/2)
- 前提となる地図: [「piのツール表示をミニマルにする道筋」](https://github.com/wh3at/pi-zen/issues/1)
- 調査対象: `@earendil-works/pi-coding-agent` **0.85.1**（インストール済み npm パッケージ）
- 調査日: 2026-06-23
- 結論の短縮版: **自分が登録するツール、または同名で実装ごと置換してよい標準ツールなら、公開 API の `renderCall` / `renderResult` で一行表示にできる。一方、既に別 extension（MCP を含む）が登録した任意のツールの renderer だけを後付けで横断的に差し替える公開 API は 0.85.1 にはない。**

## 結論

目標の見た目自体（一ツール一行、失敗は短い理由、詳細展開なし）は custom tool renderer で表現できる。`renderCall` と `renderResult` は部分引数、実行開始、partial result、完了、`isError` を受ける同じ行の表示経路に使われるため、各状態を一行へ正規化できる。renderer は表示専用で、返された `content` / `details` を書き換えない。

ただし公開 API の境界は「**tool definition の所有者が renderer を付ける**」である。任意ツール名に対する global renderer、登録済み definition の取得、renderer middleware、transcript component factory の差し替えは文書化 API にない。`getAllTools()` で分かるのは名前・説明・schema・guideline・出自だけで、実行関数や renderer は得られない。そのため、独立した一つの表示 extension が MCP/他 extension の全ツールを、実行やモデル向け結果を保ったまま自動的に包むことは **公開 API だけでは不可**である。

## Capability matrix

| 対象 / 経路 | 一行表示 | 実行・モデル結果・保存内容を不変にする | 判定 |
|---|---:|---:|---|
| 自 extension が登録する custom tool（MCP bridge 自体もこちらで所有） | 可。`renderCall` / `renderResult` を定義 | 可。renderer の返り値は TUI `Component` のみ | **公開 API で可** |
| 標準 `read/bash/edit/write/grep/find/ls` の表示だけを同名登録で変更 | renderer 自体は可 | **不可**。同名登録は renderer decorator ではなく tool definition / execution の override。標準実装と厳密に同じ実行を再提供する必要がある | **見た目は可、表示だけの安全な置換ではない** |
| 他 extension が登録する既知 custom tool | 所有 extension が renderer を付けるなら可 | 可 | **協調実装で可** |
| MCP/他 extension が登録する未知・動的 tool を別 extension から共通表示 | generic fallback は pi が行うが、要求する一行形式へ横断上書きする hook はない | 後付け wrapper に必要な definition/execute 取得 API もない | **公開 API では不可** |
| renderer のない custom tool | call は名前、result は通常最大10行 preview | 結果は不変 | **既定 fallback は要求を満たさない** |
| streaming 中の tool | `renderCall` は partial args 更新ごと、`renderResult` は partial result ごとに再描画可能 | 可 | **所有 renderer なら可** |
| tool failure | `context.isError` と error 背景、result text を renderer で短縮可能 | 元 result は保持される | **所有 renderer なら可** |
| assistant stream 自体の失敗で pending tool が失敗扱いになる経路 | tool component に短い agent error が渡る | 可 | **所有 renderer なら可** |
| Ctrl+O / `setToolsExpanded(false)` | collapsed にできる | 可 | **不十分**。fallback は collapsed でも10行、built-in 表示も tool 固有 |
| JSON / print / RPC | custom TUI renderer の対象外 | イベント/結果はそのまま | **今回の TUI 会話表示だけに限定** |
| HTML export / session restore | definition の renderer を export/復元時にも参照する実装はある | session の toolResult は原文 | **同じ extension 構成なら概ね可**。無効化・欠落時は fallback となるため継続検証が必要 |

## 根拠

### 1. 公開 renderer API の能力

公式 Extensions 文書は custom tool に `renderCall(args, theme, context)` と `renderResult(result, options, theme, context)` を定義できるとし、未定義または例外時は call=tool 名、result=`content` の raw text fallback と明記する。また context には `executionStarted`, `argsComplete`, `isPartial`, `expanded`, `isError` がある。partial progress は `execute` の `onUpdate` で送れる。失敗は `execute` から throw すると `isError: true` でモデルにも報告される。

- [公式 Extensions: Custom Rendering](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#custom-rendering)
- [公式 Extensions: Tool Definition / errors](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#tool-definition)
- [公式 TUI: renderCall/renderResult の theme と component](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/tui.md#theming)
- [公式例 `todo.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/todo.ts) は call/result を別表示し、error と expanded を扱う。

インストール済み実装では `ToolExecutionComponent` が partial args の `updateArgs()`、開始の `markExecutionStarted()`、partial/final の `updateResult()` のたびに同じ renderer を再実行する。renderer context は上記状態をそのまま構築する（`dist/modes/interactive/components/tool-execution.js` 45–103, 158–233）。interactive mode は assistant の toolCall stream、`tool_execution_start/update/end` をそれぞれ component へ配送する（`dist/modes/interactive/interactive-mode.js` 2624–2723）。

### 2. 表示と tool result は分離している

`renderCall` / `renderResult` の返り値は TUI `Component` であり、実装は result の `content` / `details` を renderer に渡して component を chat container に置くだけである（`tool-execution.js` 185–224）。一方、結果を実際に変える公開 hook は別の `tool_result` event であり、`content`, `details`, `isError`, `usage` の patch を返す API である。したがって表示だけを変える用途で `tool_result` は使わない。

- [公式 Extensions: `tool_result` は result を変更する](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#tool_result)
- [公式 Extensions: custom renderer](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#custom-rendering)
- session 保存について、README は会話を JSONL に保存すると説明し、公式例は tool result の `details` から再開時の状態を復元する。[README: Sessions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/README.md#sessions)、[`todo.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/todo.ts)

この分離から、renderer のみを変えた場合、モデルへ返す `content`、tool state 用 `details`、session の toolResult は不変である。ただし後述の「同名 override」は renderer だけの操作ではない。

### 3. 標準 tool の override は execution も置換する

公式文書は同名 `registerTool` が built-in を override すると明記し、実装は built-in definitions を map に入れた後で extension definitions を同じ name に `set` する（`dist/core/agent-session.js` 2104–2161）。標準 renderer は slot 単位で継承されるだけで、逆方向（標準 execution を継承し custom renderer だけ付加）の API ではない（`dist/core/tools/renderers/index.js` 25–48）。公式例も `read` の schema と execute を再実装している。

- [公式 Extensions: Overriding Built-in Tools](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#overriding-built-in-tools)
- [公式例 `tool-override.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/tool-override.ts)

従って「標準実装を変えず表示だけ差し替える」は、この public API 形状では直接できない。標準 tool factory を使って同等 execution を委譲する設計は可能性があるが、それでも同名 definition の再登録であり、version ごとの schema/result 契約、標準 prompt metadata、将来変更への追随が必要になる。初期調査では実装・prototype はしていないため、完全同値性は未検証である。

### 4. 他 extension / MCP tool への横断適用ができない理由

`registerTool` はその extension 自身の tool map に definition を保存する（`dist/core/extensions/loader.js` 231–245）。複数 extension では **load order の最初の同名登録が勝つ**（`dist/core/extensions/runner.js` 328–348）。最終 registry は built-in に extension tools、さらに SDK custom toolsを上書きする（`agent-session.js` 2104–2161）。公開 `getAllTools()` が返すのは `name`, `description`, `parameters`, `promptGuidelines`, `sourceInfo` のみ（`agent-session.js` 638–651、公式 docs）で、元の `execute`, `renderCall`, `renderResult` は取得できない。

- [公式 Extensions: `getAllTools()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#pigetactivetools--pigetalltools--pisetactivetoolsnames)
- Pi 本体には MCP は組み込まれず extension が追加する方針である。[README: Philosophy / No MCP](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/README.md#philosophy)

よって MCP も特別経路ではなく、その MCP bridge extension が `registerTool` した custom tool として扱われる。その bridge の tool definition に generic renderer を付けるなら実現できるが、**別の表示 extension が後からすべての追加 tool を decorate することはできない**。同名再登録は元 execute を取得できず、順序によってはそもそも負ける。これは設定上の工夫では解消しない。

### 5. fallback と設定だけでは一行にならない

renderer definition がない tool の generic 表示は args の pretty JSON と output 全文である。definition はあるが slot renderer がない場合、call は tool 名、result は collapsed でも先頭10行と残数を表示する（`tool-execution.js` 64–84, 235–246）。Ctrl+O と `ctx.ui.setToolsExpanded()` は expanded boolean を全 tool component に渡すだけで renderer 自体は置換しない（`interactive-mode.js` 3458–3478、[README: Keyboard Shortcuts](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/README.md#keyboard-shortcuts)）。settings の `defaultTools` は有効 tool 選択であり表示設定ではない（[公式 Settings: Tools](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/settings.md#tools)）。

### 6. TUI 外と復元

公式 mode 表では custom terminal rendering は interactive TUI の能力で、JSON は event stream、print は UI なし、RPC の `custom()` は undefined である。[公式 Extensions: Mode Behavior](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#mode-behavior)。今回の「会話内一行」は TUI transcript に限定して記述すべきで、機械向け JSON/RPC event 自体を短縮すべきではない。

interactive の初期メッセージ復元も現在の tool definition から `ToolExecutionComponent` を作り、保存された toolResult を渡す（`interactive-mode.js` 3008–3057）。HTML export も definition の `renderCall` / `renderResult` を参照する（`dist/core/export-html/tool-renderer.js` 58–87）。ただし session を再開した時に対象 extension/MCP bridge が無効・改名・load order 変更なら current definition が変わり fallback になり得る。長時間・再開時の一貫性は受け入れ試験に含めるべきである。

## 実装計画へ渡す制約

1. **安全に public API 内で完結する最小単位は tool-owner 側 renderer**。MCP bridge を製品側で所有するなら、発見した全 MCP tool に同じ generic `renderCall` / `renderResult` を付けられる。
2. **標準 tool は別問題**。表示 extension から標準 execution を透明に decorate する API はない。同名 override で tool 自体を再提供するか、pi 本体に renderer registry/decorator API が追加されるのを待つか、内部 API/patch に依存する必要がある。
3. **第三者 extension は協調が必要**。renderer を既に持つ tool も強制上書きする global policy hook はない。generic 表示への opt-in contract、対応 bridge の限定、または pi upstream API 提案のいずれかになる。
4. renderer は `isPartial` / `isError` を必ず扱い、引数が未完成でも throw せず、常に terminal width 以下の一行を返す。失敗理由は表示用に一行へ sanitize/truncate するが、`tool_result` は変更しない。
5. image result は renderer text と別に `ToolExecutionComponent` が画像 component を追加する（`tool-execution.js` 225–283）。「全 tool 表示を一行」に画像も含めるなら、現在の renderer だけでは画像を抑止できず、`showImages` 設定または内部変更が必要。この点は要判断。
6. tool label ではなく name は必ず取得できる。generic summary に安全に使える共通情報は name、args、text content、`isPartial`、`isError` までで、任意 `details` の構造は tool 固有。追加 tool の bespoke design をしない方針なら、成功理由を details から推測せず、安定した generic 文言にする。

## 人間の判断が必要な問い

技術調査では決めない。実装計画確定前に以下を選ぶ必要がある。

1. **全追加 tool 必須という要件をどう満たすか**: (a) 対応 MCP bridge/tool owner に generic renderer を組み込む、(b) 第三者 extension は「協調するもののみ」と明示する、(c) pi upstream に global renderer decorator API を提案し待つ、(d) 0.85.1 内部実装への依存を受け入れる。
2. **標準 tool**: 同名 override で execution 契約を複製する保守リスクを受け入れるか、upstream API を前提にするか。
3. **既存専用 renderer との優先順位**: 第三者の renderer を尊重するか、可能な範囲では minimal policy を優先するか。現 API では後者を一般化できない。
4. **画像 result**: 一行要約に加えて画像表示を残すか、画像も非表示にするか。
5. **対象 surface**: interactive transcript のみでよいか、HTML export にも同一表示を保証するか。JSON/RPC/モデル結果は原文維持を推奨する。

## 未検証・限界

- prototype と製品実装は行っていない。renderer が terminal resize、並列 tool、abort、再開、extension reload、MCP の動的登録で一行を保つ実動作確認は後続課題。
- インストール済み 0.85.1 の公開 docs と配布 JS を基準にした。公開リンクは upstream `main` であり将来行番号・内容が変わり得るため、実装時は 0.85.1 を固定して再確認すること。
- ローカルの credential や private MCP 設定は調査・記載していない。Pi 自体には built-in MCP がなく、具体的な第三者 bridge の振る舞いは bridge ごとの確認が必要。
- `tool_result` を使った表示目的の短縮はモデル結果/session を変えるため、要件不適合として検討対象から除外した。
