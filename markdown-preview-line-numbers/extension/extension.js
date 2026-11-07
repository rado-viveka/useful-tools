// Opens a file at a line from a URI such as
//   vscode://rado.markdown-line-numbers/open?path=/abs/file.md&line=111
// A vscode://file/<path>:<line> link loses the line when *.md opens in the Markdown
// Preview custom editor. This handler opens the text editor at the line first; the
// built-in preview remembers the top line of the last text editor for a file and
// starts there when it opens. Then the text tab it opened is closed again.
// The handler also writes jump.js next to line-numbers.js, so the new preview can
// highlight the target block (see loadHandlerJump in line-numbers.js).
const fs = require('fs');
const vscode = require('vscode');

const PREVIEW = 'vscode.markdown.preview.editor';
let jumpFile = null;

function writeJump(uri, line) {
  if (!jumpFile) return;
  const jump = { path: uri.path, line: line, time: Date.now() };
  try {
    fs.writeFileSync(jumpFile, 'window.__mdLineNumbersJump = ' + JSON.stringify(jump) + ';\n');
  } catch (e) {
    console.error('[md-line-numbers] cannot write ' + jumpFile + ': ' + e.message);
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function tabsFor(uri, matches) {
  const key = uri.toString();
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (matches(tab.input) && tab.input.uri.toString() === key) tabs.push(tab);
    }
  }
  return tabs;
}

function textTabsFor(uri) {
  return tabsFor(uri, function (input) { return input instanceof vscode.TabInputText; });
}

function previewTabsFor(uri) {
  return tabsFor(uri, function (input) {
    return input instanceof vscode.TabInputCustom && input.viewType === PREVIEW;
  });
}

async function open(path, line, column) {
  const uri = vscode.Uri.file(path);
  const pos = new vscode.Position(Math.max(line - 1, 0), Math.max(column - 1, 0));
  const range = new vscode.Range(pos, pos);
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const hadTextTab = textTabsFor(uri).length > 0;

  // The preview applies the start line only when it is created. An open preview of the
  // same file would just be revealed at its old scroll position, so close it first.
  if (isMarkdown) {
    const previews = previewTabsFor(uri);
    if (previews.length) await vscode.window.tabGroups.close(previews, true);
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { selection: range, preview: false });
  if (!isMarkdown) return;

  // The preview takes its start line from the text editor's last visible-range change.
  // If the editor already shows the line at the top, scroll away first to cause one.
  const top = editor.visibleRanges.length ? editor.visibleRanges[0].start.line : -1;
  if (top === pos.line && pos.line > 0) {
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    await sleep(50);
  }
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  await sleep(150);

  writeJump(uri, line);
  await vscode.commands.executeCommand('vscode.openWith', uri, PREVIEW, editor.viewColumn);

  if (!hadTextTab) {
    const extra = textTabsFor(uri).filter(function (t) { return !t.isDirty; });
    if (extra.length) await vscode.window.tabGroups.close(extra, true);
  }
}

function activate(context) {
  jumpFile = vscode.Uri.joinPath(context.extensionUri, 'jump.js').fsPath;
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: async function (uri) {
      if (uri.path !== '/open') return;
      const q = new URLSearchParams(uri.query);
      const path = q.get('path');
      if (!path) {
        vscode.window.showErrorMessage('markdown-line-numbers: the link has no path.');
        return;
      }
      const line = parseInt(q.get('line') || '1', 10) || 1;
      const column = parseInt(q.get('column') || '1', 10) || 1;
      try {
        await open(path, line, column);
      } catch (e) {
        vscode.window.showErrorMessage('markdown-line-numbers: cannot open ' + path + ': ' + e.message);
      }
    }
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
