"use client";

import { useState, useCallback } from "react";
import { X, Plus } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  color?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function TagEditor({ tags, onChange, color = "bg-blue-500/10 text-blue-700", placeholder = "Add...", disabled }: TagEditorProps) {
  const [input, setInput] = useState("");

  const addTag = useCallback(() => {
    const val = input.trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
    setInput("");
  }, [input, tags, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  }, [tags, onChange]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span key={tag} className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium", color)}>
            {tag}
            {!disabled && (
              <button onClick={() => removeTag(tag)} className="hover:opacity-70">
                <X className="size-2.5" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-1.5">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder={placeholder}
            className="h-7 text-xs"
          />
          <button
            onClick={addTag}
            disabled={!input.trim()}
            className="flex items-center justify-center size-7 rounded-md border bg-background hover:bg-accent disabled:opacity-30 shrink-0"
          >
            <Plus className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}
