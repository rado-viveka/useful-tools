# Markdown Preview Line Numbers

A small VS Code extension for the built-in Markdown preview. It:

- Shows the source line number next to each block (heading, paragraph, list item, table row, code block).
- Scrolls to a line when you click a link with a line fragment, such as `[PO:163](other-file.md#L163)` or `[see](#L42)`. The target block is highlighted for 2 seconds.

## Install

```bash
./build.sh --install
```

Then run **Developer: Reload Window** in VS Code.

To remove it: `code --uninstall-extension rado.markdown-line-numbers`.

## How it works

The extension has no extension-host code. It only contributes a stylesheet and a script to the Markdown preview (`markdown.previewStyles` and `markdown.previewScripts`).

- **Line numbers.** The preview marks each block with a 0-based `data-line` attribute. The script copies it to `data-ln` as a 1-based number, and the CSS draws it in the left gutter. Containers (tables, lists, quotes) are skipped, because their first child already shows the same number.
- **Line links.** Fragments `#L163`, `#L163,5` and `#L163-L170` are supported. The preview scrolls to the last block that starts at or before the line.
- **Links to other files.** When `*.md` opens in the "Markdown Preview" custom editor, VS Code drops the `#L163` fragment before the new preview loads. To work around this, the preview you click stores the target path and line in `localStorage`. The preview that opens reads it (valid for 15 seconds). Previews of the same kind share an origin, so they share `localStorage`.

## Limits

- One number per block, not per line. A paragraph that spans several source lines shows only its first line.
- In a table, the number sits on the row's first line, even when a cell's text is centered vertically.
- The script logs to the webview console with the prefix `[md-line-numbers]` (**Developer: Open Webview Developer Tools**).
