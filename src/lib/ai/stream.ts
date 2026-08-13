export function readDelta(chunk: {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
}): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}
