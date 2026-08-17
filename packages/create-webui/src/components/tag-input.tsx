/**
 * Argv tag input (array input mode): every tag is ONE argv element, taken
 * verbatim — the value is never split on spaces or any other delimiter.
 * Enter commits the current draft as one element; Backspace on an empty
 * draft removes the last element.
 */
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface TagInputProps {
  tags: readonly string[];
  onTagsChange(tags: readonly string[]): void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

export function TagInput({
  tags,
  onTagsChange,
  disabled = false,
  placeholder,
  className,
  ...rest
}: TagInputProps): React.JSX.Element {
  const [draft, setDraft] = React.useState("");

  const commitDraft = (): void => {
    if (draft.length === 0) return;
    onTagsChange([...tags, draft]);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs shadow-xs focus-within:border-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      {tags.map((tag, index) => (
        <span
          key={`${index}:${tag}`}
          className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-accent-foreground"
        >
          <span className="max-w-56 truncate" title={tag}>
            {tag}
          </span>
          {!disabled ? (
            <button
              type="button"
              aria-label={`移除参数 ${index + 1}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                onTagsChange(tags.filter((_, i) => i !== index));
              }}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
        value={draft}
        disabled={disabled}
        placeholder={placeholder ?? (tags.length === 0 ? "程序（如 npx）" : "参数，回车添加")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            return;
          }
          if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
            event.preventDefault();
            onTagsChange(tags.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
        {...rest}
      />
    </div>
  );
}
