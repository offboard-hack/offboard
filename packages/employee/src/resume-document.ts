import { type Resume, skillsList } from "./career.ts";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resumeHtml(resume: Resume) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Currículo de ${escapeHtml(resume.name)}</title>
    <style>
      @page { margin: 18mm; }
      * { box-sizing: border-box; }
      body { color: #221633; font: 12pt/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 170mm; }
      header { border-bottom: 2px solid #7008e7; margin-bottom: 22px; padding-bottom: 14px; }
      h1 { font-size: 27pt; line-height: 1.15; margin: 0 0 3px; }
      h2 { font-size: 14pt; margin: 0 0 4px; }
      p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      section { margin-top: 16px; break-inside: avoid; }
      .headline { color: #50288c; font-weight: 600; }
      .result { margin-top: 6px; }
      @media screen { body { padding: 30px 20px; } }
    </style>
  </head>
  <body>
    <header><h1>${escapeHtml(resume.name)}</h1><p class="headline">${escapeHtml(resume.headline)}</p></header>
    <section><h2>Resumo profissional</h2><p>${escapeHtml(resume.summary)}</p></section>
    <section>
      <h2>Experiência e resultados</h2>
      <p>${escapeHtml(resume.launchResult)}</p>
      <p class="result">${escapeHtml(resume.campaignResult)}</p>
    </section>
    <section><h2>Competências</h2><p>${escapeHtml(skillsList(resume.skills).join(" · "))}</p></section>
  </body>
</html>`;
}
