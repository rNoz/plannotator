import { afterEach, describe, expect, test } from "bun:test";
import {
  link,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  annotateOutcomeExitCode,
  assertResultPathAvailable,
  resolveResultFilePath,
  serializeStrictAnnotateResult,
  writeAnnotateResultFile,
} from "./strict-annotate-result";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "plannotator-result-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("strict annotate result serialization", () => {
  test("serializes approval without feedback", () => {
    expect(
      serializeStrictAnnotateResult({ approved: true, feedback: "" }),
    ).toBe('{"decision":"approved"}');
  });

  test("serializes approval with feedback", () => {
    expect(
      serializeStrictAnnotateResult({
        approved: true,
        feedback: "Keep the cache bounded.",
      }),
    ).toBe(
      '{"decision":"approved","feedback":"Keep the cache bounded."}',
    );
  });

  test("serializes annotated and dismissed decisions", () => {
    expect(
      serializeStrictAnnotateResult({
        approved: false,
        exit: false,
        feedback: "revise",
      }),
    ).toBe('{"decision":"annotated","feedback":"revise"}');
    expect(
      serializeStrictAnnotateResult({ exit: true, feedback: "" }),
    ).toBe('{"decision":"dismissed"}');
  });
});

describe("strict annotate exit policy", () => {
  test("requires approval when requested", () => {
    expect(
      annotateOutcomeExitCode(
        { approved: false, exit: false, feedback: "revise" },
        true,
      ),
    ).toBe(1);
    expect(
      annotateOutcomeExitCode({ approved: true, feedback: "" }, true),
    ).toBe(0);
  });

  test("keeps legacy outcomes successful", () => {
    expect(
      annotateOutcomeExitCode({ exit: true, feedback: "" }, false),
    ).toBe(0);
  });
});

describe("atomic annotate result publication", () => {
  test("resolves relative result paths from the invocation directory", () => {
    expect(
      resolveResultFilePath("results/review.json", "/workspace/project"),
    ).toBe("/workspace/project/results/review.json");
    expect(
      resolveResultFilePath("/var/tmp/review.json", "/workspace/project"),
    ).toBe("/var/tmp/review.json");
  });

  test("publishes one complete private newline-terminated record", async () => {
    const directory = await makeTemporaryDirectory();
    const resultFile = join(directory, "result.json");

    await assertResultPathAvailable(resultFile);
    await writeAnnotateResultFile(
      resultFile,
      '{"decision":"approved"}',
    );

    expect(await readFile(resultFile, "utf8")).toBe(
      '{"decision":"approved"}\n',
    );
    if (process.platform !== "win32") {
      expect((await stat(resultFile)).mode & 0o077).toBe(0);
    }
    expect(await readdir(directory)).toEqual(["result.json"]);
  });

  test("rejects a missing parent and an existing destination", async () => {
    const directory = await makeTemporaryDirectory();
    const missingParentResult = join(directory, "missing", "result.json");
    const existingResult = join(directory, "existing.json");
    await writeFile(existingResult, "existing", "utf8");

    await expect(
      assertResultPathAvailable(missingParentResult),
    ).rejects.toThrow(
      `Result file parent does not exist: ${join(directory, "missing")}`,
    );
    await expect(
      assertResultPathAvailable(existingResult),
    ).rejects.toThrow(`Result file already exists: ${existingResult}`);
    expect(await readdir(directory)).toEqual(["existing.json"]);
  });

  test.skipIf(process.platform === "win32")(
    "rejects a dangling destination symlink before startup",
    async () => {
      const directory = await makeTemporaryDirectory();
      const resultFile = join(directory, "result.json");
      await symlink(join(directory, "missing-target"), resultFile);

      await expect(
        assertResultPathAvailable(resultFile),
      ).rejects.toThrow(`Result file already exists: ${resultFile}`);
    },
  );

  test("never overwrites a destination created after validation", async () => {
    const directory = await makeTemporaryDirectory();
    const resultFile = join(directory, "result.json");
    await assertResultPathAvailable(resultFile);
    await writeFile(resultFile, "raced", { mode: 0o600 });

    await expect(
      writeAnnotateResultFile(
        resultFile,
        '{"decision":"approved"}',
      ),
    ).rejects.toThrow();

    expect(await readFile(resultFile, "utf8")).toBe("raced");
    expect(await readdir(directory)).toEqual(["result.json"]);
  });

  test("removes the temporary file when writing fails", async () => {
    const directory = await makeTemporaryDirectory();
    const resultFile = join(directory, "result.json");

    await expect(
      writeAnnotateResultFile(
        resultFile,
        '{"decision":"approved"}',
        {
          open,
          link,
          unlink,
          write: async () => {
            throw new Error("write failed");
          },
        },
      ),
    ).rejects.toThrow("write failed");

    expect(await readdir(directory)).toEqual([]);
  });

  test("fails closed when hard-link publication is unavailable", async () => {
    const directory = await makeTemporaryDirectory();
    const resultFile = join(directory, "result.json");

    await expect(
      writeAnnotateResultFile(
        resultFile,
        '{"decision":"approved"}',
        {
          open,
          link: async () => {
            throw new Error("hard links unavailable");
          },
          unlink,
          write: (handle, contents) => handle.writeFile(contents, "utf8"),
        },
      ),
    ).rejects.toThrow("hard links unavailable");

    expect(await readdir(directory)).toEqual([]);
  });
});
