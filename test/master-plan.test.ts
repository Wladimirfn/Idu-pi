import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
	approveMasterPlan,
	ensureMasterPlanForIdu,
	formatMasterPlanReview,
	formatMasterPlanSummaryForIdu,
	generateMasterPlanDraft,
	getMasterPlanStatus,
	redraftMasterPlan,
	rejectMasterPlan,
	reviewMasterPlan,
} from "../src/master-plan.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-master-plan-"));
}

function writeSmallProject(projectPath: string): void {
	mkdirSync(join(projectPath, "src"), { recursive: true });
	writeFileSync(
		join(projectPath, "README.md"),
		"# Demo\n\nSmall project.\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "index.ts"),
		"export const ok = true;\n",
		"utf8",
	);
}

function writeStandardProject(projectPath: string): void {
	mkdirSync(join(projectPath, "src", "ui"), { recursive: true });
	mkdirSync(join(projectPath, "db"), { recursive: true });
	writeFileSync(
		join(projectPath, "package.json"),
		JSON.stringify({
			dependencies: { express: "1.0.0", sqlite3: "1.0.0", react: "1.0.0" },
		}),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "ui", "login.html"),
		"<form id='login'></form>",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "db", "schema.sql"),
		"create table users(id int);",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "auth.ts"),
		"export const login = () => true;",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "app.ts"),
		"export const app = () => true;",
		"utf8",
	);
}

