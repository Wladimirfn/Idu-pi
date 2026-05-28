import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentRouter } from "../src/agent-router.js";
import type { AgentProfile } from "../src/config.js";
import {
	IDU_MODEL_ROLES,
	applySupervisorModelAssignment,
	formatModelAssignments,
	loadModelAssignments,
	profileForModelRole,
	saveModelAssignment,
} from "../src/model-assignments.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "idu-model-assignments-"));
}

const profiles: AgentProfile[] = testProfiles();

function testProfiles(): AgentProfile[] {
	return [
		{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		{
			id: "codex",
			label: "GPT Codex",
			provider: "pi",
			piArgs: ["--model", "openai-codex/gpt"],
		},
		{
			id: "review",
			label: "Review",
			provider: "pi",
			piArgs: ["--model", "openai-codex/review"],
		},
	];
}

test("model assignments default to empty versioned state", () => {
	const root = tempDir();
	try {
		const state = loadModelAssignments(root);
		assert.equal(state.version, 1);
		assert.deepEqual(state.assignments, {});
		assert.match(
			formatModelAssignments(state, profiles),
			/Supervisor principal.*inherit/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("model assignments save selected role and reject invalid profile", () => {
	const root = tempDir();
	try {
		const saved = saveModelAssignment(
			root,
			IDU_MODEL_ROLES[0].id,
			"codex",
			profiles,
		);
		assert.equal(saved.assignments[IDU_MODEL_ROLES[0].id], "codex");
		const json = JSON.parse(
			readFileSync(join(root, "model-assignments.json"), "utf8"),
		);
		assert.equal(json.assignments[IDU_MODEL_ROLES[0].id], "codex");
		assert.throws(
			() =>
				saveModelAssignment(root, IDU_MODEL_ROLES[1].id, "missing", profiles),
			/Perfil desconocido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor-main assignment selects router active profile when valid", () => {
	const stateRoot = tempDir();
	const profiles = testProfiles();
	saveModelAssignment(stateRoot, "supervisor-main", "review", profiles);
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles,
		defaultProjectId: "project",
		defaultCwd: stateRoot,
	});

	const result = applySupervisorModelAssignment(
		router,
		loadModelAssignments(stateRoot),
		profiles,
	);

	assert.equal(result.source, "assigned");
	assert.equal(router.activeProfile().id, "review");
});

test("missing assigned profile falls back without changing active profile", () => {
	const profiles = testProfiles();
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles,
		defaultProjectId: "project",
		defaultCwd: tempDir(),
	});
	const result = applySupervisorModelAssignment(
		router,
		{ version: 1, assignments: { "supervisor-main": "missing" } },
		profiles,
	);

	assert.equal(result.source, "missing");
	assert.equal(router.activeProfile().id, "default");
});

test("profileForModelRole reports assigned and fallback sources", () => {
	const profiles = testProfiles();
	assert.deepEqual(
		profileForModelRole(
			{ version: 1, assignments: { "agentlab-security": "review" } },
			"agentlab-security",
			profiles,
		)?.source,
		"assigned",
	);
	assert.equal(
		profileForModelRole(
			{ version: 1, assignments: { "agentlab-security": "missing" } },
			"agentlab-security",
			profiles,
		)?.source,
		"missing",
	);
	assert.equal(
		profileForModelRole(
			{ version: 1, assignments: {} },
			"agentlab-security",
			profiles,
		),
		undefined,
	);
});

test("model assignments backup existing file before overwrite", () => {
	const root = tempDir();
	try {
		writeFileSync(
			join(root, "model-assignments.json"),
			JSON.stringify({
				version: 1,
				assignments: { "supervisor-main": "default" },
			}),
			"utf8",
		);
		const saved = saveModelAssignment(
			root,
			"agentlab-general",
			"codex",
			profiles,
		);
		assert.equal(saved.assignments["agentlab-general"], "codex");
		assert.ok(saved.backupPath);
		assert.match(
			readFileSync(saved.backupPath ?? "", "utf8"),
			/supervisor-main/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
