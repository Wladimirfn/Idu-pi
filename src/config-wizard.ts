import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentProfile, AgentWorkspaceMode } from "./config.js";
import { isAllowedCwd } from "./config.js";

export type AssetStatus = {
	label: string;
	path: string;
	relativePath: string;
	exists: boolean;
};

export type ConfigWizardReport = {
	projectId: string;
	projectPath: string;
	allowed: boolean;
	isGitRepo: boolean;
	workspaceMode: AgentWorkspaceMode;
	workspaceRoot: string;
	activeProfileId: string;
	agentProfiles: AgentProfile[];
	piArgs: string[];
	assets: {
		skills: AssetStatus;
		registry: AssetStatus;
		mcp: AssetStatus;
	};
	warnings: string[];
	recommendedNext: string;
};

export type InspectProjectConfigOptions = {
	projectId: string;
	projectPath: string;
	allowedRoots: string[];
	agentProfiles: AgentProfile[];
	activeProfileId: string;
	workspaceMode: AgentWorkspaceMode;
	workspaceRoot: string;
	piArgs: string[];
	isGitRepo?: boolean;
};

export type InitAssetsResult = {
	projectPath: string;
	created: string[];
	existing: string[];
};

const SKILLS_DIR = ".agents/skills";
const SKILLS_KEEP = ".agents/skills/.gitkeep";
const REGISTRY_FILE = ".atl/skill-registry.md";
const MCP_CONFIG = ".mcp/config.json";

const REGISTRY_TEMPLATE = `# Project Skill Registry

Project-local skills available to Idu-pi agents.

| Skill | Trigger / description | Path |
| --- | --- | --- |
`;

const MCP_TEMPLATE = `{
  "enabled": false,
  "servers": {}
}
`;

function asset(
	projectPath: string,
	label: string,
	relativePath: string,
): AssetStatus {
	const path = join(projectPath, relativePath);
	return { label, path, relativePath, exists: existsSync(path) };
}

function detectGitRepo(projectPath: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: projectPath,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

function marker(ok: boolean): string {
	return ok ? "✅" : "❌";
}

function createFileIfMissing(
	projectPath: string,
	relativePath: string,
	content: string,
	result: InitAssetsResult,
): void {
	const path = join(projectPath, relativePath);
	mkdirSync(join(path, ".."), { recursive: true });
	if (existsSync(path)) {
		result.existing.push(relativePath);
		return;
	}
	writeFileSync(path, content, "utf8");
	result.created.push(relativePath);
}

function safeRelative(projectPath: string, path: string): string {
	return relative(projectPath, path).replace(/\\/gu, "/");
}

export function inspectProjectConfig(
	options: InspectProjectConfigOptions,
): ConfigWizardReport {
	const assets = {
		skills: asset(options.projectPath, "Skills", SKILLS_DIR),
		registry: asset(options.projectPath, "Skill registry", REGISTRY_FILE),
		mcp: asset(options.projectPath, "MCP config", MCP_CONFIG),
	};
	const allowed = isAllowedCwd(options.projectPath, options.allowedRoots);
	const isGitRepo = options.isGitRepo ?? detectGitRepo(options.projectPath);
	const warnings: string[] = [];

	if (!allowed)
		warnings.push("El proyecto activo no está dentro de ALLOWED_ROOTS.");
	if (!isGitRepo)
		warnings.push("El proyecto activo no parece ser un repo Git.");
	if (options.workspaceMode !== "clone") {
		warnings.push(
			"AGENT_WORKSPACE_MODE no está en clone; los laboratorios no quedan aislados.",
		);
	}
	if (options.agentProfiles.length < 2) {
		warnings.push(
			"No hay perfiles lab configurados; solo existe el agente default/directo.",
		);
	}
	if (
		options.piArgs.some(
			(arg) => arg === "--no-skill-registry" || arg === "--no-lens",
		)
	) {
		warnings.push(
			"PI_EXTRA_ARGS desactiva skill registry/lens; verificá si esto contradice assets project-local.",
		);
	}

	const missingAsset =
		!assets.skills.exists || !assets.registry.exists || !assets.mcp.exists;
	const recommendedNext = missingAsset
		? "/config init_assets"
		: "/config doctor";

	return {
		projectId: options.projectId,
		projectPath: options.projectPath,
		allowed,
		isGitRepo,
		workspaceMode: options.workspaceMode,
		workspaceRoot: options.workspaceRoot,
		activeProfileId: options.activeProfileId,
		agentProfiles: options.agentProfiles,
		piArgs: options.piArgs,
		assets,
		warnings,
		recommendedNext,
	};
}

export function initProjectAssets(projectPath: string): InitAssetsResult {
	const result: InitAssetsResult = { projectPath, created: [], existing: [] };
	mkdirSync(join(projectPath, SKILLS_DIR), { recursive: true });
	createFileIfMissing(projectPath, SKILLS_KEEP, "", result);
	createFileIfMissing(projectPath, REGISTRY_FILE, REGISTRY_TEMPLATE, result);
	createFileIfMissing(projectPath, MCP_CONFIG, MCP_TEMPLATE, result);
	return result;
}

export function formatConfigOverview(report: ConfigWizardReport): string {
	return `Configuración Idu-pi

Bridge/proyecto
${marker(report.allowed)} Proyecto permitido: ${report.projectId}
${marker(report.isGitRepo)} Repo Git válido
${marker(report.workspaceMode === "clone")} Workspace mode: ${report.workspaceMode}

Agentes
${marker(report.agentProfiles.length > 1)} Perfiles configurados: ${report.agentProfiles.length}
✅ Agente activo: ${report.activeProfileId}

Project-local assets
${marker(report.assets.skills.exists)} ${report.assets.skills.relativePath}
${marker(report.assets.registry.exists)} ${report.assets.registry.relativePath}
${marker(report.assets.mcp.exists)} ${report.assets.mcp.relativePath}

${report.warnings.length ? `Advertencias:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}\n\n` : ""}Siguiente recomendado:
${report.recommendedNext}`;
}

export function formatConfigDoctor(report: ConfigWizardReport): string {
	return `Doctor configuración Idu-pi

Proyecto
- id: ${report.projectId}
- path: ${report.projectPath}
- permitido por ALLOWED_ROOTS: ${report.allowed ? "sí" : "no"}
- git repo: ${report.isGitRepo ? "sí" : "no"}

Workspaces
- mode: ${report.workspaceMode}
- root: ${report.workspaceRoot}

Agentes
${report.agentProfiles.map((profile, index) => `- ${index + 1}. ${profile.label} (${profile.id})${profile.id === report.activeProfileId ? " activo" : ""}`).join("\n")}

Project-local assets
- ${report.assets.skills.label}: ${report.assets.skills.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.skills.path)})
- ${report.assets.registry.label}: ${report.assets.registry.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.registry.path)})
- ${report.assets.mcp.label}: ${report.assets.mcp.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.mcp.path)})

Pi flags relevantes
- skill registry/lens desactivado: ${report.piArgs.some((arg) => arg === "--no-skill-registry" || arg === "--no-lens") ? "sí" : "no"}

Advertencias
${report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- ninguna"}

Siguiente recomendado:
${report.recommendedNext}`;
}

export function formatInitAssetsResult(result: InitAssetsResult): string {
	const created = result.created.length
		? result.created.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	const existing = result.existing.length
		? result.existing.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	return `Assets project-local

Creados:
${created}

Ya existían:
${existing}

No ejecuté MCP, no copié secretos, no hice commit ni push.`;
}
