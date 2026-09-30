import type { StreamEvent } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new ApiError(
      res.status,
      text || "Could not complete the request. Try again.",
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function stream(
  id: string,
  last: string,
  signal: AbortSignal,
  receive: (event: StreamEvent) => void,
  opened: () => void = () => {},
) {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(id)}/events`,
    {
      signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(last ? { "Last-Event-ID": last } : {}),
      },
    },
  );
  if (!response.ok)
    throw new ApiError(
      response.status,
      "Conversation connection interrupted. Reconnecting…",
    );
  if (!response.body)
    throw new Error("Streaming is unavailable in this browser.");
  opened();
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let at;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        let eventID = "",
          kind = "",
          data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("id:")) eventID = line.slice(3).trim();
          if (line.startsWith("event:")) kind = line.slice(6).trim();
          if (line.startsWith("data:"))
            data += line.slice(5).trimStart() + "\n";
        }
        if (eventID && data)
          receive({ id: eventID, kind, data: JSON.parse(data) });
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
