/**
 * Shorten one harness tool-call id to something the wire accepts.
 *
 * The replacement is a pure digest of the original, so a call and the result
 * that answers it land on the same id without either pass carrying state: the
 * assistant turn and the tool message are serialized separately.
 * @param id - the harness tool-call id.
 * @returns the id to send; unchanged when it is already acceptable.
 */
export declare function wireCallId(id: string): string;
