import { createApp } from "./app.ts";
import { createDb } from "./db/client.ts";

const port = Number(process.env.PORT ?? 3000);
const db = await createDb(process.env.DATABASE_DIR || undefined);
createApp({ db }).listen(port, () => console.log(`API on http://localhost:${port}`));
