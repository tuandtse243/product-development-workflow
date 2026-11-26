import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { consoleMailer } from "./mail/mailer.ts";

const config = loadConfig();
const db = await createDb(config.DATABASE_DIR);
const app = createApp({ db, mailer: consoleMailer(config.MAIL_FROM), sessionTtlHours: config.SESSION_TTL_HOURS });
app.listen(config.PORT, () => console.log(`listening on :${config.PORT}`));
