export type Severity = 'error' | 'warning';

export interface Finding {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  rule: string;
  message: string;
  hint: string;
  /** Route path, when the finding is about one. */
  path?: string;
}

export interface ScanResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

export interface FixChange {
  file: string;
  line: number;
  column: number;
  before: string;
  after: string;
}

export interface FixOptions {
  dryRun?: boolean;
}

export interface FixResult {
  dryRun: boolean;
  changes: FixChange[];
  diff: string;
}

export interface DepFinding {
  file: string;
  line: number;
  name: string;
  version: string;
  reason: string;
}

export interface DepsResult {
  packageFile: string | null;
  findings: DepFinding[];
}
