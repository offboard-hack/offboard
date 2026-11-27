import type { Database } from "@offboard/db/client";
import { exitSurveys } from "@offboard/db/schema";
import { exitSurveyRatings, type Departure } from "@offboard/employee/departure";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function syncExitSurvey(
  tx: Transaction,
  orgId: string,
  caseId: string,
  previous: Departure,
  next: Departure,
) {
  const { feedback } = next;

  if (
    !feedback ||
    feedback.recommendation === null ||
    JSON.stringify(previous.feedback) === JSON.stringify(feedback)
  ) {
    return;
  }

  const npsScore = feedback.recommendation;

  const responses = Object.fromEntries(
    exitSurveyRatings.flatMap(({ key }) => (feedback[key] === null ? [] : [[key, feedback[key]]])),
  );

  const topics = feedback.topics;

  await tx
    .insert(exitSurveys)
    .values({ orgId, caseId, npsScore, responses, topics })
    .onConflictDoUpdate({
      target: exitSurveys.caseId,
      set: { npsScore, responses, topics, submittedAt: new Date(), updatedAt: new Date() },
    });
}
