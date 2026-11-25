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

const width = Number(process.env.OFFBOARD_VERIFY_WIDTH ?? 1440);
if (!Number.isSafeInteger(width) || width <= 0) {
  throw new Error("OFFBOARD_VERIFY_WIDTH must be a positive integer.");
}

const narrow = width < 768;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});

const context = await browser.newContext({
  viewport: { width, height: 1080 },
  hasTouch: narrow,
  storageState: process.env.OFFBOARD_VERIFY_STORAGE_STATE,
});

const cardName = "Editar etapa: Bloquear acessos";

await context.tracing.start({ screenshots: true, snapshots: true });

try {
  console.log(`Viewport width: ${width}px`);
  const page = await context.newPage();

  await page.goto(new URL("/painel", OFFBOARD_VERIFY_URL).href, { waitUntil: "networkidle" });
  if (narrow) await page.getByRole("button", { name: "Menu do portal" }).tap();

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
  await page.getByRole("button", { name: "Salvar modelo", exact: true }).and(page.locator(":disabled")).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Desfazer", exact: true }).isDisabled(), true);

  const freshContext = await browser.newContext({
    viewport: { width, height: 1080 },
    hasTouch: narrow,
    storageState: process.env.OFFBOARD_VERIFY_STORAGE_STATE,
  });
  const newTab = await freshContext.newPage();

  await newTab.goto(new URL("/checklist-automatico", OFFBOARD_VERIFY_URL).href);
  await newTab
    .locator('[data-checklist-cell="cell:TI:first-week"]')
    .getByRole("button", { name: cardName, exact: true })
    .waitFor();

  assert.equal(await newTab.getByRole("button", { name: "Salvar modelo", exact: true }).isDisabled(), true);
  console.log("Published model reopened in a fresh browser context with the changed placement");

  await newTab.screenshot({ path: join(OFFBOARD_VERIFY_EVIDENCE, "checklist-saved.png") });
  await writeFile(
    join(OFFBOARD_VERIFY_EVIDENCE, "checklist-saved.aria.txt"),
    await newTab.getByRole("main").ariaSnapshot(),
  );

  const movedInNewTab = newTab
    .locator('[data-checklist-cell="cell:TI:first-week"]')
    .getByRole("button", { name: cardName, exact: true });

  await movedInNewTab.press("Space");
  await movedInNewTab.press("ArrowLeft");
  await movedInNewTab.press("Space");
  const unsavedCard = newTab
    .locator('[data-checklist-cell="cell:TI:d0"]')
    .getByRole("button", { name: cardName, exact: true });

  await unsavedCard.waitFor();
  const failSave = (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
      : route.continue();

  await newTab.route("**/api/checklist-model", failSave);
  const retryableSave = newTab.getByRole("button", { name: "Salvar modelo", exact: true });

  await retryableSave.click();
  await newTab.getByRole("alert").filter({ hasText: "Não foi possível publicar o checklist" }).waitFor();
  assert.equal(await retryableSave.isEnabled(), true);
  assert.equal(await newTab.getByRole("button", { name: "Desfazer", exact: true }).isEnabled(), true);
  await unsavedCard.waitFor();
  await newTab.unroute("**/api/checklist-model", failSave);
  await newTab.reload();
  await unsavedCard.waitFor();
  await retryableSave.click();
  await retryableSave.and(newTab.locator(":disabled")).waitFor();
  console.log("A failed server save retained the draft across reload; retry published it.");
  await freshContext.close();
} finally {
  try {
    await context.tracing.stop({ path: join(OFFBOARD_VERIFY_EVIDENCE, "checklist-trace.zip") });
  } finally {
    await browser.close();
  }
}
