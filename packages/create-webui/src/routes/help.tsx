// Help Center route (openspec change redesign-create-opentray-webui).
//
// Contained localized list-detail reader over the packaged skill tree.
// Default selection is SKILL.md. Markdown is rendered through a strict,
// dependency-free subset renderer (headings, lists, code blocks, links with
// safe schemes only); path escapes and HTML injection are inert.

import { useEffect, useMemo, useState } from "react";

import { fetchSkillFile, fetchSkillList, type SkillEntry } from "../api";
import { Skeleton } from "../components/ui/skeleton";
import { usePreferences } from "../preferences";

/** Safe link schemes; everything else renders as plain text. */
const SAFE_LINK = /^(https?:|mailto:|#|\.\/|#\/)/iu;

/** Escape ALL HTML before any inline formatting is applied. */
const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

interface Inline {
  readonly html: string;
}

const renderInline = (text: string): Inline => {
  const escaped = escapeHtml(text);
  // Code spans, then bold, then links (safe schemes only).
  let html = escaped.replace(/`([^`]+)`/gu, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (match, label: string, href: string) => {
    if (!SAFE_LINK.test(href)) {
      return label;
    }
    return `<a href="${href}" rel="noreferrer noopener" target="_blank">${label}</a>`;
  });
  return { html };
};

/** Render a strict Markdown subset to sanitized HTML (no raw HTML passes). */
export const renderMarkdown = (source: string): string => {
  const lines = source.split("\n");
  const out: string[] = [];
  let inCode = false;
  let listType: "ul" | "ol" | null = null;
  const closeList = (): void => {
    if (listType !== null) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        out.push('<pre class="tech-ltr"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading !== null) {
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!).html}</h${level}>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/u.exec(line);
    if (unordered !== null) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${renderInline(unordered[1]!).html}</li>`);
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/u.exec(line);
    if (ordered !== null) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${renderInline(ordered[1]!).html}</li>`);
      continue;
    }
    closeList();
    if (line.trim().length === 0) {
      continue;
    }
    if (line.startsWith("---")) {
      out.push("<hr />");
      continue;
    }
    // Front-matter fences render inertly as text.
    out.push(`<p>${renderInline(line).html}</p>`);
  }
  closeList();
  if (inCode) {
    out.push("</code></pre>");
  }
  return out.join("\n");
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
    <section className="flex h-full overflow-hidden" aria-label={messages.help.title}>
      <nav className="w-56 shrink-0 overflow-auto border-e border-border p-2" aria-label={messages.help.listTitle}>
        {loadingList ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground px-2 text-xs">{messages.help.empty}</p>
        ) : (
          <ul className="space-y-0.5">
            {entries
              .filter((entry) => entry.type === "file")
              .map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    aria-current={selected === entry.path ? "page" : undefined}
                    className={`tech-ltr w-full truncate rounded-md px-2 py-1 text-left text-xs ${
                      selected === entry.path ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground"
                    }`}
                    onClick={() => {
                      setSelected(entry.path);
                    }}
                  >
                    {entry.path}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </nav>
      <article className="min-w-0 flex-1 overflow-auto p-6" aria-live="polite">
        {loadingDoc ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : error !== null ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div
            className="prose-help max-w-[70ch] text-sm leading-relaxed"
            // Strict subset renderer; raw HTML is escaped before insertion.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </article>
    </section>
  );
};
