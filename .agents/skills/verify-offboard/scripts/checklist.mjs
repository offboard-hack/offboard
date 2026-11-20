#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const { OFFBOARD_PLAYWRIGHT_DIR, OFFBOARD_VERIFY_URL, OFFBOARD_VERIFY_EVIDENCE } = process.env;

if (!OFFBOARD_PLAYWRIGHT_DIR || !OFFBOARD_VERIFY_URL || !OFFBOARD_VERIFY_EVIDENCE) {
  throw new Error("Set OFFBOARD_PLAYWRIGHT_DIR and launch this driver through scripts/run.py.");
}

const require = createRequire(join(resolve(OFFBOARD_PLAYWRIGHT_DIR), "package.json"));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});

const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const cardName = "Editar etapa: Bloquear acessos";

await context.tracing.start({ screenshots: true, snapshots: true });

try {
  const page = await context.newPage();

  await page.goto(new URL("/painel", OFFBOARD_VERIFY_URL).href, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Checklist automático", exact: true }).click();

  const title = page.getByRole("heading", { name: "Modelo padrão", exact: true });
  const card = page.getByRole("button", { name: cardName, exact: true });

  await title.waitFor();
  await card.waitFor();

  const initialCell = card.locator("xpath=ancestor::td");
  const initialPlacement = await initialCell.getAttribute("data-checklist-cell");

  assert.equal(initialPlacement, "cell:TI:d0");
  console.log("Initial placement: TI / Dia do desligamento");

  await page.screenshot({ path: join(OFFBOARD_VERIFY_EVIDENCE, "checklist-before.png") });
  await card.press("Space");
  await card.press("ArrowRight");
  await card.press("Space");

  const movedCard = page
    .locator('[data-checklist-cell="cell:TI:first-week"]')
    .getByRole("button", { name: cardName, exact: true });

  await movedCard.waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  console.log("Moved with Space, ArrowRight, Space: TI / Primeira semana");

  await page.getByRole("button", { name: "Salvar modelo", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Salvar modelo", exact: true }).isDisabled(), true);

  const newTab = await context.newPage();

  await newTab.goto(new URL("/checklist-automatico", OFFBOARD_VERIFY_URL).href);
  await newTab
    .locator('[data-checklist-cell="cell:TI:first-week"]')
    .getByRole("button", { name: cardName, exact: true })
    .waitFor();

  assert.equal(await newTab.getByRole("button", { name: "Salvar modelo", exact: true }).isDisabled(), true);
  console.log("Saved model reopened in a new tab with the changed placement");

  await newTab.screenshot({ path: join(OFFBOARD_VERIFY_EVIDENCE, "checklist-saved.png") });
  await writeFile(
    join(OFFBOARD_VERIFY_EVIDENCE, "checklist-saved.aria.txt"),
    await newTab.getByRole("main").ariaSnapshot(),
  );
} finally {
  try {
    await context.tracing.stop({ path: join(OFFBOARD_VERIFY_EVIDENCE, "checklist-trace.zip") });
  } finally {
    await browser.close();
  }
}
