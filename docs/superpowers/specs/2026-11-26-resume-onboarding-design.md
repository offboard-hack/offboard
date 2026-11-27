# Résumé Onboarding Design

Samuel, 2026-11-26: importing a résumé should go through a step-by-step review before the résumé exists, following the "Onboarding: Novo currículo" mockup. He also wants the imported data in pgvector so a natural-language people search can find anyone by languages, programming languages, roles, people management, location or anything else in the résumé.

Decisions he made:

- Options: "Enviar um arquivo" and "Criar do zero". "Importar do LinkedIn" is out because LinkedIn has no API or scraping path.
- Surface: the web collaborator app (`/colaborador?tela=curriculo`), mobile-width first. The Expo app still runs on demo data.
- Search is not built here. It will live on the landing page as a demo, and its scope is decided after this work.

## Flow

1. **Seu novo currículo**: how it works (send the file, review the data), then Começar.
2. **Como quer enviar seu currículo?** (step 1 of 2): send a file (PDF or DOCX, up to 5 MB) or create from scratch.
3. **Lendo seu currículo…**: the file name and size, with Trocar. One extraction call reads the whole file, so the section checklist fills in all at once when it returns. Continuar unlocks after that.
4. **O que encontramos no seu currículo** (step 2 of 2): one row per section with a count, opening an editor for that section. "N para conferir" is derived from the content (an experience without a start date or role, for example). It is not an LLM judgement. Criar currículo saves.
5. **Seu currículo**: the existing résumé screen, with a "Currículo criado" toast. The score and suggestions arrive afterwards, as today.

Nothing is saved before Criar currículo, so replacing a résumé keeps the old one until the new one is confirmed.

## API

- `POST /me/resume/read` takes the file and returns `{ content }` from the existing extraction. It neither stores the file nor saves anything.
- `POST /me/resume` takes the reviewed `content`, plus the optional original `file`. It validates content like `PATCH /me/resume`, refuses an empty résumé (no headline and no experience), stores the file when one is sent, and replaces the base résumé and its previous file. It then requests scoring and matching, as an upload does.
- The client sends the file again at confirm, so no object is left behind when someone abandons the review.
- `POST /me/resume/upload` stays until the web switches over, then goes away.

## Search embedding

- A separate `resumes.profile_embedding vector(1024)` with `profile_embedded_hash`, on the base résumé only.
- Its text is the whole résumé: headline, summary, every experience with company, role, dates and bullets, education, skills, languages with level, and city. The job-matching embedding stays tuned to titles and skills, so job ranking does not change.
- A background job `embed_profile` runs after every base change (create, edit, applied suggestion), skips unchanged text by hash, and uses the same Workers AI `@cf/baai/bge-m3` model.
- Contact email, phone and links are not embedded.
- Migration 0019 goes to production before merge.

## Landing demo search

Samuel, 2026-11-26: the landing page gets a public people search so visitors can try it. It searches only fictional profiles. Real résumés stay inside the product, and who can search them is not decided yet.

- The profiles live in code (`features/demo/profiles.ts`), with fictional people and companies and no email, phone or links. Only `demo_profile_embeddings` (slug, hash, vector) is stored. Every scheduled drain re-embeds whatever changed and drops removed slugs, so editing the file is enough.
- `GET /api/demo/search?q=` is public. It embeds the query with the same `bge-m3` model and returns the six nearest cards with a match percentage.
- `demo_search_usage` caps each visitor (by a hash of `cf-connecting-ip`) at 30 searches a day, and everyone together at 2,000 a day, which keeps Workers AI inside the free allocation.
- The landing section is plain HTML and JavaScript in the static page. It builds results with `textContent`, never HTML.

## Being found by recruiters

Samuel, 2026-11-26: real résumés can be found only by people who opt in. The switch appears in the review step of the résumé import and stays in Preferências. Samuel then dropped the planned HR account: the search is a public page, `/busca-candidato`, so the switch says the profile becomes public.

- `talent_profiles.searchable_at` holds when the person opted in and is null when they have not. It is off by default. The data export includes it.
- `PUT /me/search-consent { searchable }` sets or clears it and returns `/me`, which now carries `searchable`.
- In the wizard the switch starts untouched. It shows the current choice and is saved only after Criar currículo, so redoing a résumé never changes an earlier choice by itself.
- Any future search over `resumes.profile_embedding` must join `talent_profiles` and require `searchable_at is not null`.
