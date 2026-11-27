import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Treaty } from "@offboard/api-client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getApiClient } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { ContactDialog } from "./contact-dialog";
import { examples, initials, period, resultSummary, searchFailure } from "./format";
import { SearchHeader } from "./search-header";

type Search = ReturnType<typeof getApiClient>["api"]["candidates"]["search"]["get"];

type Candidate = Treaty.Data<Search>[number];

class SearchFailed extends Error {}

function candidateSearchQuery(q: string) {
  return queryOptions({
    queryKey: ["candidate-search", q],
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await getApiClient().api.candidates.search.get({
        query: { q },
        fetch: { signal },
      });

      if (result.error !== null || result.data === null) {
        throw new SearchFailed(searchFailure(result.status));
      }

      return result.data;
    },
  });
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const languages = candidate.languages.map((language) => language.name).join(", ");

  return (
    <li className="grid content-start gap-3 rounded-2xl border bg-card p-5 text-sm">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary"
        >
          {initials(candidate.name)}
        </span>
        <div className="grid min-w-0">
          <p className="truncate text-base font-bold">{candidate.name}</p>
          <p className="text-muted-foreground">{candidate.headline}</p>
        </div>
        <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary tabular-nums">
          {candidate.match}%
        </span>
      </div>
      {candidate.city || languages ? (
        <p className="text-muted-foreground">
          {[candidate.city, languages].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {candidate.experiences.length ? (
        <ul className="grid gap-1">
          {candidate.experiences.map((job) => (
            <li key={`${job.role}-${job.company}-${job.start}`}>
              {job.role} · {job.company}{" "}
              <span className="text-muted-foreground">{period(job.start, job.end)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {candidate.skills.length ? (
        <ul aria-label="Competências" className="flex flex-wrap gap-1.5">
          {candidate.skills.map((skill) => (
            <li key={skill} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {skill}
            </li>
          ))}
        </ul>
      ) : null}
      <ContactDialog id={candidate.id} name={candidate.name} />
    </li>
  );
}

function Results({ q }: { q: string }) {
  const search = useQuery(candidateSearchQuery(q));

  if (search.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-52 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (search.isError) {
    return (
      <p role="alert" className="text-center text-sm text-destructive">
        {search.error.message}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <p role="status" className="text-center text-sm text-muted-foreground">
        {resultSummary(search.data.length, q)}
      </p>
      <ul aria-label="Candidatos encontrados" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {search.data.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </ul>
    </div>
  );
}

export function CandidateSearchPage({
  q,
  onSearch,
}: {
  q: string | undefined;
  onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(q ?? "");

  const submit = (value: string) => {
    const query = value.trim();

    if (query.length >= 2) onSearch(query);
  };

  return (
    <main className="min-h-svh bg-background">
      <SearchHeader />
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:py-16">
        <div className="mx-auto grid max-w-2xl gap-3 text-center">
          <h1 className="text-[clamp(2rem,4vw,3rem)] leading-tight font-bold tracking-tight text-balance">
            Busque candidatos descrevendo quem você procura
          </h1>
          <p className="text-muted-foreground text-pretty">
            Escreva como falaria com um recrutador: tecnologia, idioma, cidade, se já liderou time.
            Aparecem só pessoas que escolheram estar nesta busca.
          </p>
        </div>
        <form
          role="search"
          className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full border bg-card p-1.5 pl-5 shadow-sm focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor="candidate-query" className="sr-only">
            Quem você procura?
          </label>
          <Input
            id="candidate-query"
            type="search"
            autoComplete="off"
            maxLength={200}
            value={text}
            placeholder="Ex.: dev backend que fala inglês e já liderou time"
            className="h-11 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="lg" className="h-11 rounded-full px-5">
            <HugeiconsIcon icon={Search01Icon} aria-hidden="true" />
            <span className="max-sm:sr-only">Buscar</span>
          </Button>
        </form>
        <ul aria-label="Exemplos de busca" className="flex flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <li key={example}>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setText(example);
                  submit(example);
                }}
              >
                {example}
              </Button>
            </li>
          ))}
        </ul>
        {q ? <Results q={q} /> : null}
      </section>
    </main>
  );
}
