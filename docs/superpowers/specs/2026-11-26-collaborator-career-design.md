# Collaborator Career Design

The talent backend (#106, #109) becomes the collaborator app's **Carreira** tab. The departing person is the collaborator. They use the login they already have, the one from `apps/web/src/app/employee.tsx`, and there is no other account. "Talent profile" stays an internal table name only.

## Intent

To show and use AI Apply where the person already is. Samuel, 2026-11-26: "precisa ser na tela do colaborador". The Carreira tab is a prototype today: its résumé is a form saved in the collaborator's own state, its jobs come from the HR plan, and its applications are tracked locally. The real backend already has résumé reading and scoring, the job catalog with matching, applications, and the AI agent with a live rehearsal.

## Decisions (Samuel, 2026-11-26)

- **One identity.** The collaborator session (OTP, audience "employee") is enough for every talent route. On the first such request, the person's talent profile for that case is created automatically, with the org from the case, the email from the employee grant and the name from the case. A person who reaches the career routes with a collaborator session is sponsored for as long as their collaborator access exists.
- **Currículo:** upload a PDF/DOCX that the AI reads, then see the score and the suggestions, using the existing résumé routes. This replaces the local form.
- **Vagas:** the real catalog from `GET /me/jobs`, ranked by match, which replaces the plan's jobs. Each job offers "Ver vaga" and, for Greenhouse jobs, "Candidatar com IA".
- **Candidatar com IA:**
  - The AI prepares the answers.
  - The person reviews them and completes the missing ones (CPF, address…).
  - The person chooses **ensaio** (fill and screenshot, nothing sent) or **enviar**.
  - The person watches the browser fill the real form **live**, then sees the screenshot at the end.
  - The demo uses the ensaio. The Browserbase Free plan has no captcha solving.
- **Candidaturas:** the real ones from `GET /me/applications`, including the ones made by the AI.
- **Real sends** stay limited to the allowlist (Samuel, Davi, Carolina) and to AI Apply consent. The hackathon auditor uses a shared demo collaborator account that is on the allowlist.

## Constraints

- **Repo rules** as before:
  - 100% coverage;
  - zero comments;
  - Elysia slices, no cross-feature imports;
  - Eden-typed web client;
  - the main app's existing screens are untouched outside the Carreira tab.
- **Isolation:** a collaborator session reaches only its own case's profile. Portal and member sessions keep 403 on `/me/*`.
- **Live view:**
  - The Browserbase live-view URL gives access to the browser, so only the owner gets it, and only while the run is `running`/`submitting`.
  - The web shows it in a non-interactive iframe.
  - The page's submit guard stays armed during a rehearsal, so a stray click in the live view can't submit.
- **No 5-minute wait in the demo.** After confirming, the person's page triggers the run right away, in a request that waits for it to finish. The cron stays as the fallback.
- **AI provider:** the Anthropic API directly, with `ANTHROPIC_API_KEY` (Samuel's account), when the gateway key is absent. Same models, same prompts.

## Approaches considered

1. **Bridge the collaborator session into the talent routes (chosen).** One login, and all the reviewed backend is reused. The cost is a find-or-create of the profile on the first request.
2. **Rebuild career features on the collaborator's local state.** Rejected: it duplicates the backend and loses the matching, scoring and agent.
3. **Separate demo page.** Rejected by Samuel: it has to be the collaborator's screen.

## Delivery

- **PR A (API):** collaborator identity bridge; run-now route and live-view URL; Anthropic provider.
- **PR B (web):** the Carreira tab rebuilt on those routes.
- Mobile (`apps/mobile`) is not part of this.

## Left to the builder

- How profile creation handles races (unique case).
- How the live-view iframe is laid out.
- The exact copy, which the web follows from the existing collaborator screens' tone (pt-BR).
