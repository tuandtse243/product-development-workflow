import { createApp } from "./app.ts";
import { httpGateway, usePaymentGateway } from "./billing/gateway.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { startJobs } from "./jobs/runner.ts";
import { consoleMailer } from "./mail/mailer.ts";

const config = loadConfig();
const db = await createDb(config.DATABASE_DIR);
const mailer = consoleMailer(config.MAIL_FROM);
usePaymentGateway(httpGateway({ url: config.PAYMENTS_URL, apiKey: config.PAYMENTS_API_KEY }));
const app = createApp({ db, mailer, sessionTtlHours: config.SESSION_TTL_HOURS });
startJobs({ db, mailer });
app.listen(config.PORT, () => console.log(`listening on :${config.PORT}`));
