package rado.mdlinenumbers;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.notification.Notification;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;
import org.intellij.plugins.markdown.extensions.MarkdownBrowserPreviewExtension;
import org.intellij.plugins.markdown.ui.preview.BrowserPipe;
import org.intellij.plugins.markdown.ui.preview.MarkdownHtmlPanel;
import org.intellij.plugins.markdown.ui.preview.ResourceProvider;

/**
 * Adds a script and a stylesheet to the Markdown preview. The preview marks each element
 * with its source offsets, not its line. The script asks for the offsets at which the
 * lines start, and this class answers from the document.
 *
 * <p>It also opens the target of a link with a line fragment (file.md#L34). The script
 * sends the link; this class opens the file at the line and tells the preview of that
 * file which line to scroll to and highlight.
 */
public final class LineNumbersExtension implements MarkdownBrowserPreviewExtension, ResourceProvider {
  private static final String REQUEST = "mdLineNumbers/request";
  private static final String LINE_STARTS = "mdLineNumbers/lineStarts";
  private static final String OPEN = "mdLineNumbers/open";
  private static final String JUMP = "mdLineNumbers/jump";
  private static final String NOTIFICATIONS = "Markdown Preview Line Numbers";
  private static final long JUMP_MAX_AGE_MS = 15000;
  private static final String SCRIPT = "md-line-numbers.js";
  private static final String STYLE = "md-line-numbers.css";

  private final MarkdownHtmlPanel panel;
  private final BrowserPipe pipe;
  private final BrowserPipe.Handler handler = this::sendLineStarts;
  private final BrowserPipe.Handler openHandler = this::openLink;

  /** The extensions of the open previews. */
  private static final Set<LineNumbersExtension> LIVE =
      Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<>()));
  /**
   * File path -> {line, time} of the last jump into a Markdown file. A preview that is
   * not loaded yet gets the jump with its first line starts. The time is the jump's ID:
   * the script ignores a jump it already did.
   */
  private static final Map<String, long[]> JUMPS = new ConcurrentHashMap<>();

  private LineNumbersExtension(MarkdownHtmlPanel panel, BrowserPipe pipe) {
    this.panel = panel;
    this.pipe = pipe;
    pipe.subscribe(REQUEST, handler);
    pipe.subscribe(OPEN, openHandler);
    LIVE.add(this);
  }

  private boolean sendLineStarts(String ignored) {
    VirtualFile file = panel.getVirtualFile();
    if (file == null) return false;
    String starts = ReadAction.computeBlocking(() -> {
      Document doc = FileDocumentManager.getInstance().getDocument(file);
      if (doc == null) return null;
      StringBuilder sb = new StringBuilder("[");
      for (int i = 0; i < doc.getLineCount(); i++) {
        if (i > 0) sb.append(',');
        sb.append(doc.getLineStartOffset(i));
      }
      return sb.append(']').toString();
    });
    if (starts != null) pipe.send(LINE_STARTS, starts);
    sendJump(file);
    return false;
  }

  private void sendJump(VirtualFile file) {
    long[] jump = JUMPS.get(file.getPath());
    if (jump == null) return;
    if (System.currentTimeMillis() - jump[1] > JUMP_MAX_AGE_MS) {
      JUMPS.remove(file.getPath());
      return;
    }
    pipe.send(JUMP, jump[0] + ":" + jump[1]);
  }

  /** Message from the script: {"path": link without the fragment, "line": n, "column": n}. */
  private boolean openLink(String data) {
    VirtualFile source = panel.getVirtualFile();
    Project project = panel.getProject();
    if (source == null || project == null) return false;
    String path;
    int line;
    int column;
    try {
      JsonObject link = JsonParser.parseString(data).getAsJsonObject();
      path = link.get("path").getAsString();
      line = Math.max(link.get("line").getAsInt(), 1);
      column = link.has("column") ? Math.max(link.get("column").getAsInt(), 1) : 1;
    } catch (RuntimeException e) {
      return false;
    }
    ApplicationManager.getApplication().invokeLater(() -> {
      if (!project.isDisposed()) open(project, source, path, line, column);
    });
    return false;
  }

  private static void open(Project project, VirtualFile source, String path, int line, int column) {
    VirtualFile target = resolve(source, path);
    if (target == null || target.isDirectory()) {
      new Notification(NOTIFICATIONS, "Cannot open the link", "File not found: " + path, NotificationType.WARNING)
          .notify(project);
      return;
    }
    String ext = target.getExtension();
    boolean markdown = ext != null && (ext.equalsIgnoreCase("md") || ext.equalsIgnoreCase("markdown"));
    if (markdown) JUMPS.put(target.getPath(), new long[] {line, System.currentTimeMillis()});
    new OpenFileDescriptor(project, target, line - 1, column - 1).navigate(true);
    if (!markdown) return;
    // A preview of the target that is already loaded gets the jump now.
    List<LineNumbersExtension> live;
    synchronized (LIVE) {
      live = new ArrayList<>(LIVE);
    }
    for (LineNumbersExtension extension : live) {
      if (target.equals(extension.panel.getVirtualFile())) extension.sendJump(target);
    }
  }

  /** The link target: an absolute path, a file: URL, or a path relative to the source file. */
  private static VirtualFile resolve(VirtualFile source, String link) {
    String path = link.replaceFirst("^file:(//)?", "");
    path = URLDecoder.decode(path.replace("+", "%2B"), StandardCharsets.UTF_8);
    if (path.isEmpty()) return source;
    if (path.startsWith("/")) return LocalFileSystem.getInstance().refreshAndFindFileByPath(path);
    VirtualFile dir = source.getParent();
    if (dir == null) return null;
    dir.refresh(false, false);
    return dir.findFileByRelativePath(path);
  }

  @Override
  public List<String> getScripts() {
    return List.of(SCRIPT);
  }

  @Override
  public List<String> getStyles() {
    return List.of(STYLE);
  }

  @Override
  public ResourceProvider getResourceProvider() {
    return this;
  }

  @Override
  public boolean canProvide(String resourceName) {
    return SCRIPT.equals(resourceName) || STYLE.equals(resourceName);
  }

  @Override
  public ResourceProvider.Resource loadResource(String resourceName) {
    String name = SCRIPT.equals(resourceName) ? "line-numbers.js" : "line-numbers.css";
    return ResourceProvider.loadInternalResource(LineNumbersExtension.class, name, null);
  }

  @Override
  public void dispose() {
    pipe.removeSubscription(REQUEST, handler);
    pipe.removeSubscription(OPEN, openHandler);
    LIVE.remove(this);
  }

  public static final class Provider implements MarkdownBrowserPreviewExtension.Provider {
    @Override
    public MarkdownBrowserPreviewExtension createBrowserExtension(MarkdownHtmlPanel panel) {
      BrowserPipe pipe = panel.getBrowserPipe();
      return pipe == null ? null : new LineNumbersExtension(panel, pipe);
    }
  }
}
