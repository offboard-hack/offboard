import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  appendToOutbox,
  defaultOutbox,
  latestCode,
  outboxPath,
  readOutbox,
  signInCodeSubject,
} from "./dev-outbox.js";

const dir = () => mkdtempSync(join(tmpdir(), "offboard-outbox-"));

it("resolves the outbox path from the environment", () => {
  expect(outboxPath({})).toBe(defaultOutbox);
  expect(outboxPath({ DEV_EMAIL_OUTBOX: "/tmp/x.jsonl" })).toBe("/tmp/x.jsonl");
});

it("reads nothing from a missing outbox and skips malformed lines", () => {
  const path = join(dir(), "mail.jsonl");

  expect(readOutbox(path)).toEqual([]);

  appendToOutbox(path, { to: "a@example.com", subject: "s", text: "t" });
  writeFileSync(path, `{"to":1}\n`, { flag: "a" });

  expect(readOutbox(path)).toEqual([{ to: "a@example.com", subject: "s", text: "t" }]);
});

it("picks the latest sign-in code for an email and ignores other mail", () => {
  const messages = [
    { to: "a@example.com", subject: signInCodeSubject, text: "Código\n\n111111\n\n10 minutos" },
    { to: "a@example.com", subject: "Seu acesso ao Offboard", text: "Convite 999999" },
    { to: "b@example.com", subject: signInCodeSubject, text: "222222" },
    { to: "A@example.com", subject: signInCodeSubject, text: "Código\n\n333333\n\n10 minutos" },
  ];

  expect(latestCode(messages, "a@example.com")).toBe("333333");
  expect(latestCode(messages, "c@example.com")).toBeUndefined();
});
