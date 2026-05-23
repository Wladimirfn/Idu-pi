import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	formatIduSessionStatus,
	getIduSessionStatus,
	resolveIduSessionStatePath,
	shouldUseAutomaticGuardrails,
} from "../src/idu-session.js";

async function withTempWorkspace(
	fn: (workspaceRoot: string) => void | Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "idu-session-"));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("shouldUseAutomaticGuardrails is false by default", async () => {
	await withTempWorkspace((workspaceRoot) => {
		configureIduSessionStore({ workspaceRoot });

		assert.equal(shouldUseAutomaticGuardrails("demo"), false);
		assert.equal(getIduSessionStatus("demo").active, false);
		assert.equal(existsSync(resolveIduSessionStatePath(workspaceRoot)), false);
	});
});

test("/idu activation enables automatic guardrails and persists per project", async () => {
	await withTempWorkspace((workspaceRoot) => {
		const now = () => new Date("2026-05-22T12:00:00.000Z");
		configureIduSessionStore({ workspaceRoot, now });

		const status = activateIduSession("demo");

		assert.equal(status.active, true);
		assert.equal(status.projectId, "demo");
		assert.equal(status.activatedAt, "2026-05-22T12:00:00.000Z");
		assert.equal(shouldUseAutomaticGuardrails("demo"), true);
		assert.equal(shouldUseAutomaticGuardrails("other"), false);
		assert.equal(
			existsSync(join(workspaceRoot, "reports", "idu-session-state.json")),
			true,
		);
		assert.doesNotMatch(
			readFileSync(
				join(workspaceRoot, "reports", "idu-session-state.json"),
				"utf8",
			),
			/token|secret|password/iu,
		);
	});
});

test("/idu_off disables automatic guardrails", async () => {
	await withTempWorkspace((workspaceRoot) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("demo");

		const status = deactivateIduSession("demo");

		assert.equal(status.active, false);
		assert.equal(shouldUseAutomaticGuardrails("demo"), false);
	});
});

test("Idu session state survives store reconstruction", async () => {
	await withTempWorkspace((workspaceRoot) => {
		configureIduSessionStore({
			workspaceRoot,
			now: () => new Date("2026-05-22T12:00:00.000Z"),
		});
		activateIduSession("demo");
		configureIduSessionStore({ workspaceRoot });

		const status = getIduSessionStatus("demo");

		assert.equal(shouldUseAutomaticGuardrails("demo"), true);
		assert.equal(status.active, true);
		assert.equal(status.activatedAt, "2026-05-22T12:00:00.000Z");
	});
});

test("resolveIduSessionStatePath is the shared reports path", async () => {
	await withTempWorkspace((workspaceRoot) => {
		assert.equal(
			resolveIduSessionStatePath(workspaceRoot),
			join(workspaceRoot, "reports", "idu-session-state.json"),
		);
	});
});

test("/idu_status rereads state from disk without cache", async () => {
	await withTempWorkspace((workspaceRoot) => {
		const statePath = resolveIduSessionStatePath(workspaceRoot);
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("demo");
		writeFileSync(
			statePath,
			`${JSON.stringify(
				{
					version: 1,
					projects: {
						demo: {
							projectId: "demo",
							active: false,
							activatedAt: "2026-05-22T12:00:00.000Z",
							updatedAt: "2026-05-22T12:01:00.000Z",
							guardrails: "automatic",
						},
					},
				},
				null,
				"\t",
			)}\n`,
		);

		assert.equal(getIduSessionStatus("demo").active, false);
		assert.equal(shouldUseAutomaticGuardrails("demo"), false);
	});
});

test("CLI and Telegram style stores share the same state path", async () => {
	await withTempWorkspace((workspaceRoot) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("demo");
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("demo").active, true);

		deactivateIduSession("demo");
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("demo").active, false);

		activateIduSession("demo");
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("demo").active, true);

		deactivateIduSession("demo");
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("demo").active, false);
		assert.equal(
			getIduSessionStatus("demo").sessionStatePath,
			resolveIduSessionStatePath(workspaceRoot),
		);
	});
});

test("idu status output shows workspaceRoot and sessionStatePath", async () => {
	await withTempWorkspace((workspaceRoot) => {
		configureIduSessionStore({ workspaceRoot });

		const text = formatIduSessionStatus(getIduSessionStatus("demo"));

		assert.match(text, /workspaceRoot:/u);
		assert.match(text, new RegExp(escapeRegExp(workspaceRoot), "u"));
		assert.match(text, /sessionStatePath:/u);
		assert.match(
			text,
			new RegExp(escapeRegExp(resolveIduSessionStatePath(workspaceRoot)), "u"),
		);
	});
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
