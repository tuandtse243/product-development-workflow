import { usePackageLookup } from "../src/depsafety.js";
import { useInstallRunner } from "../src/installcheck.js";

// No pause between install tries in tests.
process.env.AIDW_INSTALL_PAUSE_MS = "0";

// Tests never install a real package: the install check passes unless a test says otherwise.
useInstallRunner(() => ({ ok: true, out: "", timedOut: false }));

// Tests never call the package index: an added package is old and clean unless a test says otherwise.
usePackageLookup(() => ({ status: "found", publishedAt: "2020-01-01T00:00:00Z", advisories: [] }));
