import {
  annotateOutcomeExitCode,
  serializeStrictAnnotateResult,
  STRICT_GATE_ERROR_EXIT_CODE,
  writeAnnotateResultFile,
  type AnnotateOutcome,
} from "./strict-annotate-result";

export interface CompleteAnnotateCommandOptions {
  waitForDecision: () => Promise<AnnotateOutcome>;
  settleAfterDecision: () => Promise<void>;
  stopServer: () => void;
  requireApproval: boolean;
  resultFile?: string;
  writeResultFile?: (
    resultFile: string,
    serialized: string,
  ) => Promise<void>;
  writeStdout?: (output: string) => Promise<void>;
  emitLegacyOutcome: (result: AnnotateOutcome) => void;
  exit?: (code: number) => void;
  logError?: (message: string) => void;
}

export function writeStdout(output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function completeAnnotateCommand({
  waitForDecision,
  settleAfterDecision,
  stopServer,
  requireApproval,
  resultFile,
  writeResultFile = writeAnnotateResultFile,
  writeStdout: outputWriter = writeStdout,
  emitLegacyOutcome,
  exit = process.exit,
  logError = (message) => console.error(message),
}: CompleteAnnotateCommandOptions): Promise<void> {
  const result = await waitForDecision();
  await settleAfterDecision();
  stopServer();

  if (requireApproval || resultFile) {
    const serialized = serializeStrictAnnotateResult(result);
    try {
      if (resultFile) {
        await writeResultFile(resultFile, serialized);
      }
      await outputWriter(`${serialized}\n`);
    } catch (error) {
      // Publication failed: no decision record was delivered, so this is an
      // environment error ("the gate could not deliver a decision"), not a
      // reviewer outcome. Exit 2 — fail-closed, but distinct from exit 1's
      // "gate ran and the reviewer did not approve".
      logError(error instanceof Error ? error.message : String(error));
      exit(STRICT_GATE_ERROR_EXIT_CODE);
      return;
    }
    exit(annotateOutcomeExitCode(result, requireApproval));
    return;
  }

  emitLegacyOutcome(result);
  exit(0);
}
