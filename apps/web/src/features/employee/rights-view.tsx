import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/shadcn/accordion";
import { rights, rightsDisclaimer } from "./rights";
import { EmployeePanel } from "./ui";

export function Rights() {
  return (
    <div className="space-y-5">
      <EmployeePanel title="Perguntas frequentes" description={rightsDisclaimer}>
        <Accordion>
          {rights.map(({ id, question, paragraphs, points }) => (
            <AccordionItem key={id} value={id}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>
                {paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {points ? (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </EmployeePanel>
    </div>
  );
}
