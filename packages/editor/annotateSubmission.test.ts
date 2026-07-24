import { describe, expect, test } from "bun:test";
import { AnnotationType, type Annotation, type CodeAnnotation, type EditorAnnotation } from "@plannotator/ui/types";
import { parseMarkdownToBlocks, type LinkedDocAnnotationEntry } from "@plannotator/ui/utils/parser";
import {
  buildAnnotateApprovalBody,
  buildCompleteAnnotateFeedback,
  getAnnotateApprovalPolicy,
} from "./annotateSubmission";

describe("annotate approval submission", () => {
  test("includes notes only when the transport supports approval notes", () => {
    const input = {
      draftGeneration: 4,
      feedback: "Keep the retry bounded.",
      annotations: [{ id: "a1" }],
      codeAnnotations: [{ id: "c1" }],
    };

    expect(buildAnnotateApprovalBody({ supported: true, ...input })).toEqual(input);
    expect(buildAnnotateApprovalBody({ supported: false, ...input })).toEqual({
      draftGeneration: 4,
    });
  });

  test("labels capable feedback approvals and requires a non-blocking confirmation", () => {
    expect(getAnnotateApprovalPolicy({
      gate: true,
      approvalNotesSupported: true,
      hasFeedback: true,
    })).toEqual({
      label: "Approve with Notes",
      title: "Approve with Notes — send notes as non-blocking guidance",
      confirmation: {
        title: "Approve with Notes?",
        message: "This approves the artifact, sends your notes as non-blocking guidance, and closes the gate. Unlike Send Feedback, it does not request changes.",
        confirmText: "Approve with Notes",
      },
    });
  });

  test("keeps ordinary approval presentation when notes are absent or unsupported", () => {
    expect(getAnnotateApprovalPolicy({
      gate: true,
      approvalNotesSupported: true,
      hasFeedback: false,
    })).toEqual({
      label: "Approve",
      title: "Approve — no changes requested",
      confirmation: null,
    });
    expect(getAnnotateApprovalPolicy({
      gate: true,
      approvalNotesSupported: false,
      hasFeedback: true,
    })).toEqual({
      label: "Approve",
      title: "Approve — no changes requested",
      confirmation: null,
    });
  });

  test("composes every annotate feedback source into approval notes", () => {
    const markdown = "# Retry\n\nRetry forever.";
    const blocks = parseMarkdownToBlocks(markdown);
    const paragraph = blocks.find((block) => block.type === "paragraph");
    if (!paragraph) throw new Error("expected paragraph block");

    const annotation: Annotation = {
      id: "a1",
      blockId: paragraph.id,
      startOffset: 0,
      endOffset: 5,
      type: AnnotationType.COMMENT,
      text: "Keep the retry bounded.",
      originalText: "Retry",
      createdA: 1,
      images: [{ path: "/tmp/retry.png", name: "retry-diagram" }],
    };
    const linkedAnnotation: Annotation = {
      ...annotation,
      id: "linked-1",
      text: "Update the linked runbook.",
      originalText: "Runbook",
      images: undefined,
    };
    const linkedDocuments = new Map<string, LinkedDocAnnotationEntry>([
      ["/docs/runbook.md", {
        annotations: [linkedAnnotation],
        globalAttachments: [],
        markdown: "# Runbook\n\nRunbook",
      }],
    ]);
    const codeAnnotation: CodeAnnotation = {
      id: "c1",
      type: "comment",
      filePath: "src/retry.ts",
      lineStart: 8,
      lineEnd: 8,
      side: "new",
      text: "Cap this loop.",
      originalCode: "while (true)",
      createdAt: 1,
    };
    const editorAnnotation: EditorAnnotation = {
      id: "e1",
      filePath: "src/config.ts",
      selectedText: "MAX_RETRIES",
      lineStart: 3,
      lineEnd: 3,
      comment: "Make the limit configurable.",
      createdAt: 1,
    };

    const feedback = buildCompleteAnnotateFeedback({
      blocks,
      annotations: [annotation],
      globalAttachments: [{ path: "/tmp/global.png", name: "global-reference" }],
      linkedDocuments,
      editorAnnotations: [editorAnnotation],
      codeAnnotations: [codeAnnotation],
      title: "File Feedback",
      subject: "file",
      sourceConverted: false,
      directEditsSection: "# Direct Edits\n\nBound the retry loop.",
      savedFileChangesSection: "# Saved File Changes\n\n## /docs/retry.md",
    });

    expect(feedback).toContain("retry-diagram");
    expect(feedback).toContain("global-reference");
    expect(feedback).toContain("# Code File Feedback");
    expect(feedback).toContain("# Direct Edits");
    expect(feedback).toContain("# Linked Document Feedback");
    expect(feedback).toContain("# Editor File Annotations");
    expect(feedback).toContain("# Saved File Changes");

    expect(buildAnnotateApprovalBody({
      supported: true,
      draftGeneration: 4,
      feedback,
      annotations: [annotation],
      codeAnnotations: [codeAnnotation],
    })).toMatchObject({
      draftGeneration: 4,
      feedback,
      annotations: [annotation],
      codeAnnotations: [codeAnnotation],
    });
  });
});
