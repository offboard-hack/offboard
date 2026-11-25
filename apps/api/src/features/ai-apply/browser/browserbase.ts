import { z } from "zod";
import { discardBody } from "../../../shared/response-body.js";

export class BrowserbaseError extends Error {
  readonly status: number;

  constructor(action: string, status: number) {
    super(`Browserbase ${action} failed with status ${status}`);
    this.name = "BrowserbaseError";
    this.status = status;
  }
}

const api = "https://api.browserbase.com/v1";

type SessionBody = {
  projectId: string;
  region?: string;
  timeout?: number;
  browserSettings?: { recordSession: boolean; logSession: boolean; solveCaptchas: boolean };
  status?: string;
};

const session = z.object({ id: z.string(), connectUrl: z.string() });

export const createBrowserbase = (
  fetchImpl: typeof fetch,
  config: { apiKey: string; projectId: string },
) => {
  const keyHeader = { "X-BB-API-Key": config.apiKey };

  const jsonPost = (path: string, body: SessionBody) =>
    fetchImpl(`${api}${path}`, {
      method: "POST",
      headers: { ...keyHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    async createSession() {
      const response = await jsonPost("/sessions", {
        projectId: config.projectId,
        region: "us-east-1",
        timeout: 240,
        browserSettings: {
          recordSession: false,
          logSession: false,
          solveCaptchas: true,
        },
      });

      if (!response.ok) {
        await discardBody(response);

        throw new BrowserbaseError("create session", response.status);
      }

      const parsed = session.safeParse(await response.json());

      if (!parsed.success) throw new BrowserbaseError("create session", response.status);

      return parsed.data;
    },

    async upload(sessionId: string, file: { name: string; bytes: Uint8Array; type: string }) {
      const form = new FormData();
      form.append("file", new File([Uint8Array.from(file.bytes)], file.name, { type: file.type }));

      const response = await fetchImpl(`${api}/sessions/${sessionId}/uploads`, {
        method: "POST",
        headers: keyHeader,
        body: form,
      });

      await discardBody(response);

      if (!response.ok) throw new BrowserbaseError("upload", response.status);
    },

    async release(sessionId: string) {
      const response = await jsonPost(`/sessions/${sessionId}`, {
        projectId: config.projectId,
        status: "REQUEST_RELEASE",
      });

      await discardBody(response);

      if (!response.ok) throw new BrowserbaseError("release", response.status);
    },
  };
};
