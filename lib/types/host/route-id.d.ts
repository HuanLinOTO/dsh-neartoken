/**
 * The two parts of a catalog model id.
 *
 * A catalog id is `"<group>::<model>"`, where the group is display text that
 * may itself contain `::` and the separator that matters is the one closest to
 * the model. The request body carries the bare model only, so every place that
 * has to compare a stored id with a sent one decodes first.
 *
 * @module
 */
/**
 * Decode one catalog model id into its routing parts.
 * @param id - a catalog id ("`[低价] Grok::grok-4.6`") or a bare model name.
 * @returns the group (when the id carries one) and the real model name.
 */
export declare function decodeRoute(id: string): {
    group?: string;
    model: string;
};
