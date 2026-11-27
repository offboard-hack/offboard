import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/shadcn/sheet";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { EmployeeError } from "../ui";
import {
  bulletLimit,
  educationProblem,
  emptyEducation,
  emptyExperience,
  experienceProblem,
  listLimit,
  overLimit,
  type ResumeDraft,
  type SectionId,
  splitLines,
  tooLong,
} from "./resume-onboarding";

const titles: Record<SectionId, { title: string; description: string }> = {
  summary: {
    title: "Resumo profissional",
    description: "O título aparece no topo do currículo. O resumo apresenta você em poucas linhas.",
  },
  experiences: {
    title: "Experiências",
    description: "Cargo, empresa e início são obrigatórios. Escreva uma conquista por linha.",
  },
  education: { title: "Formação", description: "Instituição e curso são obrigatórios." },
  skills: { title: "Competências", description: "Uma competência por linha." },
  languages: { title: "Idiomas", description: "O nível é opcional." },
  contact: {
    title: "Contato e links",
    description: "Recrutadores usam estes dados para falar com você.",
  },
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  rows,
  perLine,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  perLine?: boolean;
}) {
  const id = useId();
  const long = overLimit(value, perLine);

  const control = {
    id,
    value,
    placeholder,
    "aria-invalid": long || undefined,
    "aria-describedby": long ? `${id}-error` : undefined,
  };

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          {...control}
          rows={rows ?? 4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input {...control} onChange={(event) => onChange(event.target.value)} />
      )}
      <EmployeeError id={`${id}-error`} message={long ? "Use até 2.000 caracteres." : undefined} />
    </div>
  );
}

function withIds<T extends { id: string }>(
  lines: string[],
  previous: T[],
  make: (id: string, line: string) => T,
) {
  return lines.map((line, index) => make(previous[index]?.id ?? crypto.randomUUID(), line));
}

function Row({
  title,
  problem,
  onRemove,
  children,
}: {
  title: string;
  problem: string | undefined;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <legend className="font-medium wrap-anywhere">{title}</legend>
        <Button variant="ghost" size="icon" aria-label={`Remover ${title}`} onClick={onRemove}>
          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
        </Button>
      </div>
      {problem ? <p className="text-sm text-amber-700 dark:text-amber-400">{problem}</p> : null}
      {children}
    </fieldset>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="w-fit" disabled={disabled} onClick={onClick}>
      <HugeiconsIcon icon={PlusSignIcon} aria-hidden="true" /> {label}
    </Button>
  );
}

function SummaryEditor({ draft, set }: Editor) {
  return (
    <>
      <Field
        label="Título"
        placeholder="Ex.: Engenheira de Software"
        value={draft.headline.text}
        onChange={(text) => set({ ...draft, headline: { ...draft.headline, text } })}
      />
      <Field
        label="Resumo"
        multiline
        rows={6}
        value={draft.summary.text}
        onChange={(text) => set({ ...draft, summary: { ...draft.summary, text } })}
      />
    </>
  );
}

