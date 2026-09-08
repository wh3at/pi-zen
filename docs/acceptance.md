# 初期版の受け入れ確認

2026-09-08、Linux / Node 24.20.0 / pi 0.85.1で確認。`npm view @earendil-works/pi-coding-agent version`も0.85.1を返したため、最低対応版と最新安定版の試験は共通。競合する同名overrideは読み込んでいない。

**受け入れは未完了。** 通常の試験は23成功・1スキップ。スキップは確認済みのreload不具合であり、成功として数えない。

## 起動の隔離

`test/fixtures/isolated-pi.ts`で試験ごとに一時ディレクトリを作る。

- 子プロセスの`cwd`でツールの作業場所を指定する。
- `PI_CODING_AGENT_DIR`で設定・認証・拡張の探索先を隔離する。
- `--session-dir`で会話の保存先を指定する。実保存・再開試験では`--no-session`を使わない。
- `--session <path>`で実際に保存した会話を再開する。
- `settings.json`の`defaultTools`、`terminal.images`、`terminal.showImages`を設定する。
- `--tools`、`--exclude-tools`、`--no-tools`による有効集合も確認する。
- JSON試験は`--no-extensions -e <fixture> [-e <pi-zen>]`で比較対象だけを読み込む。TUIライフサイクル試験では隔離した`settings.json`の`extensions`からpi-zenを読み込む。
- スキル・プロンプト・テーマ・コンテキストファイルの探索を無効にし、`--offline`で起動時通信を止める。
- provider fixtureが固定のツール呼出しを返す。外部LLM・認証を使わず、ツール自体は標準実装を実行する。
- 終了時は起動したPTYを閉じ、一時ディレクトリを削除する。

## 確認したこと

| 試験 | 結果 |
|---|---|
| JSON CLIで全7ツールの成功・失敗を有効／無効比較 | 成功 |
| 引数・schema・description、結果content/details/isError、モデルが受け取るツール結果、保存済みメッセージの比較 | 成功。メッセージのtimestampのみ除外し、引数・結果は除外しない |
| 既存ファイルwrite、editの実ファイル作用、旧形式edit引数 | 成功 |
| 画像readの結果維持、大量readの標準切詰め維持 | 成功 |
| 設定／CLIで指定したツール集合と無効状態の維持 | 成功 |
| 実PTY 40/64/100桁で全7ツールの成功1行・失敗2行、対象・検索条件・コマンド、本文非表示、背景なし | 成功 |
| bash実行中→完了の同一要約更新、実行中／完了後のリサイズ | 成功 |
| 日本語の長いパスの途中省略、長いコマンドの末尾省略 | 成功 |
| edit `+2 -1` / `+1 -0` / `+0 -1`、writeに差分数なし | 成功 |
| 同じbashの並行呼出しで後の呼出しが先に完了しても表示順を維持 | 成功 |
| Escapeによるbash中断、保存済み標準理由`Command aborted`、実行中表示の消去 | 成功 |
| 実保存した成功・失敗・edit差分の再開、展開キーでも本文非表示 | 成功 |
| 画像readのiTerm2プロトコル出力と`showImages`有効／無効、画像保存・再開後リサイズ | 成功。PTY出力のOSC 1337を記録して検証。実端末での画像ピクセル描画は未確認 |
| 待機中の`/reload`後も過去の要約を維持 | **失敗**。下記参照 |

試験本体は`test/cli-acceptance.test.ts`、`test/tui-lifecycle.test.ts`、既存の`test/tui-acceptance.test.ts`。SDK試験は`test/pi-session.test.ts`。

## reloadの既知の不具合

再現コマンド:

```bash
PI_ZEN_CHECK_RELOAD=1 npm test -- test/tui-lifecycle.test.ts -t 'reload後'
```

標準editを実行して`✓ edit source.txt +2 -1`を確認した後、`/reload`すると要約が消え、標準の`edit source.txt`と`-1 before / +1 after / +2 added`が再表示される。CLIの`-e`指定でも設定ファイル経由でも再現した。

pi 0.85.1の`InteractiveMode.handleReloadCommand()`は、`AgentSession.reload()`の`beforeSessionStart`コールバックで過去の行を再構築する。その後に`session_start`が発火する。pi-zenは有効集合と他extensionの所有権を確認するため、このイベントでツールを登録している。過去の行は登録前の標準rendererを保持する。

初期ロード中には`getActiveTools()` / `getAllTools()`を呼べないため、登録だけをfactory直下へ移すと有効集合・所有権確認の前提が崩れる。pi本体の改変やprivate APIへの依存は追加していない。通常実行ではこの回帰試験を明示的にスキップし、環境変数付きで失敗を再現できるよう残した。**pi側の再描画順序の修正など、別途の対応判断が必要。**

## 残る未確認項目

- RPCプロセスでの非干渉比較（JSON CLIと同一視しない）。
- bashの大量出力・中断の有効／無効比較。中断表示自体は実PTYで確認済み。
- 差分の根拠がないedit結果、理由が空の失敗結果。
- テーマ切替の実PTY比較、Kittyなど別画像プロトコル・実画像対応端末での描画。
- `shellPath` / `shellCommandPrefix` / `images.autoResize`など実行設定を変えた比較。

```bash
npm test
npm run typecheck
```

通常試験の成功は、上の未達・未確認項目を含めた全受け入れ条件の合格を意味しない。
