import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import type { FindingStatus } from "../src/lab-db.js";

async function withTempDb(
	fn: (dbPath: string, repository: LabDbRepository) => void | Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "idu-pi-lab-repo-"));
	try {
		const dbPath = join(dir, "lab.db");
		await fn(dbPath, new LabDbRepository(dbPath));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("LabDbRepository initializes a temporary database", async () => {
	await withTempDb((dbPath, repository) => {
		const result = repository.init();

		assert.equal(result.dbPath, dbPath);
		assert.equal(result.created, true);
		assert.equal(existsSync(dbPath), true);
	});
});

test("LabDbRepository init is idempotent", async () => {
	await withTempDb((_dbPath, repository) => {
		assert.equal(repository.init().created, true);
		assert.equal(repository.init().created, false);
	});
});

test("LabDbRepository records and lists open findings", async () => {
	await withTempDb((_dbPath, repository) => {
		repository.recordBugFinding({
			id: "finding-1",
			projectId: "pi-telegram-bridge",
			title: "Corepack required",
			description: "pnpm is not directly available in PATH.",
			severity: "medium",
			confidence: "high",
			evidence: "corepack pnpm test passes",
			affectedFiles: ["package.json", "README.md"],
			dedupeKey: "corepack-required",
		});

		const findings = repository.listOpenFindings("pi-telegram-bridge");

		assert.equal(findings.length, 1);
		assert.equal(findings[0].id, "finding-1");
		assert.deepEqual(findings[0].affectedFiles, ["package.json", "README.md"]);
	});
});

test("LabDbRepository hides closed findings and returns open statuses", async () => {
	await withTempDb((_dbPath, repository) => {
		const statuses: FindingStatus[] = [
			"new",
			"triaged",
			"accepted",
			"deferred",
			"fixed",
			"ignored",
			"duplicate",
		];
		for (const status of statuses) {
			repository.recordBugFinding({
				id: `finding-${status}`,
				projectId: "pi-telegram-bridge",
				title: `Finding ${status}`,
				description: `Status ${status}`,
				severity: "low",
				confidence: "medium",
				status,
			});
		}

		const openStatuses = repository
			.listOpenFindings("pi-telegram-bridge")
			.map((finding) => finding.status)
			.sort();

		assert.deepEqual(openStatuses, ["accepted", "deferred", "new", "triaged"]);
	});
});
