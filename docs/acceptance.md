# 初期版の受け入れ確認

2026-09-08、Linux / Node 24.20.0 / pi 0.85.1で確認。`npm view @earendil-works/pi-coding-agent version`も0.85.1を返したため、最低対応版と最新安定版の試験は共通。競合する同名overrideは読み込んでいない。

設定保持の修正後は、要約対象を`write` / `edit` / `grep` / `find` / `ls`の5ツールに限定する。`bash` / `read`は実行・表示とも標準のまま残す。下記の未確認項目は残っており、全受け入れ条件の確認完了とは扱わない。

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
| 実PTY 40/64/100桁で対象5ツールの成功1行・失敗2行、対象・検索条件、本文非表示、背景なし | 成功 |
| bashの標準表示・出力、実行中／完了後のリサイズ | 成功 |
| 日本語の長いパスの途中省略 | 成功 |
| edit `+2 -1` / `+1 -0` / `+0 -1`、writeに差分数なし | 成功 |
| 同じbashの並行呼出しで後の呼出しが先に完了しても表示順を維持 | 成功 |
| Escapeによるbash中断、保存済み標準理由`Command aborted`、実行中表示の消去 | 成功 |
| 実保存した成功・失敗・edit差分の再開、展開キーでも本文非表示 | 成功 |
| 画像readのiTerm2プロトコル出力と`showImages`有効／無効、画像保存・再開後リサイズ | 成功。PTY出力のOSC 1337を記録して検証。実端末での画像ピクセル描画は未確認 |
| 待機中の`/reload`で保存内容を変えず、その後の呼出しに要約を使用 | 成功。過去の行が標準表示へ戻ることは許容 |
| SDKのメモリ上で指定した`shellPath` / `shellCommandPrefix`の保持 | 成功。専用シェルとprefixによる環境変数がコマンドに届くことを検証 |
| `images.autoResize: false`設定時のread実行処理の保持 | 成功。拡張登録前後で設定済みツール定義の同一性を検証（画像変換結果の比較ではない） |

試験本体は`test/cli-acceptance.test.ts`、`test/tui-lifecycle.test.ts`、`test/tui-acceptance.test.ts`。SDK試験は`test/pi-session.test.ts`と`test/configured-tools.test.ts`。アニメーション試験は`test/animation.test.ts`。

## reloadの許容動作

2026-09-08のユーザー合意により、`/reload`後に過去のツール行が標準表示へ戻ることは正常な許容動作とし、修正対象・受け入れ阻害要因から外した。対象5ツールでは、通常時の本文非表示、セッション再開時の要約表示、reload後の新しい呼出しの要約表示を維持する。`bash` / `read`は常に標準表示とする。

pi 0.85.1はreload時に過去の行を再構築してから`session_start`を発火する。pi-zenはこのイベントでツールを登録するため、過去の行は標準rendererを保持する。ツールの再実行や保存内容の変更ではない。

旧条件のスキップ試験は廃止し、保存内容・ファイル作用が変わらず、その後の新しい呼出しが要約表示になることを通常のPTY試験で確認する。

```bash
npm test -- test/tui-lifecycle.test.ts -t 'reload'
```

## 残る未確認項目

- RPCプロセスでの非干渉比較（JSON CLIと同一視しない）。
- bashの大量出力・中断の有効／無効比較。中断表示自体は実PTYで確認済み。
- 差分の根拠がないedit結果、理由が空の失敗結果。
- テーマ切替の実PTY比較、Kittyなど別画像プロトコル・実画像対応端末での描画。
- `images.autoResize`を変えた画像変換結果の比較。設定済みread定義を置き換えないことはSDK試験で確認済み。

```bash
npm test
npm run typecheck
```

通常試験の成功は、上の未確認項目を含めた全受け入れ条件の合格を意味しない。
