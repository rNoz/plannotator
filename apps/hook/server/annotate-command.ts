import {
  annotateOutcomeExitCode,
  serializeStrictAnnotateResult,
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
}: CompleteAnnotateCommandOptions): Promise<void> {
  const result = await waitForDecision();
  await settleAfterDecision();
  stopServer();

  if (requireApproval || resultFile) {
    const serialized = serializeStrictAnnotateResult(result);
    if (resultFile) {
      await writeResultFile(resultFile, serialized);
    }
    await outputWriter(`${serialized}\n`);
    exit(annotateOutcomeExitCode(result, requireApproval));
    return;
  }

  emitLegacyOutcome(result);
  exit(0);
}
