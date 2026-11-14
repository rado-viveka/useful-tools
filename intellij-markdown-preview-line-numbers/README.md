# Markdown Preview Line Numbers for IntelliJ IDEA

A small IntelliJ IDEA plugin for the built-in Markdown preview. It:

- Shows the source line number next to each block (heading, paragraph, list item, table row, code block). The numbers follow the text as you edit.
- Opens a file at a line when you click a link with a line fragment, such as `[Menu:34](menu.md#L34)` or `[see](#L42)`. In a Markdown target, the preview scrolls to the block and highlights it until the next jump. Other files open in the editor at the line.

This is the IntelliJ IDEA version of the [VS Code extension](../markdown-preview-line-numbers/). It has no handler for links from outside the IDE.

## Install

```bash
./build.sh --install
```

Then restart IntelliJ IDEA. The IDE shows a "Cannot update plugin" notice, because the plugin does not come from a plugin repository. You can ignore it.

To remove it: delete the `markdown-line-numbers` folder from the IDE's plugins folder (`~/.local/share/JetBrains/IntelliJIdea<version>/`), or uninstall it in **Settings | Plugins**.

`build.sh` needs no Gradle. It compiles the one Java class with `javac` against the jars of the installed IDE. Set `IDEA_HOME` if the IDE is not installed by JetBrains Toolbox, and `IDEA_PLUGINS` if the plugins folder is not found.

## How it works

The plugin registers a `browserPreviewExtensionProvider` of the bundled Markdown plugin. It adds one script and one stylesheet to the preview.

- **Offsets to lines.** The preview marks each element with its source offsets (`md-src-pos="15..65"`), not its line. The script asks the IDE for the offsets at which the lines start (message `mdLineNumbers/request`). `LineNumbersExtension` reads them from the document and answers (`mdLineNumbers/lineStarts`). The script asks again after each change of the preview content.
- **Which element gets the number.** Each block element with a source position is a candidate. A container (list, quote, table) starts on the same line as its first child, so only the innermost block shows the number. Table cells are skipped; the row carries the number.
- **Drawing.** The script sets `data-ln` on the block, and the CSS draws it in the left gutter.
- **Line links.** Fragments `#L163`, `#L163,5`, `#L163:5` and `#L163-L170` are supported. The script catches the click before the preview's own link handler. A link without a path (`#L42`) scrolls the same preview to the last block that starts at or before the line. Web links and anchors of real headings stay with the preview's own handler.
- **Links to other files.** The script sends the link to the IDE (message `mdLineNumbers/open`). `LineNumbersExtension` resolves the path against the folder of the current file (absolute paths and `file:` URLs also work) and opens the file at the line. For a Markdown target, it then sends the line to the preview of that file (message `mdLineNumbers/jump`). A preview that is not loaded yet gets the jump with its first line starts, if the jump is under 15 seconds old. A missing file shows a "Cannot open the link" notification.

## Limits

- Tested with IntelliJ IDEA 2026.3 (build 263) only. The extension point of the Markdown plugin is not a stable API, so a new IDE version can break the plugin. Build the plugin against the IDE version you use.
- One number per block, not per line. A paragraph or a code block that spans several source lines shows only its first line.
- A horizontal rule (`---`) has no number, because the preview gives it no source position.
- It works in the default (JCEF) preview only.
- The script logs to the preview's console with the prefix `[md-line-numbers]`.
