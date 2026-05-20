import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatConfigDoctor,
	formatConfigOverview,
	formatInitAssetsResult,
	initProjectAssets,
	inspectProjectConfig,
} from "../src/config-wizard.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-config-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("inspectProjectConfig reports missing project-local assets", () => {
	const projectPath = tempDir();
	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot: join(projectPath, ".workspaces"),
		piArgs: ["--no-skill-registry", "--no-lens"],
		isGitRepo: false,
	});

	assert.equal(report.assets.skills.exists, false);
	assert.equal(report.assets.registry.exists, false);
	assert.equal(report.assets.mcp.exists, false);
	assert.equal(report.recommendedNext, "/config init_assets");
	assert.ok(
		report.warnings.some((warning) => warning.includes("No hay perfiles lab")),
	);
});

test("inspectProjectConfig reports existing project-local assets", () => {
	const projectPath = tempDir();
	initProjectAssets(projectPath);

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "codex", label: "Codex", provider: "pi", piArgs: [] },
		],
		activeProfileId: "codex",
		workspaceMode: "clone",
		workspaceRoot: join(projectPath, ".workspaces"),
		piArgs: [],
		isGitRepo: true,
	});

	assert.equal(report.assets.skills.exists, true);
	assert.equal(report.assets.registry.exists, true);
	assert.equal(report.assets.mcp.exists, true);
	assert.equal(report.recommendedNext, "/config doctor");
});

test("initProjectAssets creates missing assets without overwriting existing files", () => {
	const projectPath = tempDir();
	const existingRegistry = join(projectPath, ".atl", "skill-registry.md");
	const existingMcp = join(projectPath, ".mcp", "config.json");
	initProjectAssets(projectPath);
	writeFileSync(existingRegistry, "# custom registry\n", "utf8");
	writeFileSync(existingMcp, '{"enabled":true}\n', "utf8");

	const result = initProjectAssets(projectPath);

	assert.equal(readFileSync(existingRegistry, "utf8"), "# custom registry\n");
	assert.equal(readFileSync(existingMcp, "utf8"), '{"enabled":true}\n');
	assert.ok(result.existing.includes(".atl/skill-registry.md"));
	assert.ok(result.existing.includes(".mcp/config.json"));
	assert.equal(
		existsSync(join(projectPath, ".agents", "skills", ".gitkeep")),
		true,
	);
	assert.equal(existsSync(join(projectPath, ".mcp", "config.json")), true);
});

test("formatConfigOverview and formatConfigDoctor hide secrets and show next steps", () => {
	const projectPath = tempDir();
	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot: join(projectPath, ".workspaces"),
		piArgs: ["--no-skill-registry"],
		isGitRepo: false,
	});

	assert.match(
		formatConfigOverview(report),
		/Siguiente recomendado:\n\/config init_assets/,
	);
	assert.match(formatConfigDoctor(report), /Project-local assets/);
	assert.doesNotMatch(
		formatConfigDoctor(report),
		/TELEGRAM_BOT_TOKEN|replace_me|token/,
	);
	assert.match(
		formatInitAssetsResult(initProjectAssets(projectPath)),
		/Assets/,
	);
});
