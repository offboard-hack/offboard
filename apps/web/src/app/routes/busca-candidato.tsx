import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CandidateSearchPage } from "@/features/candidate-search/candidate-search-page";

export const Route = createFileRoute("/busca-candidato")({
  validateSearch: z.object({ q: z.string().trim().min(2).max(200).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "Buscar candidatos · Offboard" }] }),
  component: CandidateSearchRoute,
});

function CandidateSearchRoute() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();

  return <CandidateSearchPage q={q} onSearch={(next) => void navigate({ search: { q: next } })} />;
}
