import { app } from "./app.js";
import { env } from "@automotive/config";

app.listen(env.API_PORT, () => {
  console.log(`[api] listening on :${env.API_PORT}`);
});
