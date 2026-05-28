import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type AgentRouter, profileModelLabel } from "./agent-router.js";
import type { AgentProfile } from "./config.js";

export type IduModelRoleId =
	| "supervisor-main"
	| "supervisor-semantic"
	| "supervisor-compaction"
	| "agentlab-general"
	| "agentlab-security"
	| "agentlab-architecture"
	| "agentlab-performance"
	| "agentlab-code-quality";

export type IduModelRole = {
	id: IduModelRoleId;
	label: string;
	group: "supervisor" | "agentlab";
};

export const IDU_MODEL_ROLES: IduModelRole[] = [
	{ id: "supervisor-main", label: "Supervisor principal", group: "supervisor" },
	{
		id: "supervisor-semantic",
		label: "Supervisor semántico",
		group: "supervisor",
	},
	{
		id: "supervisor-compaction",
		label: "Supervisor compactación",
		group: "supervisor",
	},
	{ id: "agentlab-general", label: "AgentLab general", group: "agentlab" },
	{ id: "agentlab-security", label: "AgentLab seguridad", group: "agentlab" },
	{
		id: "agentlab-architecture",
		label: "AgentLab arquitectura",
		group: "agentlab",
	},
	{
		id: "agentlab-performance",
		label: "AgentLab performance",
		group: "agentlab",
	},
	{
		id: "agentlab-code-quality",
		label: "AgentLab calidad código",
		group: "agentlab",
	},
];

export type ModelAssignments = {
	version: 1;
	assignments: Partial<Record<IduModelRoleId, string>>;
	updatedAt?: string;
	backupPath?: string;
};

export type ModelAssignmentResolution =
	| { source: "assigned"; profile: AgentProfile; profileId: string }
	| { source: "missing"; profileId: string }
	| { source: "inherit" };

export function modelAssignmentsPath(stateRoot: string): string {
	return join(stateRoot, "model-assignments.json");
}

export function loadModelAssignments(stateRoot: string): ModelAssignments {
	const path = modelAssignmentsPath(stateRoot);
	if (!existsSync(path)) return { version: 1, assignments: {} };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.version !== 1 ||
			!isRecord(parsed.assignments)
		) {
			return { version: 1, assignments: {} };
		}
		const assignments: Partial<Record<IduModelRoleId, string>> = {};
		for (const role of IDU_MODEL_ROLES) {
			const value = parsed.assignments[role.id];
			if (typeof value === "string" && value.trim())
				assignments[role.id] = value.trim();
		}
		return {
			version: 1,
			assignments,
			...(typeof parsed.updatedAt === "string"
				? { updatedAt: parsed.updatedAt }
				: {}),
		};
	} catch {
		return { version: 1, assignments: {} };
	}
}

export function profileForModelRole(
	assignments: ModelAssignments,
	roleId: IduModelRoleId,
	profiles: AgentProfile[],
): ModelAssignmentResolution | undefined {
	const profileId = assignments.assignments[roleId];
	if (!profileId) return undefined;
	const profile = profiles.find((candidate) => candidate.id === profileId);
	if (!profile) return { source: "missing", profileId };
	return { source: "assigned", profile, profileId };
}

export function applySupervisorModelAssignment(
	router: AgentRouter,
	assignments: ModelAssignments,
	profiles: AgentProfile[],
): ModelAssignmentResolution {
	const resolution = profileForModelRole(
		assignments,
		"supervisor-main",
		profiles,
	);
	if (!resolution) return { source: "inherit" };
	if (resolution.source !== "assigned") return resolution;
	const selected = router.setActiveProfile(resolution.profile.id);
	return selected
		? resolution
		: { source: "missing", profileId: resolution.profile.id };
}

export function saveModelAssignment(
	stateRoot: string,
	roleId: string,
	profileId: string,
	profiles: AgentProfile[],
): ModelAssignments {
	const role = IDU_MODEL_ROLES.find((candidate) => candidate.id === roleId);
	if (!role) throw new Error(`Rol desconocido: ${roleId}`);
	if (!profiles.some((profile) => profile.id === profileId))
		throw new Error(`Perfil desconocido: ${profileId}`);
	mkdirSync(stateRoot, { recursive: true });
	const path = modelAssignmentsPath(stateRoot);
	const backupPath = existsSync(path)
		? `${path}.backup-${timestamp()}`
		: undefined;
	if (backupPath) copyFileSync(path, backupPath);
	const current = loadModelAssignments(stateRoot);
	const next: ModelAssignments = {
		version: 1,
		assignments: { ...current.assignments, [role.id]: profileId },
		updatedAt: new Date().toISOString(),
		...(backupPath ? { backupPath } : {}),
	};
	writeFileSync(
		path,
		`${JSON.stringify({ version: next.version, assignments: next.assignments, updatedAt: next.updatedAt }, null, 2)}\n`,
		"utf8",
	);
	return next;
}

export function formatModelAssignments(
	assignments: ModelAssignments,
	profiles: AgentProfile[],
): string {
	return [
		"Asignaciones por rol",
		"",
		...IDU_MODEL_ROLES.map((role, index) => {
			const resolution = profileForModelRole(assignments, role.id, profiles);
			const value = formatAssignmentResolution(resolution);
			return `  ${index === 0 ? "▸" : " "} ${role.label.padEnd(26, " ")} ${value}`;
		}),
	].join("\n");
}

function formatAssignmentResolution(
	resolution: ModelAssignmentResolution | undefined,
): string {
	if (!resolution || resolution.source === "inherit")
		return "inherit (fallback)";
	if (resolution.source === "missing")
		return `missing profile ${resolution.profileId} (fallback)`;
	return `${resolution.profile.label} / ${profileModelLabel(resolution.profile)} (assigned)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(): string {
	return new Date()
		.toISOString()
		.replace(/[-:T.]/gu, "")
		.slice(0, 14);
}
