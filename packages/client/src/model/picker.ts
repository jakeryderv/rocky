/**
 * Filtering and labelling for the overlay pickers (models today; sessions and
 * settings later).
 *
 * Pure, so the matching rule is covered by the Node suite rather than only by a
 * rendered frame.
 */
import type { ModelRef } from "@rocky/contract";

/** How a model reads in the picker and in the status line. */
export function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

export function modelDescription(model: ModelRef): string | undefined {
  return model.displayName;
}

/**
 * Match against the full `provider/id` label, so both halves are searchable and
 * `openai-codex/gpt` narrows the way a user expects. Every whitespace-separated
 * term must match, which makes `codex 5.5` work without ordering rules.
 */
export function filterModels(models: readonly ModelRef[], query: string): ModelRef[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [...models];
  }
  return models.filter((model) => {
    const haystack = `${modelLabel(model)} ${model.displayName ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** True when this model is the one the session is currently using. */
export function isActiveModel(model: ModelRef, active: ModelRef | undefined): boolean {
  return active !== undefined && model.provider === active.provider && model.id === active.id;
}
