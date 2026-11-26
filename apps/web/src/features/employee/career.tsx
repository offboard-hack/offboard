import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { careerApplicationsQuery, careerResumeQuery } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { buttonVariants } from "@/shared/ui/shadcn/button";
import { CareerApplications } from "./career/applications";
import { CareerJobs } from "./career/jobs";
import { ResumeFirst } from "./career/resume";

export function Career({
  account,
  view,
}: {
  account: EmployeeAccount;
  view: "vagas" | "candidaturas";
}) {
  const applications = useQuery(careerApplicationsQuery(account));
  const resume = useQuery(careerResumeQuery(account));

  return (
    <div className="space-y-5">
      <nav aria-label="Carreira" className="flex flex-wrap gap-2">
        <Link
          to="/colaborador"
          search={{ tela: "carreira", carreira: "vagas" }}
          className={buttonVariants({ variant: view === "vagas" ? "default" : "outline" })}
        >
          Vagas
        </Link>
        <Link
          to="/colaborador"
          search={{ tela: "carreira", carreira: "candidaturas" }}
          className={buttonVariants({ variant: view === "candidaturas" ? "default" : "outline" })}
        >
          Candidaturas{applications.data ? ` · ${applications.data.length}` : ""}
        </Link>
      </nav>
      {resume.data === null ? <ResumeFirst account={account} /> : null}
      {view === "vagas" ? (
        <CareerJobs account={account} />
      ) : (
        <CareerApplications account={account} />
      )}
    </div>
  );
}
