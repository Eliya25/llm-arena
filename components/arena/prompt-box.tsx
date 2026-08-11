"use client";

import { useState } from "react";
import { ArrowUp, Check, ChevronDown, Plus, Repeat2, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CatalogModel } from "@/lib/openrouter";

export const MAX_SELECTED_MODELS = 3;

type ModelCommandListProps = {
  catalog: CatalogModel[];
  selectedIds: string[];
  // The chip being swapped, when the list opens from an existing chip.
  currentId?: string;
  onPick: (id: string) => void;
};

function ModelCommandList({
  catalog,
  selectedIds,
  currentId,
  onPick,
}: ModelCommandListProps) {
  const atCap = selectedIds.length >= MAX_SELECTED_MODELS;

  return (
    <Command>
      <CommandInput placeholder="Search models..." />
      <CommandList>
        <CommandEmpty>No models found.</CommandEmpty>
        <CommandGroup>
          {catalog.map((model) => {
            const isSelected = selectedIds.includes(model.id);
            const isCurrent = model.id === currentId;
            // Swapping a chip: other already-picked models stay off-limits.
            // Adding: everything is pickable until the cap.
            const disabled =
              currentId !== undefined
                ? isSelected && !isCurrent
                : !isSelected && atCap;

            return (
              <CommandItem
                key={model.id}
                disabled={disabled}
                onSelect={() => onPick(model.id)}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{model.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {model.contextWindow.toLocaleString()} tokens
                  </span>
                </div>
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    (currentId !== undefined ? isCurrent : isSelected)
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                  aria-hidden
                />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

type PromptBoxProps = {
  catalog: CatalogModel[];
  selectedIds: string[];
  onToggleModel: (id: string) => void;
  onRemoveModel: (id: string) => void;
  onReplaceModel: (oldId: string, newId: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
};

export function PromptBox({
  catalog,
  selectedIds,
  onToggleModel,
  onRemoveModel,
  onReplaceModel,
  prompt,
  onPromptChange,
  onSend,
  placeholder = "Ask anything. Enter to send, shift + enter for a new line.",
}: PromptBoxProps) {
  // Which picker is open: a chip's model id, "add" for the add button, or null.
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const selectedModels = selectedIds
    .map((id) => catalog.find((model) => model.id === id))
    .filter((model): model is CatalogModel => model !== undefined);

  const atCap = selectedIds.length >= MAX_SELECTED_MODELS;
  const canSend = prompt.trim().length > 0 && selectedModels.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="soft-shadow rounded-2xl border border-border/90 bg-card/95 p-2 backdrop-blur-xl focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/8 sm:p-3">
        <textarea
          rows={3}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          {selectedModels.length === 0 && catalog.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Couldn&apos;t load the model catalog right now.
            </span>
          ) : (
            selectedModels.map((model) => (
              <span
                key={model.id}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/80 py-1 pr-2 pl-1 text-xs text-secondary-foreground"
              >
                <Popover
                  open={openPicker === model.id}
                  onOpenChange={(open) => setOpenPicker(open ? model.id : null)}
                >
                  <PopoverTrigger
                    aria-label={`Change ${model.name}`}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-accent disabled:opacity-50"
                  >
                    {model.name}
                    <ChevronDown className="h-3 w-3" aria-hidden />
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <ModelCommandList
                      catalog={catalog}
                      selectedIds={selectedIds}
                      currentId={model.id}
                      onPick={(newId) => {
                        onReplaceModel(model.id, newId);
                        setOpenPicker(null);
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  aria-label={`Remove ${model.name}`}
                  onClick={() => onRemoveModel(model.id)}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))
          )}

          {/* Under the cap this adds a model; at the cap it becomes the change
              button — untick one model in the list, then tick another. */}
          {catalog.length > 0 && (
            <Popover
              open={openPicker === "add"}
              onOpenChange={(open) => setOpenPicker(open ? "add" : null)}
            >
              <PopoverTrigger
                aria-label={atCap ? "Change models" : "Add model"}
                className="flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {atCap ? (
                  <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                {atCap ? "Change models" : "Add model"}
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="start">
                <ModelCommandList
                  catalog={catalog}
                  selectedIds={selectedIds}
                  onPick={(id) => {
                    const removing = selectedIds.includes(id);
                    onToggleModel(id);
                    // Removing frees a slot to pick into — keep the list open.
                    // Adding completes the change, so the list closes.
                    if (!removing) setOpenPicker(null);
                  }}
                />
              </PopoverContent>
            </Popover>
          )}

          <button
            type="button"
            aria-label="Send prompt"
            disabled={!canSend}
            onClick={onSend}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[10px] tracking-wide text-muted-foreground">
        UP TO 3 MODELS · FREE TO RUN · ENTER TO SEND
      </p>
    </div>
  );
}
