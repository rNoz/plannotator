import { describe, expect, test } from "bun:test";
import { completeAnnotateCommand } from "./annotate-command";
import type { AnnotateOutcome } from "./strict-annotate-result";

interface RunResult {
  events: string[];
  stdout: string[];
  resultBytes: string[];
  legacy: AnnotateOutcome[];
}

async function runCompletion(
  outcome: AnnotateOutcome,
  options: {
    requireApproval?: boolean;
    resultFile?: string;
    resultWriter?: (path: string, serialized: string) => Promise<void>;
  } = {},
): Promise<RunResult> {
  const events: string[] = [];
  const stdout: string[] = [];
  const resultBytes: string[] = [];
  const legacy: AnnotateOutcome[] = [];

  await completeAnnotateCommand({
    waitForDecision: async () => {
      events.push("decision");
      return outcome;
    },
    settleAfterDecision: async () => {
      events.push("settle");
    },
    stopServer: () => {
      events.push("stop");
    },
    requireApproval: options.requireApproval ?? false,
    resultFile: options.resultFile,
    writeResultFile:
      options.resultWriter ??
      (async (_path, serialized) => {
        events.push("result");
        resultBytes.push(`${serialized}\n`);
      }),
    writeStdout: async (bytes) => {
      events.push("stdout");
      stdout.push(bytes);
    },
    emitLegacyOutcome: (result) => {
      events.push("legacy");
      legacy.push(result);
    },
    exit: (code) => {
      events.push(`exit:${code}`);
    },
  });

  return { events, stdout, resultBytes, legacy };
}

describe("completeAnnotateCommand", () => {
  test("publishes approved feedback to matching stdout and result bytes", async () => {
    const result = await runCompletion(
      {
        approved: true,
        feedback: "Keep the cache bounded.",
      },
      {
        requireApproval: true,
        resultFile: "/result.json",
      },
    );

    const expected =
      '{"decision":"approved","feedback":"Keep the cache bounded."}\n';
    expect(result.resultBytes).toEqual([expected]);
    expect(result.stdout).toEqual([expected]);
    expect(result.events).toEqual([
      "decision",
      "settle",
      "stop",
      "result",
      "stdout",
      "exit:0",
    ]);
  });

  test("publishes annotated and dismissed decisions before nonzero exit", async () => {
    const annotated = await runCompletion(
      { approved: false, exit: false, feedback: "revise" },
      { requireApproval: true, resultFile: "/annotated.json" },
    );
    const dismissed = await runCompletion(
      { exit: true, feedback: "" },
      { requireApproval: true, resultFile: "/dismissed.json" },
    );

    expect(annotated.stdout).toEqual([
      '{"decision":"annotated","feedback":"revise"}\n',
    ]);
    expect(annotated.resultBytes).toEqual(annotated.stdout);
    expect(annotated.events.slice(-3)).toEqual([
      "result",
      "stdout",
      "exit:1",
    ]);
    expect(dismissed.stdout).toEqual([
      '{"decision":"dismissed"}\n',
    ]);
    expect(dismissed.resultBytes).toEqual(dismissed.stdout);
    expect(dismissed.events.slice(-3)).toEqual([
      "result",
      "stdout",
      "exit:1",
    ]);
  });

  test("delegates legacy output unchanged and exits zero", async () => {
    const outcome = { exit: false, feedback: "legacy feedback" };
    const result = await runCompletion(outcome);

    expect(result.legacy).toEqual([outcome]);
    expect(result.stdout).toEqual([]);
    expect(result.resultBytes).toEqual([]);
    expect(result.events.slice(-2)).toEqual(["legacy", "exit:0"]);
  });

  test("supports each strict option independently", async () => {
    const resultFileOnly = await runCompletion(
      { approved: false, feedback: "revise" },
      { resultFile: "/result.json" },
    );
    const approvalOnly = await runCompletion(
      { exit: true, feedback: "" },
      { requireApproval: true },
    );

    expect(resultFileOnly.events.slice(-3)).toEqual([
      "result",
      "stdout",
      "exit:0",
    ]);
    expect(resultFileOnly.resultBytes).toEqual(resultFileOnly.stdout);
    expect(approvalOnly.events.slice(-2)).toEqual(["stdout", "exit:1"]);
    expect(approvalOnly.resultBytes).toEqual([]);
  });

  test("does not emit stdout or exit when result publication fails", async () => {
    const events: string[] = [];

    await expect(
      completeAnnotateCommand({
        waitForDecision: async () => ({
          approved: false,
          feedback: "revise",
        }),
        settleAfterDecision: async () => {},
        stopServer: () => {},
        requireApproval: true,
        resultFile: "/raced.json",
        writeResultFile: async () => {
          events.push("result");
          throw new Error("destination appeared");
        },
        writeStdout: async () => {
          events.push("stdout");
        },
        emitLegacyOutcome: () => {
          events.push("legacy");
        },
        exit: (code) => {
          events.push(`exit:${code}`);
        },
      }),
    ).rejects.toThrow("destination appeared");

    expect(events).toEqual(["result"]);
  });
});
