import type { BrowserContext } from "@playwright/test";

/** What went wrong in the browser while a test ran, one line per problem. */
export interface BrowserIssues {
  /** `console.error` calls, including the browser's own (a failed load, a refused resource). */
  readonly consoleErrors: string[];
  /** Uncaught exceptions and unhandled promise rejections. */
  readonly pageErrors: string[];
  /** Content Security Policy violations, enforced or report-only. */
  readonly cspViolations: string[];
}

interface CspReport {
  directive: string;
  blocked: string;
  source: string;
  line: number;
  disposition: string;
}

const BINDING = "__avakitE2eCspViolation";

/**
 * Collect console errors, uncaught errors and CSP violations from every page
 * and frame of `context`, from the first script on.
 *
 * Violations are reported through a binding rather than kept on `window`, so
 * that one on a page the test has since navigated away from is not lost.
 */
export async function watchIssues(context: BrowserContext): Promise<BrowserIssues> {
  const issues: BrowserIssues = { consoleErrors: [], pageErrors: [], cspViolations: [] };

  context.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location().url || message.page()?.url() || "?";
    issues.consoleErrors.push(`${message.text()} (at ${where})`);
  });
  context.on("weberror", (webError) => {
    const error = webError.error();
    issues.pageErrors.push(`${error.name}: ${error.message} (on ${webError.page()?.url() ?? "?"})`);
  });

  await context.exposeBinding(BINDING, ({ frame }, report: CspReport) => {
    issues.cspViolations.push(
      `${report.disposition === "report" ? "[report-only] " : ""}${report.directive} blocked ` +
        `${report.blocked || "(inline)"} at ${report.source || frame.url()}:${report.line}`,
    );
  });
  await context.addInitScript((binding) => {
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        const report = (window as unknown as Record<string, (r: CspReport) => void>)[binding];
        report?.({
          directive: event.effectiveDirective || event.violatedDirective,
          blocked: event.blockedURI,
          source: event.sourceFile,
          line: event.lineNumber,
          disposition: event.disposition,
        });
      },
      true,
    );
  }, BINDING);

  return issues;
}
