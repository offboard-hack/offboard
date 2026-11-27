import type { ScenarioName } from "./args.js";
import { renderLogins, type Context } from "./context.js";
import { scenarios } from "./scenarios.js";

export async function runScenario(name: ScenarioName, ctx: Context) {
  ctx.log(`scenario ${name}`);

  await scenarios[name](ctx);

  ctx.log("log in to see the result:");

  for (const line of renderLogins(ctx.logins)) ctx.log(line);
}
