export type Level = "error" | "warning";

export interface Diagnostic {
  level: Level;
  file: string;
  line?: number;
  message: string;
}

/** Collects validation findings. Errors fail a check; warnings fail only under --strict. */
export class Diags {
  readonly items: Diagnostic[] = [];

  error(file: string, message: string, line?: number): void {
    this.items.push({ level: "error", file, message, ...(line ? { line } : {}) });
  }

  warn(file: string, message: string, line?: number): void {
    this.items.push({ level: "warning", file, message, ...(line ? { line } : {}) });
  }

  add(other: Diags): void {
    this.items.push(...other.items);
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.level === "error");
  }

  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.level === "warning");
  }

  failed(strict = false): boolean {
    return this.errors.length > 0 || (strict && this.warnings.length > 0);
  }
}

/** An error the CLI reports as a one-line message, not a stack trace. */
export class OpError extends Error {
  constructor(
    message: string,
    readonly diags?: Diags,
  ) {
    super(message);
  }
}
