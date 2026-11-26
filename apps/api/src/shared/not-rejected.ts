import { jobRejections, jobs } from "@offboard/db/schema";
import { sql } from "drizzle-orm";

export const notRejectedBy = (profileId: string) =>
  sql`not exists (select 1 from ${jobRejections} where ${jobRejections.profileId} = ${profileId} and ${jobRejections.jobId} = ${jobs.id})`;
