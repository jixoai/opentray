// Help Center route (openspec change redesign-create-opentray-webui).
//
// Contained localized list-detail reader over the packaged skill tree.
// Default selection is SKILL.md. Markdown is rendered through a strict,
// dependency-free subset renderer (headings, lists, code blocks, links with
// safe schemes only); path escapes and HTML injection are inert.

import { useEffect, useMemo, useState } from "react";

import { fetchSkillFile, fetchSkillList, type SkillEntry } from "../api";
import { Skeleton } from "../components/ui/skeleton";
import { Tree, TreeItem, TreeItemLabel } from "../components/reui/tree";
import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItType, Token } from "markdown-it";
import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { FileTextIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { usePreferences } from "../preferences";

/** Safe link schemes; everything else renders as plain text. */
const SAFE_LINK = /^(https?:|mailto:|#|\.\/|#\/)/iu;

/** Escape ALL HTML (used for fence language labels). */
const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * markdown-it instance for the help center. Security posture matches the
 * previous hand-written renderer:
 *  - html:false — ALL raw HTML in the source is escaped (never passes through)
 *  - linkify — bare URLs become links
 *  - validateLink override — only the safe schemes above resolve
 */
const md: MarkdownItType = MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});
// Scheme allowlist: reject anything outside http/https/mailto/anchor/relative.
md.validateLink = (url: string): boolean => SAFE_LINK.test(url.trim());
// Every link opens externally and never leaks the referrer/token URL.
const addLinkAttrs = (tokens: readonly Token[]): void => {
  for (const token of tokens) {
    if (token.type === "link_open") {
      token.attrSet("rel", "noreferrer noopener");
      token.attrSet("target", "_blank");
    }
    if (token.children !== null) addLinkAttrs(token.children);
  }
};
md.core.ruler.push("external_links", (state) => {
  addLinkAttrs(state.tokens);
  return true;
});
// Fenced code stays an explicit LTR technical island (matches the CSS layer).
md.renderer.rules.fence = (tokens, idx): string => {
  const token = tokens[idx]!;
  const lang = token.info.trim().length > 0 ? ` class="language-${escapeHtml(token.info.trim())}"` : "";
  return `<pre class="tech-ltr"><code${lang}>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
};

/** Render help markdown to sanitized HTML (raw HTML escaped, safe links only). */
export const renderMarkdown = (source: string): string => md.render(source);

/**
 * Help markdown rendering uses the tailwindcss-typography `prose` engine.
 * Element modifiers keep technical content technical: tables and code stay
 * LTR monospace; inline code stays neutral (no inverted pill); headings
 * inherit the theme tokens so light/dark both read correctly.
 */
const HELP_PROSE_CLASS = [
  "prose prose-sm",
  "dark:prose-invert",
  "max-w-[75ch]",
  // Compact vertical rhythm for a reference-style reading pane.
  "prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
  "prose-p:my-2 prose-li:my-0.5",
  // Code: LTR isolated, no pill inversion (theme tokens only).
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:font-mono prose-code:text-[0.85em]",
  "prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-lg",
  // Links keep the primary accent and never shift layout on hover.
  "prose-a:text-primary prose-a:decoration-primary/40 hover:prose-a:decoration-primary",
  // Tables: bordered, compact, technical LTR cells with a muted header row.
  "prose-table:border-collapse prose-table:text-xs",
  "prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-th:text-start prose-th:font-semibold",
  "prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-td:align-top",
  "prose-td:font-mono",
  // Horizontal rules and blockquote from the theme palette.
  "prose-hr:border-border prose-blockquote:border-primary/40",
].join(" ");

/** Per-item data for the help file tree (paths from the packaged skill). */
interface HelpTreeItem {
  readonly name: string;
  readonly path: string;
  children?: string[];
}

/** Icon per node kind; markdown leaf gets the document glyph. */
const helpTreeIcon = (item: HelpTreeItem, expanded: boolean): React.JSX.Element => {
  if (item.children !== undefined) {
    return expanded ? (
      <FolderOpenIcon aria-hidden className="pointer-events-none size-4 text-amber-500" />
    ) : (
      <FolderIcon aria-hidden className="pointer-events-none size-4 text-amber-500" />
    );
  }
  return <FileTextIcon aria-hidden className="pointer-events-none size-4 text-muted-foreground" />;
};

const INDENT = 16;

/**
 * The skill file list as a reui Tree (c-tree-5 pattern on @headless-tree):
 * folders expand in place, keyboard navigation works, selecting a markdown
 * leaf opens the detail pane. Paths are technical — labels stay LTR.
 */
const HelpSkillTree = ({
  entries,
  selected,
  onSelect,
}: {
  readonly entries: readonly SkillEntry[];
  readonly selected: string;
  readonly onSelect: (path: string) => void;
}): React.JSX.Element => {
  const items = useMemo(() => {
    const map = new Map<string, HelpTreeItem>();
    for (const entry of entries) {
      const segments = entry.path.split("/");
      const name = segments[segments.length - 1] ?? entry.path;
      if (entry.type === "directory") {
        map.set(entry.path, { name, path: entry.path, children: [] });
      } else {
        map.set(entry.path, { name, path: entry.path });
      }
    }
    // Parent chains: derive folders for every prefix of every path.
    for (const entry of entries) {
      const segments = entry.path.split("/");
      for (let i = 1; i < segments.length; i += 1) {
        const parent = segments.slice(0, i).join("/");
        if (!map.has(parent)) {
          map.set(parent, { name: segments[i - 1] ?? parent, path: parent, children: [] });
        }
      }
    }
    // Direct children only.
    for (const item of map.values()) {
      if (item.children === undefined) continue;
      item.children = [...map.values()]
        .filter((child) => child.path !== "" && child.path.split("/").slice(0, -1).join("/") === item.path)
        .map((child) => child.path);
    }
    const root: HelpTreeItem = { name: "skill", path: "", children: [] };
    root.children = [...map.values()]
      .filter((item) => item.path !== "" && item.path.split("/").length === 1)
      .map((item) => item.path);
    map.set("root", root);
    return Object.fromEntries(map);
  }, [entries]);

  // The packaged skill tree is tiny — keep every folder open.
  const expandedFolders = useMemo(
    () => Object.values(items).filter((i) => i.children !== undefined && i.path !== "").map((i) => i.path),
    [items],
  );

  // Controlled selection: the tree's own click/hotkey selection flows back
  // into the detail pane; programmatic selection (e.g. initial SKILL.md)
  // flows in through `selected`.
  const [selectedInTree, setSelectedInTree] = useState<string[]>([selected]);
  const tree = useTree<HelpTreeItem>({
    initialState: { selectedItems: [selected], expandedItems: expandedFolders },
    setSelectedItems: (updater) => {
      setSelectedInTree((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const first = next[0];
        // Only markdown leaves open documents; folder selections are visual.
        if (first !== undefined && items[first]?.children === undefined && first !== "root") {
          onSelect(first);
        }
        return next;
      });
    },
    indent: INDENT,
    rootItemId: "root",
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (itemId) => items[itemId] ?? { name: itemId, path: "" },
      getChildren: (itemId) => items[itemId]?.children ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  return (
    <Tree indent={INDENT} tree={tree}>
      {tree.getItems().map((item) => {
        const data = item.getItemData();
        const isSelectableFile = data.children === undefined && data.path !== "";
        return (
          <TreeItem
            key={item.getId()}
            item={item}
            onClick={() => {
              if (isSelectableFile) onSelect(data.path);
            }}
          >
            <TreeItemLabel className="tech-ltr relative before:bg-background before:absolute before:inset-x-0 before:-inset-y-0.5 before:-z-10">
              <span className="flex items-center gap-2">
                {helpTreeIcon(data, item.isExpanded())}
                {item.getItemName()}
              </span>
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );
};

export const HelpRoute = (): React.JSX.Element => {
  const { messages } = usePreferences();
  const [entries, setEntries] = useState<SkillEntry[]>([]);
  const [selected, setSelected] = useState<string>("SKILL.md");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetchSkillList();
      if (response.status === 200) {
        setEntries(response.data);
      } else {
        setError(messages.help.readError);
      }
      setLoadingList(false);
    })();
  }, [messages.help.readError]);

  useEffect(() => {
    setLoadingDoc(true);
    setError(null);
    void (async () => {
      const response = await fetchSkillFile(selected);
      if (response.status === 200 && "content" in response.data) {
        setContent(response.data.content);
      } else {
        setContent(null);
        setError(messages.help.readError);
      }
      setLoadingDoc(false);
    })();
  }, [selected, messages.help.readError]);

  const html = useMemo(() => (content === null ? "" : renderMarkdown(content)), [content]);

  return (
    <section className="flex h-full min-h-0 overflow-hidden" aria-label={messages.help.title}>
      <nav className="w-64 shrink-0 overflow-y-auto border-e border-border p-2" aria-label={messages.help.listTitle}>
        {loadingList ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground px-2 text-xs">{messages.help.empty}</p>
        ) : (
          <HelpSkillTree entries={entries} selected={selected} onSelect={setSelected} />
        )}
      </nav>
      <article className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6" aria-live="polite">
        {loadingDoc ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : error !== null ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          // Strict subset renderer; raw HTML is escaped before insertion.
          // Typography comes from tailwindcss-typography (HELP_PROSE_CLASS).
          <div
            className={HELP_PROSE_CLASS}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </article>
    </section>
  );
};
