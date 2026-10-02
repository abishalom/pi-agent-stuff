import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFileReferencesFromEntry, collectSessionFileChanges } from "../../pi-extension/mitsupi/files.ts";

test("/files tolerates Pi messages without a content field", () => {
 assert.deepEqual(extractFileReferencesFromEntry({ type: "message", message: {
  role: "bashExecution", command: "pwd", output: "/tmp", exitCode: 0,
  cancelled: false, truncated: false, timestamp: 42,
 } }), []);
});

test("/files consumes available nested paths, including reads, but marks only successful mutations", () => {
 const cwd = mkdtempSync(join(tmpdir(), "files-nested-"));
 try {
  for (const file of ["read.txt", "edit.txt", "write.txt", "failed.txt", "unfinished.txt"]) writeFileSync(join(cwd, file), "text");
  const entry = { type: "message", message: { role: "toolResult", toolCallId: "p", toolName: "codemode", content: [], timestamp: 42, isError: true,
   nestedCalls: { complete: false, calls: [
    { id: "p/1", name: "read", arguments: { path: "read.txt" }, status: "ok" },
    { id: "p/2", name: "edit", arguments: { path: "edit.txt" }, status: "ok" },
    { id: "p/3/1", name: "write", arguments: { path: "write.txt" }, status: "ok" },
    { id: "p/4", name: "edit", arguments: { path: "failed.txt" }, status: "error" },
    { id: "p/5", name: "write", arguments: { path: "unfinished.txt" }, status: "unfinished" },
    { id: "p/6", name: "write", argumentsBytes: 9000, status: "ok" },
   ] },
  } };
  assert.deepEqual(extractFileReferencesFromEntry(entry), ["read.txt", "edit.txt", "write.txt", "failed.txt", "unfinished.txt"]);
  const changes = collectSessionFileChanges([entry], cwd);
  assert.deepEqual([...changes.keys()], [join(cwd, "edit.txt"), join(cwd, "write.txt")]);
  assert.deepEqual([...changes.get(join(cwd, "write.txt")).operations], ["write"]);
  assert.equal(changes.get(join(cwd, "edit.txt")).lastTimestamp, 42);
  assert.equal(collectSessionFileChanges([], cwd).size, 0);
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});