function writeLargeProject(projectPath: string): void {
	writeStandardProject(projectPath);
	for (let index = 0; index < 130; index += 1) {
		const dir = join(projectPath, "src", `module-${index}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `file-${index}.ts`),
			"export const value = 'auth db security';\n",
			"utf8",
		);
	}
}

function listRelativeFiles(root: string): string[] {
	const files: string[] = [];
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else files.push(relative(root, path).replace(/\\/gu, "/"));
		}
	}
	walk(root);
	return files.sort();
}

function writeBrokenDirectoryLink(linkPath: string, targetPath: string): void {
	try {
		symlinkSync(targetPath, linkPath, "dir");
	} catch (error) {
		if (process.platform !== "win32") throw error;
		mkdirSync(targetPath, { recursive: true });
		execFileSync("cmd.exe", ["/c", "mklink", "/J", linkPath, targetPath]);
		rmSync(targetPath, { recursive: true, force: true });
	}
}

test("genera Plan Maestro draft en stateRoot/reports sin modificar repo del usuario", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const before = listRelativeFiles(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "abc123",
		});

		assert.equal(result.plan.status, "draft");
		assert.equal(result.plan.autoDepth.mode, "quick");
		assert.equal(
			existsSync(join(stateRoot, result.current.currentPlanJson)),
			true,
		);
		assert.equal(
			existsSync(join(stateRoot, result.current.currentPlanMd)),
			true,
		);
		assert.equal(existsSync(join(stateRoot, "master-plan.current.json")), true);
		assert.equal(existsSync(join(stateRoot, "master-plan.memory.json")), true);
		assert.match(
			result.current.currentPlanJson,
			/reports[\\/]master-plan-.*\.json$/u,
		);
		assert.match(
			readFileSync(join(stateRoot, result.current.currentPlanMd), "utf8"),
			/# Plan Maestro Idu-pi/u,
		);
		assert.deepEqual(listRelativeFiles(projectPath), before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Plan Maestro ignora links rotos durante escaneo del proyecto", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, ".adal", "skills"), { recursive: true });
		writeSmallProject(projectPath);
		writeBrokenDirectoryLink(
			join(projectPath, ".adal", "skills", "supabase"),
			join(projectPath, ".agents", "skills", "supabase"),
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.status, "draft");
		assert.equal(existsSync(join(stateRoot, "master-plan.current.json")), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("AutoDepth elige standard para proyecto mediano con DB UI y auth", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeStandardProject(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.autoDepth.mode, "standard");
		assert.ok(result.plan.autoDepth.agentLabsSelected.includes("security"));
		assert.ok(result.plan.autoDepth.agentLabsSelected.includes("database"));
		assert.ok(result.plan.autoDepth.agentLabsSelected.length <= 3);
		assert.ok(
			result.plan.agentLabReviews.every(
				(review) => review.status === "not_run" || review.status === "skipped",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("AutoDepth elige deep_required para proyecto grande y no ejecuta AgentLabs", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeLargeProject(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.autoDepth.mode, "deep_required");
		assert.ok(result.plan.autoDepth.skippedAgentLabs.length >= 1);
		assert.ok(
			result.plan.agentLabReviews.every(
				(review) => review.status === "not_run" || review.status === "skipped",
			),
		);
		assert.match(result.plan.recommendedNext.join("\n"), /deep review/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("approve reject y redraft actualizan current sin borrar drafts anteriores", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const first = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		const approved = approveMasterPlan({
			stateRoot,
			pathOrLatest: "latest",
			source: "cli",
		});
		assert.equal(approved.plan.status, "approved");
		assert.equal(approved.current.status, "approved");
		assert.equal(approved.plan.approval?.source, "cli");

		const rejected = rejectMasterPlan({
			stateRoot,
			pathOrLatest: "latest",
			reason: "objetivo incompleto",
		});
		assert.equal(rejected.plan.status, "rejected");
		assert.equal(rejected.plan.approval?.reason, "objetivo incompleto");

		const second = redraftMasterPlan({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head2",
			reason: "rehacer",
		});
		assert.notEqual(
			second.current.currentPlanJson,
			first.current.currentPlanJson,
		);
		assert.equal(
			existsSync(join(stateRoot, first.current.currentPlanJson)),
			true,
		);
		assert.equal(second.plan.status, "draft");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status detecta approved vigente y marca stale si gitHead cambia", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "same",
		});
		approveMasterPlan({ stateRoot, pathOrLatest: "latest", source: "cli" });

		const current = getMasterPlanStatus({ stateRoot, currentGitHead: "same" });
		assert.equal(current.status, "approved");
		const stale = getMasterPlanStatus({ stateRoot, currentGitHead: "changed" });
		assert.equal(stale.status, "stale");
		assert.equal(
			JSON.parse(
				readFileSync(join(stateRoot, "master-plan.current.json"), "utf8"),
			).status,
			"stale",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review rechaza rutas fuera de stateRoot", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		const sibling = join(root, "state", "projects", "demo-evil");
		mkdirSync(projectPath, { recursive: true });
		mkdirSync(sibling, { recursive: true });
		writeSmallProject(projectPath);
		generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		writeFileSync(join(sibling, "escape.json"), "{}", "utf8");

		assert.throws(
			() =>
				reviewMasterPlan({
					stateRoot,
					pathOrLatest: join(sibling, "escape.json"),
				}),
			/Master Plan fuera de stateRoot/u,
		);

		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "../demo-evil/escape.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		assert.throws(
			() => reviewMasterPlan({ stateRoot, pathOrLatest: "latest" }),
			/Master Plan fuera de stateRoot/u,
		);
		assert.throws(
			() =>
				approveMasterPlan({ stateRoot, pathOrLatest: "latest", source: "cli" }),
			/Master Plan fuera de stateRoot/u,
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "reports/master-plan.md",
				status: "approved",
				projectId: "demo",
				projectPath,
				gitHead: "old-head",
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		assert.throws(
			() => getMasterPlanStatus({ stateRoot, currentGitHead: "new-head" }),
			/Master Plan fuera de stateRoot/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("memory es liviano y review/summary son humanos", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeStandardProject(projectPath);
		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const memory = JSON.parse(
			readFileSync(join(stateRoot, "master-plan.memory.json"), "utf8"),
		) as Record<string, unknown>;
		assert.equal(memory.currentPlanJson, result.current.currentPlanJson);
		assert.equal("detectedModules" in memory, false);
		assert.equal("detectedFlows" in memory, false);
		assert.ok(
			JSON.stringify(memory).length < JSON.stringify(result.plan).length / 2,
		);

		const review = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		assert.match(formatMasterPlanReview(review), /Plan Maestro Idu-pi/u);
		assert.match(formatMasterPlanSummaryForIdu(result), /AutoDepth:/u);
		assert.match(
			formatMasterPlanSummaryForIdu(result),
			/master-plan-review latest/u,
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "reports/master-plan.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		assert.throws(
			() =>
				ensureMasterPlanForIdu({
					projectId: "demo",
					projectPath,
					stateRoot,
					gitHead: "head1",
				}),
			/Master Plan fuera de stateRoot/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
