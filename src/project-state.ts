import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type ProjectStatePaths = {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	labDbPath: string;
	taskQueuePath: string;
	sessionStatePath: string;
	semanticAuditDir: string;
	learningRulesPath: string;
	agentLabReportsDir: string;
	workspacesDir: string;
};

export type ResolveProjectStatePathsInput = {
	workspaceRoot: string;
	projectId: string;
	projectPath: string;
};

export function safeProjectStateId(input: string): string {
	const normalized = input
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/(?:^[-._]+|[-._]+$)/gu, "");
	return normalized || "project";
}

export function resolveProjectStatePaths(
	input: ResolveProjectStatePathsInput,
): ProjectStatePaths {
	const projectId = safeProjectStateId(input.projectId);
	const workspaceRoot = resolve(input.workspaceRoot);
	const stateRoot = join(workspaceRoot, "projects", projectId);
	const reportsDir = join(stateRoot, "reports");
	return {
		projectId,
		projectPath: resolve(input.projectPath),
		stateRoot,
		reportsDir,
		labDbPath: join(stateRoot, "lab.db"),
		taskQueuePath: join(stateRoot, "tasks.jsonl"),
		sessionStatePath: join(stateRoot, "idu-session-state.json"),
		semanticAuditDir: join(stateRoot, "semantic-audit"),
		learningRulesPath: join(stateRoot, "supervisor-learning-rules.json"),
		agentLabReportsDir: join(reportsDir, "agentlabs"),
		workspacesDir: join(stateRoot, "workspaces"),
	};
}

export function ensureProjectStateDirs(
	paths: ProjectStatePaths,
): ProjectStatePaths {
	for (const directory of [
		paths.stateRoot,
		paths.reportsDir,
		paths.semanticAuditDir,
		paths.agentLabReportsDir,
		paths.workspacesDir,
	]) {
		mkdirSync(directory, { recursive: true });
	}
	return paths;
}

export function formatProjectStatePaths(paths: ProjectStatePaths): string {
	return [
		"Project state",
		"",
		"projectId:",
		paths.projectId,
		"",
		"projectPath:",
		paths.projectPath,
		"",
		"stateRoot:",
		paths.stateRoot,
		"",
		"reportsDir:",
		paths.reportsDir,
		"",
		"labDbPath:",
		paths.labDbPath,
		"",
		"taskQueuePath:",
		paths.taskQueuePath,
		"",
		"sessionStatePath:",
		paths.sessionStatePath,
		"",
		"learningRulesPath:",
		paths.learningRulesPath,
	].join("\n");
}
