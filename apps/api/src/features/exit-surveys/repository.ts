import type { Database } from "@offboard/db/client";
import { desc, eq } from "drizzle-orm";
import type { ConfigValue } from "@offboard/db/schema";
import { exitSurveys, offboardingCases } from "@offboard/db/schema";

const monthLabels = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const chartMonths = 6;

function percent(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

export function createExitSurveysRepository(db: Database) {
  const surveyColumns = {
    id: exitSurveys.id,
    caseId: exitSurveys.caseId,
    caseName: offboardingCases.name,
    npsScore: exitSurveys.npsScore,
    responses: exitSurveys.responses,
    topics: exitSurveys.topics,
    submittedAt: exitSurveys.submittedAt,
  };

  async function listSurveys() {
    return db
      .select(surveyColumns)
      .from(exitSurveys)
      .innerJoin(offboardingCases, eq(exitSurveys.caseId, offboardingCases.id))
      .orderBy(desc(exitSurveys.submittedAt));
  }

  async function getSurveyAggregates() {
    const [surveys, cases] = await Promise.all([
      db
        .select({
          npsScore: exitSurveys.npsScore,
          topics: exitSurveys.topics,
          submittedAt: exitSurveys.submittedAt,
        })
        .from(exitSurveys),
      db.select({ id: offboardingCases.id }).from(offboardingCases),
    ]);

    const totalResponses = surveys.length;
    const promoters = surveys.filter(({ npsScore }) => npsScore >= 9).length;
    const detractors = surveys.filter(({ npsScore }) => npsScore <= 6).length;
    const scoreSum = surveys.reduce((sum, { npsScore }) => sum + npsScore, 0);

    const topicCounts = new Map<string, number>();
    const monthCounts = new Map<number, number>();

    for (const { topics, submittedAt } of surveys) {
      for (const topic of new Set(topics)) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }

      const monthKey = submittedAt.getUTCFullYear() * 12 + submittedAt.getUTCMonth();
      monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    }

    const activationsByMonth = [...monthCounts]
      .sort(([a], [b]) => a - b)
      .slice(-chartMonths)
      .map(([key, value]) => ({ label: monthLabels[key % 12], value }));

    const topTopics = [...topicCounts]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

    return {
      totalResponses,
      averageNps: totalResponses === 0 ? 0 : Math.round((scoreSum / totalResponses) * 10) / 10,
      nps: percent(promoters, totalResponses) - percent(detractors, totalResponses),
      completionRate: percent(totalResponses, cases.length),
      activationsByMonth,
      topTopics,
    };
  }

  async function submitSurvey(
    caseId: string,
    npsScore: number,
    responses: Record<string, ConfigValue>,
    topics: string[],
  ) {
    const [existing] = await db
      .select({ id: offboardingCases.id })
      .from(offboardingCases)
      .where(eq(offboardingCases.id, caseId));

    if (!existing) return null;

    const [row] = await db
      .insert(exitSurveys)
      .values({ caseId, npsScore, responses, topics })
      .onConflictDoUpdate({
        target: exitSurveys.caseId,
        set: { npsScore, responses, topics, submittedAt: new Date(), updatedAt: new Date() },
      })
      .returning({
        id: exitSurveys.id,
        caseId: exitSurveys.caseId,
        npsScore: exitSurveys.npsScore,
        responses: exitSurveys.responses,
        topics: exitSurveys.topics,
        submittedAt: exitSurveys.submittedAt,
      });

    return row;
  }

  return { listSurveys, getSurveyAggregates, submitSurvey };
}

export type ExitSurveysRepository = ReturnType<typeof createExitSurveysRepository>;
