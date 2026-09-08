# pi-zen

A pi extension that replaces built-in tool output with short summaries.

- Tools: `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls`
- Format: `status → tool → target → lines added/removed (successful edits only)`
- Tool results reach the model and session storage without being rewritten as summaries.
- **Summarizing bash and read affects execution settings. See [Limitations](#limitations).**

## Installation

```bash
pi install npm:@wh3at_dev/pi-zen
```

Requires pi 0.85.1 or later.

## Limitations

### Settings that are not preserved

Summaries are enabled for all seven tools by default. However, pi-zen recreates the tools without preserving these execution settings:

| Tool | Setting not preserved | Effect |
|---|---|---|
| `bash` | `shellPath` / `shellCommandPrefix` | Commands run without the configured shell or prefix. |
| `read` | `images.autoResize: false` | Images are resized automatically, potentially changing the resolution sent to the model. |

If these settings are unset, behavior matches Pi's defaults for these options. Image resizing does not affect text reads or `terminal.showImages`.

### Preserving your settings

If you use these settings, set the corresponding tool to `false` in the user-wide `~/.pi/agent/pi-zen.json`. This disables its summary and retains Pi's configured execution and display.

Create the default configuration below, then change the values you need:

```bash
(
  set -C
  config_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  mkdir -p "$config_dir" &&
  cat > "$config_dir/pi-zen.json" <<'JSON'
{
  "bash": true,
  "read": true
}
JSON
)
```

- `true` or omitted: enable the summary.
- `false`: disable the summary, not the tool.
- Restart pi or run `/reload` to apply changes.
- If `PI_CODING_AGENT_DIR` is set, its `pi-zen.json` is used. There are no project-level settings.
- Invalid JSON or value types cause an extension load error.

### Past output after /reload

Past tool calls may revert to Pi's standard display after `/reload`. Stored results remain unchanged; new calls use the current configuration.
