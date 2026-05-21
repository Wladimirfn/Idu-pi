import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ProjectRegistry } from "../src/projects.js";
import { inspectProjectConnection } from "../src/project-connection.js";

const tempRoots: string[] = [];

function tempDir(prefix = "idu-connection-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function registry(
	projectPath: string,
	activeProjectId = "demo",
): ProjectRegistry {
	return {
		activeProjectId,
		projects: [{ id: "demo", name: "Demo", path: projectPath }],
	};
}

function inspect(options: {
	registry: ProjectRegistry;
	allowedRoots?: string[];
	workspaceRoot?: string;
	projectId?: string;
}) {
	const defaultCwd = tempDir("idu-default-");
	return inspectProjectConnection({
		defaultCwd,
		allowedRoots: options.allowedRoots ?? [defaultCwd],
		workspaceRoot: options.workspaceRoot ?? tempDir("idu-workspace-"),
		registry: options.registry,
		...(options.projectId ? { projectId: options.projectId } : {}),
	});
}

function writeProjectConfig(projectPath: string): void {
	mkdirSync(join(projectPath, "config"), { recursive: true });
	cpSync(
		"config/default-blueprint.json",
		join(projectPath, "config", "project-blueprint.json"),
	);
	cpSync(
		"config/default-flows.json",
		join(projectPath, "config", "project-flows.json"),
	);
}

test("not_connected if there are no projects", () => {
	const report = inspect({
		registry: { activeProjectId: null, projects: [] },
	});

	assert.equal(report.status, "not_connected");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.equal(report.recommendedNext, "/addproject <id> <ruta>");
});

test("unknown_project if requested projectId does not exist", () => {
	const projectPath = tempDir();
	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		projectId: "missing",
	});

	assert.equal(report.status, "unknown_project");
	assert.equal(report.projectId, "missing");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.recommendedNext, "/useproject <id>");
});

test("broken_connection if project path does not exist", () => {
	const root = tempDir();
	const missingPath = join(root, "missing");
	const report = inspect({
		registry: registry(missingPath),
		allowedRoots: [root],
	});

	assert.equal(report.status, "broken_connection");
	assert.match(report.problems.join("\n"), /ruta.*no existe/i);
	assert.equal(report.recommendedNext, "/addproject <id> <ruta>");
});

test("broken_connection if project path is outside allowed roots", () => {
	const allowedRoot = tempDir("idu-allowed-");
	const outsideRoot = tempDir("idu-outside-");
	const report = inspect({
		registry: registry(outsideRoot),
		allowedRoots: [allowedRoot],
	});

	assert.equal(report.status, "broken_connection");
	assert.match(report.problems.join("\n"), /fuera de ALLOWED_ROOTS/);
	assert.equal(report.recommendedNext, "/useproject <id>");
});

test("needs_understanding if project-local configs are missing", () => {
	const projectPath = tempDir();
	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
	});

	assert.equal(report.status, "needs_understanding");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.match(report.problems.join("\n"), /project-blueprint/);
	assert.match(report.problems.join("\n"), /project-flows/);
	assert.equal(report.recommendedNext, "/config init_project_config");
});

test("ready if local blueprint and flows are valid", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	mkdirSync(join(workspaceRoot, "reports"), { recursive: true });
	writeProjectConfig(projectPath);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(report.status, "ready");
	assert.equal(report.safeToOperate, true);
	assert.equal(report.needsUserConfirmation, false);
	assert.equal(report.recommendedNext, "listo para operar");
});

test("warnings if reports directory does not exist", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	writeProjectConfig(projectPath);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(report.status, "ready");
	assert.match(report.warnings.join("\n"), /reports/);
	assert.equal(report.safeToOperate, true);
});

test("connected if local configs exist but are invalid", () => {
	const projectPath = tempDir();
	mkdirSync(join(projectPath, "config"), { recursive: true });
	writeFileSync(join(projectPath, "config", "project-blueprint.json"), "{}\n");
	writeFileSync(join(projectPath, "config", "project-flows.json"), "{}\n");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
	});

	assert.equal(report.status, "connected");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.equal(report.recommendedNext, "/config inspect_project_map");
});

test("inspectProjectConnection does not write files", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	rmSync(workspaceRoot, { recursive: true, force: true });

	inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(existsSync(workspaceRoot), false);
	assert.equal(existsSync(join(projectPath, "config")), false);
});
