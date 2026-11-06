# show-image

Shows PNG images inside the Claude Code window, so you can see a graph a tool produced without leaving the conversation.

## Install
At the prompt of a terminal session:

```
/plugin install show-image --marketplace jeffzyliu/claude-show-image
```

From a shell:

```
claude plugin install show-image --marketplace jeffzyliu/claude-show-image
```

Claude Code asks to add the marketplace (answer `y`), then which scope to install under. In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `jeffzyliu/claude-show-image`, then Add plugin.

## What you get
- **Automatically:** any tool result that contains PNG image blocks (a dofile graph, any other MCP server's chart) is drawn under that tool's row, folded or expanded.
- **`/img <path|base64>`:** draws a PNG file (or pasted base64) under the command's output line.
- **`/img --pane <path>`:** opens a pane instead, with zoom and pan. Keys while the pane has focus: `i` zoom in, `o` zoom out, `0` fit, `h` `j` `k` `l` pan, `e` open in the system viewer. The mouse wheel or a two-finger vertical swipe pans up and down.
- **`show_image` tool:** lets the model show you a PNG by path, or up to 5 at once with `paths`.
- **Option `openPane`** (off by default): open the pane for every image.

## Terminal support
The mod hands the engine an image element and the engine paints it with what your terminal supports:

| Terminal | Result |
|---|---|
| Ghostty, kitty | Inline image (kitty graphics protocol) |
| iTerm2 3.5+ | Inline image, only under Claude Code's fullscreen rendering |
| tmux | Works only with `allow-passthrough` and `focus-events` on, inside a terminal above |
| Anything else | Alt text instead of the picture; in the pane, press `e` (or click "open e") to open the file in your system viewer |

The mod cannot detect your terminal; it always sends the picture and the engine decides what to draw. The engine decides from the terminal that *started* the session, not the one you are attached from: a session started in iTerm (or by `claude agents` launched there) and viewed in Ghostty shows alt text. Start the session, or `claude agents`, from the terminal you are looking at, or use the pane's `e` button.

## Limits
PNG only, under 2 MiB each, up to 5 per row. JPEG, GIF, WebP, URLs and file-path results are not drawn. Pinch zoom and sideways swipes are not available: terminals do not send them.
