import { type EmployeeState } from "@offboard/employee";
import { skillsList, type Resume } from "@offboard/employee/career";
import { resumeHtml } from "@offboard/employee/resume-document";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { careerApplicationsQuery, careerResumeQuery } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { CareerApplications } from "./career/applications";
import { CareerJobs } from "./career/jobs";
import { ResumeFirst } from "./career/resume";
import { EmployeeError, EmployeePanel } from "./ui";

type CareerState = Extract<EmployeeState, { key: "career" }>;

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

function printResume(resume: Resume) {
  const preview = window.open("", "_blank");

  if (!preview) return false;

  preview.opener = null;
  preview.document.open();
  preview.document.write(resumeHtml(resume));
  preview.document.close();
  preview.focus();
  preview.print();

  return true;
}

export function ResumePreview({ state }: { state: CareerState }) {
  const { base, published } = state.value;
  const [error, setError] = useState("");

  return (
    <div className="space-y-5">
      <EmployeePanel
        title={published ? base.name : "Prévia oculta"}
        description={published ? base.headline : undefined}
      >
        {published ? (
          <>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.summary}</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.launchResult}</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.campaignResult}</p>
            <p className="wrap-anywhere">{skillsList(base.skills).join(" · ")}</p>
            <Button
              variant="outline"
              onClick={() =>
                setError(printResume(base) ? "" : "Permita abrir a nova aba para salvar o PDF.")
              }
            >
              Baixar PDF
            </Button>
            <EmployeeError message={error} />
          </>
        ) : (
          <p className="text-muted-foreground">Ative a prévia na tela Currículo.</p>
        )}
      </EmployeePanel>
    </div>
  );
}
