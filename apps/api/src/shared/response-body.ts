export const readCapped = async (body: ReadableStream<Uint8Array>, maxBytes: number) => {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;

  const reader = body.getReader();

  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;

    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);

      return null;
    }

    parts.push(decoder.decode(next.value, { stream: true }));
  }

  parts.push(decoder.decode());

  return parts.join("");
};

export const discardBody = async (response: Response) => {
  await response.body?.cancel().catch(() => undefined);
};