function ExperiencesEditor({ draft, set }: Editor) {
  const update = (index: number, change: Partial<ResumeDraft["experiences"][number]>) =>
    set({
      ...draft,
      experiences: draft.experiences.map((item, at) =>
        at === index ? { ...item, ...change } : item,
      ),
    });

  return (
    <>
      {draft.experiences.map((experience, index) => (
        <Row
          key={experience.id}
          title={experience.role || experience.company || `Experiência ${index + 1}`}
          problem={experienceProblem(experience)}
          onRemove={() =>
            set({ ...draft, experiences: draft.experiences.filter((_, at) => at !== index) })
          }
        >
          <Field
            label="Cargo"
            value={experience.role}
            onChange={(role) => update(index, { role })}
          />
          <Field
            label="Empresa"
            value={experience.company}
            onChange={(company) => update(index, { company })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Início"
              placeholder="2021-03"
              value={experience.start}
              onChange={(start) => update(index, { start })}
            />
            <Field
              label="Fim"
              placeholder="Atual"
              value={experience.end ?? ""}
              onChange={(end) => update(index, { end: end.trim() ? end : null })}
            />
          </div>
          <Field
            label="Conquistas e responsabilidades"
            multiline
            perLine
            value={experience.bullets.map((bullet) => bullet.text).join("\n")}
            onChange={(value) =>
              update(index, {
                bullets: withIds(
                  value.split("\n").slice(0, bulletLimit),
                  experience.bullets,
                  (id, text) => ({ id, text }),
                ),
              })
            }
          />
        </Row>
      ))}
      <AddButton
        label="Adicionar experiência"
        disabled={draft.experiences.length >= listLimit}
        onClick={() => set({ ...draft, experiences: [...draft.experiences, emptyExperience()] })}
      />
    </>
  );
}

function EducationEditor({ draft, set }: Editor) {
  const update = (index: number, change: Partial<ResumeDraft["education"][number]>) =>
    set({
      ...draft,
      education: draft.education.map((item, at) => (at === index ? { ...item, ...change } : item)),
    });

  const optional = (value: string) => (value.trim() ? value : null);

  return (
    <>
      {draft.education.map((education, index) => (
        <Row
          key={education.id}
          title={education.degree || education.institution || `Formação ${index + 1}`}
          problem={educationProblem(education)}
          onRemove={() =>
            set({ ...draft, education: draft.education.filter((_, at) => at !== index) })
          }
        >
          <Field
            label="Curso"
            value={education.degree}
            onChange={(degree) => update(index, { degree })}
          />
          <Field
            label="Instituição"
            value={education.institution}
            onChange={(institution) => update(index, { institution })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Início"
              value={education.start ?? ""}
              onChange={(start) => update(index, { start: optional(start) })}
            />
            <Field
              label="Fim"
              value={education.end ?? ""}
              onChange={(end) => update(index, { end: optional(end) })}
            />
          </div>
        </Row>
      ))}
      <AddButton
        label="Adicionar formação"
        disabled={draft.education.length >= listLimit}
        onClick={() => set({ ...draft, education: [...draft.education, emptyEducation()] })}
      />
    </>
  );
}

function SkillsEditor({ draft, set }: Editor) {
  const [text, setText] = useState(() => draft.skills.map((skill) => skill.name).join("\n"));

  return (
    <Field
      label="Competências"
      multiline
      perLine
      rows={10}
      placeholder={"Go\nKubernetes\nGestão de pessoas"}
      value={text}
      onChange={(value) => {
        setText(value);
        set({
          ...draft,
          skills: withIds(splitLines(value).slice(0, listLimit), draft.skills, (id, name) => ({
            id,
            name,
          })),
        });
      }}
    />
  );
}

function LanguagesEditor({ draft, set }: Editor) {
  const update = (index: number, change: Partial<ResumeDraft["languages"][number]>) =>
    set({
      ...draft,
      languages: draft.languages.map((item, at) => (at === index ? { ...item, ...change } : item)),
    });

  return (
    <>
      {draft.languages.map((language, index) => (
        <Row
          key={language.id}
          title={language.name || `Idioma ${index + 1}`}
          problem={language.name.trim() ? undefined : "Falta o idioma."}
          onRemove={() =>
            set({ ...draft, languages: draft.languages.filter((_, at) => at !== index) })
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Idioma"
              value={language.name}
              onChange={(name) => update(index, { name })}
            />
            <Field
              label="Nível"
              placeholder="Fluente"
              value={language.level ?? ""}
              onChange={(level) => update(index, { level: level.trim() ? level : null })}
            />
          </div>
        </Row>
      ))}
      <AddButton
        label="Adicionar idioma"
        disabled={draft.languages.length >= listLimit}
        onClick={() =>
          set({
            ...draft,
            languages: [...draft.languages, { id: crypto.randomUUID(), name: "", level: null }],
          })
        }
      />
    </>
  );
}

function ContactEditor({ draft, set }: Editor) {
  const [links, setLinks] = useState(() => draft.contact.links.join("\n"));

  const update = (change: Partial<ResumeDraft["contact"]>) =>
    set({ ...draft, contact: { ...draft.contact, ...change } });

  const optional = (value: string) => (value.trim() ? value : null);

  return (
    <>
      <Field
        label="E-mail"
        value={draft.contact.email ?? ""}
        onChange={(email) => update({ email: optional(email) })}
      />
      <Field
        label="Telefone"
        value={draft.contact.phone ?? ""}
        onChange={(phone) => update({ phone: optional(phone) })}
      />
      <Field
        label="Cidade"
        placeholder="Ex.: Recife, PE"
        value={draft.contact.city ?? ""}
        onChange={(city) => update({ city: optional(city) })}
      />
      <Field
        label="Links"
        multiline
        perLine
        placeholder={"https://www.linkedin.com/in/voce\nhttps://github.com/voce"}
        value={links}
        onChange={(value) => {
          setLinks(value);
          update({ links: splitLines(value).slice(0, listLimit) });
        }}
      />
    </>
  );
}

type Editor = { draft: ResumeDraft; set: (draft: ResumeDraft) => void };

const editors: Record<SectionId, (props: Editor) => ReactNode> = {
  summary: SummaryEditor,
  experiences: ExperiencesEditor,
  education: EducationEditor,
  skills: SkillsEditor,
  languages: LanguagesEditor,
  contact: ContactEditor,
};

function texts(draft: ResumeDraft) {
  return [
    draft.headline.text,
    draft.summary.text,
    ...draft.experiences.flatMap((item) => [
      item.company,
      item.role,
      item.start,
      item.end,
      ...item.bullets.map((bullet) => bullet.text),
    ]),
    ...draft.education.flatMap((item) => [item.institution, item.degree, item.start, item.end]),
    ...draft.skills.map((skill) => skill.name),
    ...draft.languages.flatMap((language) => [language.name, language.level]),
    draft.contact.email,
    draft.contact.phone,
    draft.contact.city,
    ...draft.contact.links,
  ];
}

function cleaned(draft: ResumeDraft) {
  const next: ResumeDraft = {
    ...draft,
    experiences: draft.experiences.map((item) => ({
      ...item,
      bullets: item.bullets.filter((bullet) => bullet.text.trim()),
    })),
    languages: draft.languages.filter((language) => language.name.trim()),
  };

  return next;
}

export function SectionSheet({
  section,
  draft,
  onSave,
  onClose,
}: {
  section: SectionId;
  draft: ResumeDraft;
  onSave: (draft: ResumeDraft) => void;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(draft);
  const Editor = editors[section];
  const invalid = texts(working).some(tooLong);

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{titles[section].title}</SheetTitle>
          <SheetDescription>{titles[section].description}</SheetDescription>
        </SheetHeader>
        <form
          id="resume-section"
          noValidate
          className="grid flex-1 content-start gap-4 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!invalid) onSave(cleaned(working));
          }}
        >
          <Editor draft={working} set={setWorking} />
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="resume-section" disabled={invalid}>
            Salvar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
