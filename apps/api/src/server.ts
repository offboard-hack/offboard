import { z } from "zod";
import { createApp } from "./app.js";

const config = z
  .object({
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WEB_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .transform((url) => new URL(url).origin)
      .default("http://localhost:5173"),
  })
  .parse(process.env);

createApp(config.WEB_ORIGIN).listen({
  hostname: config.API_HOST,
  reusePort: false,
  port: config.API_PORT,
});
