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
    <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <textarea
          rows={2}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {selectedModels.length === 0 && catalog.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Couldn&apos;t load the model catalog right now.
            </span>
          ) : (
            selectedModels.map((model) => (
              <span
                key={model.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pr-3 pl-1 text-sm text-secondary-foreground"
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
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
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
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Up to three models at a time. Every one of them is free. Press a model
        to swap it for another.
      </p>
    </div>
  );
}
