import { useInstallRunner } from "../src/installcheck.js";

// No pause between install tries in tests.
process.env.AIDW_INSTALL_PAUSE_MS = "0";

// Tests never install a real package: the install check passes unless a test says otherwise.
useInstallRunner(() => ({ ok: true, out: "", timedOut: false }));
