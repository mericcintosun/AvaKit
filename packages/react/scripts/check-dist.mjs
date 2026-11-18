// Build-time guard for the published bundle. `pnpm build` runs it right after
// tsup, so a broken entry fails the build (and CI, and the release) instead of
// reaching npm.
//
// 1. dist/index.js must start with the "use client" directive. Everything in it
//    needs the client runtime (context, state, effects). Without the directive a
//    Next.js Server Component that imports anything from "@avakit/react" crashes
//    with "createContext is not a function". Bundlers lose the directive easily
//    (tsup's `treeshake` pass strips it without failing), hence this check.
// 2. dist/utils.js ("@avakit/react/utils") must stay server-safe: no directive,
//    and it has to load where client-only React APIs do not exist, so Server
//    Components can call the pure helpers.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIRECTIVE = /^(["'])use client\1;?\s/;
const failures = [];

function read(relativePath) {
  const url = new URL(`../dist/${relativePath}`, import.meta.url);
  try {
    return { url, source: readFileSync(url, "utf8") };
  } catch {
    failures.push(`dist/${relativePath} is missing. Run tsup before this check.`);
    return { url, source: null };
  }
}

const client = read("index.js");
if (client.source !== null && !DIRECTIVE.test(client.source)) {
  failures.push(
    'dist/index.js does not start with "use client". Keep the directive as the first ' +
      "statement of src/index.ts and keep `treeshake` off in tsup.config.ts.",
  );
}

const utils = read("utils.js");
if (utils.source !== null) {
  if (/(["'])use client\1/.test(utils.source)) {
    failures.push(
      'dist/utils.js carries "use client", so Server Components can no longer call its helpers.',
    );
  }
  // Load it the way a React Server Components bundler resolves packages: under
  // the `react-server` condition, importing a client-only React API throws.
  const probe = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--input-type=module",
      "--eval",
      `const utils = await import(${JSON.stringify(utils.url.href)});
       const short = utils.shortenAddress("0x000000000000000000000000000000000000dEaD");
       if (short !== "0x0000…dEaD") throw new Error("shortenAddress returned " + short);
       if (typeof utils.cn !== "function" || typeof utils.humanizeError !== "function") {
         throw new Error("cn and humanizeError must be exported as functions");
       }`,
    ],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) {
    failures.push(
      `dist/utils.js does not load in a server (react-server) context:\n${probe.stderr || probe.error}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`@avakit/react build check failed (${fileURLToPath(import.meta.url)}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  '@avakit/react build check passed: client entry has "use client", utils is server-safe.',
);
