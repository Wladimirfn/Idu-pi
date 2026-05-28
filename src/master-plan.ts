import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
	type Stats,
} from "node:fs";
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { loadProjectBlueprint } from "./project-blueprint.js";
import { loadProjectConstitution } from "./project-constitution.js";
import { loadProjectCore } from "./project-core.js";
import { loadProjectFlows } from "./project-flows.js";
import type { AgentLabSpecialty } from "./agentlab-supervisor-contract.js";

export type MasterPlanStatus = "draft" | "approved" | "rejected" | "stale";
export type MasterPlanAutoDepthMode = "quick" | "standard" | "deep_required";

export type MasterPlanAutoDepth = {
	mode: MasterPlanAutoDepthMode;
	reason: string;
	signals: string[];
	agentLabsSelected: AgentLabSpecialty[];
	skippedAgentLabs: AgentLabSpecialty[];
	tokenCostHint: string;
};

export type MasterPlanSource = {
	projectCoreStatus: string;
	constitutionStatus: string;
	blueprintStatus: string;
	flowsStatus: string;
	scanStatus: string;
};

export type MasterPlanApproval = {
	approvedAt?: string;
	rejectedAt?: string;
	source?: "cli" | "pi" | "telegram" | "mcp";
	reason?: string;
};

export type MasterPlan = {
	version: string;
	projectId: string;
	projectPath: string;
	gitHead?: string;
	generatedAt: string;
	status: MasterPlanStatus;
	autoDepth: MasterPlanAutoDepth;
	source: MasterPlanSource;
	executiveSummary: string;
	inferredObjective: string;
	problemStatement: string;
	scope: string[];
	outOfScope: string[];
	detectedModules: string[];
	detectedFlows: string[];
	dataStores: string[];
	userRoles: string[];
	criticalRisks: string[];
	qualityRisks: string[];
	securityRisks: string[];
	architectureRisks: string[];
	openQuestions: string[];
	assumptions: string[];
	recommendedNext: string[];
	approval?: MasterPlanApproval;
	sourceFiles: string[];
	agentLabReviews: Array<{
		specialty: AgentLabSpecialty;
		status: "selected" | "skipped" | "not_run";
		reason: string;
		maxCommands: number;
	}>;
};

export type MasterPlanCurrent = {
	currentPlanJson: string;
	currentPlanMd: string;
	status: MasterPlanStatus;
	projectId: string;
	projectPath: string;
	gitHead?: string;
	updatedAt: string;
};

export type MasterPlanMemory = {
	projectId: string;
	status: MasterPlanStatus;
	currentPlanJson: string;
	objectiveSummary: string;
	topRisks: string[];
	openQuestionsCount: number;
	gitHead?: string;
	updatedAt: string;
};

export type MasterPlanDraftResult = {
	plan: MasterPlan;
	current: MasterPlanCurrent;
	memory: MasterPlanMemory;
	jsonPath: string;
	markdownPath: string;
};

export type MasterPlanStatusResult =
	| { status: "missing"; exists: false; recommendedNext: string }
	| (MasterPlanCurrent & { exists: true; staleReason?: string });

export type MasterPlanReview = {
	plan: MasterPlan;
	current?: MasterPlanCurrent;
	markdown: string;
	jsonPath: string;
	markdownPath?: string;
};

const CURRENT_FILE = "master-plan.current.json";
const MEMORY_FILE = "master-plan.memory.json";
const SKIPPED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	"reports",
	"workspaces",
	".pi-lens",
]);
const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".html",
	".htm",
	".css",
	".json",
	".md",
	".sql",
	".prisma",
	".py",
	".php",
]);

export function generateMasterPlanDraft(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	reason?: string;
}): MasterPlanDraftResult {
	const projectPath = resolve(input.projectPath);
	const stateRoot = resolve(input.stateRoot);
	const reportsDir = join(stateRoot, "reports");
	mkdirSync(reportsDir, { recursive: true });
	const generatedAt = new Date().toISOString();
	const signals = collectProjectSignals(projectPath);
	const source = readSourceStatuses(projectPath, signals);
	const autoDepth = decideAutoDepth(signals, source);
	const inferredObjective = inferObjective(projectPath, signals);
	const plan: MasterPlan = {
		version: "1.0.0",
		projectId: input.projectId,
		projectPath,
		...(input.gitHead ? { gitHead: input.gitHead } : {}),
		generatedAt,
		status: "draft",
		autoDepth,
		source,
		executiveSummary: buildExecutiveSummary(
			input.projectId,
			autoDepth,
			signals,
		),
		inferredObjective,
		problemStatement: buildProblemStatement(source, signals),
		scope: inferScope(signals),
		outOfScope: [
			"Aplicar flows automáticamente",
			"Confirmar Project Core o Constitution sin decisión humana",
			"Ejecutar cambios de AgentLabs sobre el repo real",
			"Hacer commit/push",
		],
		detectedModules: signals.moduleCandidates,
		detectedFlows: signals.flowCandidates,
		dataStores: signals.dataStoreCandidates,
		userRoles: inferUserRoles(signals),
		criticalRisks: inferCriticalRisks(autoDepth, source, signals),
		qualityRisks: inferQualityRisks(signals),
		securityRisks: inferSecurityRisks(signals),
		architectureRisks: inferArchitectureRisks(source, signals),
		openQuestions: inferOpenQuestions(source, signals),
		assumptions: inferAssumptions(signals, input.reason),
		recommendedNext: recommendedNext(autoDepth),
		sourceFiles: signals.sourceFiles.slice(0, 50),
		agentLabReviews: [
			...autoDepth.agentLabsSelected.map((specialty) => ({
				specialty,
				status: "not_run" as const,
				reason:
					"Seleccionado como metadata por AutoDepth; MASTER-PLAN-1 no ejecuta AgentLabs automáticamente.",
				maxCommands: autoDepth.mode === "quick" ? 3 : 3,
			})),
			...autoDepth.skippedAgentLabs.map((specialty) => ({
				specialty,
				status: "skipped" as const,
				reason:
					"Deep review requiere aprobación humana antes de gastar más contexto/comandos.",
				maxCommands: 0,
			})),
		],
	};
	const baseName = uniqueMasterPlanBaseName(reportsDir, generatedAt);
	const relativeJson = `reports/${baseName}.json`;
	const relativeMd = `reports/${baseName}.md`;
	const jsonPath = join(stateRoot, relativeJson);
	const markdownPath = join(stateRoot, relativeMd);
	writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	const current = writeCurrent(stateRoot, {
		currentPlanJson: relativeJson,
		currentPlanMd: relativeMd,
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: generatedAt,
	});
	const memory = writeMemory(stateRoot, plan, current);
	return { plan, current, memory, jsonPath, markdownPath };
}

export function getMasterPlanStatus(input: {
	stateRoot: string;
	currentGitHead?: string;
}): MasterPlanStatusResult {
	const stateRoot = resolve(input.stateRoot);
	const current = readCurrent(stateRoot);
	if (!current) {
		return {
			status: "missing",
			exists: false,
			recommendedNext: "Ejecutar idu-pi idu para generar Plan Maestro draft.",
		};
	}
	if (
		current.status === "approved" &&
		input.currentGitHead &&
		current.gitHead &&
		input.currentGitHead !== current.gitHead
	) {
		const stale = writeCurrent(stateRoot, {
			...current,
			status: "stale",
			gitHead: input.currentGitHead,
			updatedAt: new Date().toISOString(),
		});
		const plan = readPlan(
			safePathInsideState(stateRoot, stale.currentPlanJson),
		);
		if (plan)
			writeMemory(
				stateRoot,
				{ ...plan, status: "stale", gitHead: input.currentGitHead },
				stale,
			);
		return {
			...stale,
			exists: true,
			staleReason:
				"Git HEAD cambió desde la aprobación; se recomienda redraft.",
		};
	}
	return { ...current, exists: true };
}

export function reviewMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
}): MasterPlanReview {
	const stateRoot = resolve(input.stateRoot);
	const current = readCurrent(stateRoot);
	const jsonPath = resolvePlanPath(stateRoot, input.pathOrLatest, current);
	const plan = requirePlan(jsonPath);
	const markdownPath =
		current?.currentPlanJson === relativeFromState(stateRoot, jsonPath)
			? safePathInsideState(stateRoot, current.currentPlanMd)
			: jsonPath.replace(/\.json$/u, ".md");
	const markdown = existsSync(markdownPath)
		? readFileSync(markdownPath, "utf8")
		: formatMasterPlanMarkdown(plan);
	return { plan, current, markdown, jsonPath, markdownPath };
}

export function approveMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
	source: "cli" | "pi" | "telegram" | "mcp";
}): MasterPlanDraftResult {
	return updatePlanDecision(input.stateRoot, input.pathOrLatest, (plan) => ({
		...plan,
		status: "approved",
		approval: { approvedAt: new Date().toISOString(), source: input.source },
	}));
}

export function rejectMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
	reason?: string;
}): MasterPlanDraftResult {
	return updatePlanDecision(input.stateRoot, input.pathOrLatest, (plan) => ({
		...plan,
		status: "rejected",
		approval: {
			rejectedAt: new Date().toISOString(),
			...(input.reason ? { reason: input.reason } : {}),
		},
	}));
}

export function redraftMasterPlan(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	reason?: string;
}): MasterPlanDraftResult {
	return generateMasterPlanDraft(input);
}

export function ensureMasterPlanForIdu(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
}):
	| MasterPlanDraftResult
	| { status: MasterPlanStatusResult; plan?: MasterPlan } {
	const status = getMasterPlanStatus({
		stateRoot: input.stateRoot,
		currentGitHead: input.gitHead,
	});
	if (!status.exists || status.status === "rejected") {
		return generateMasterPlanDraft(input);
	}
	const plan = status.currentPlanJson
		? readPlan(safePathInsideState(input.stateRoot, status.currentPlanJson))
		: undefined;
	return { status, plan };
}

export function formatMasterPlanSummaryForIdu(
	result:
		| MasterPlanDraftResult
		| { status: MasterPlanStatusResult; plan?: MasterPlan },
): string {
	if ("plan" in result && "current" in result) {
		return [
			"Plan Maestro:",
			result.plan.status,
			"",
			"AutoDepth:",
			`${result.plan.autoDepth.mode} — ${result.plan.autoDepth.reason}`,
			"",
			"Acción automática:",
			"- Revisé estado aislado",
			"- Analicé estructura básica",
			"- Generé Plan Maestro draft",
			"- Guardé resumen optimizado",
			"",
			"Guardado en:",
			result.jsonPath,
			"",
			"Acciones:",
			"1. Aprobar: idu-pi master-plan-approve latest",
			"2. Rehacer: idu-pi master-plan-redraft latest",
			"3. Ver detalles: idu-pi master-plan-review latest",
		].join("\n");
	}
	const status = result.status;
	const plan = result.plan;
	return [
		"Plan Maestro:",
		status.status,
		"",
		"AutoDepth:",
		plan ? `${plan.autoDepth.mode} — ${plan.autoDepth.reason}` : "—",
		"",
		"Guardado en:",
		status.exists ? status.currentPlanJson : "—",
		"",
		"Acciones:",
		status.status === "approved"
			? "1. Ver detalles: idu-pi master-plan-review latest"
			: "1. Rehacer: idu-pi master-plan-redraft latest",
	].join("\n");
}

export function formatMasterPlanStatus(result: MasterPlanStatusResult): string {
	if (!result.exists) {
		return [
			"Master Plan Status",
			"",
			"Estado:",
			"missing",
			"",
			"Siguiente:",
			result.recommendedNext,
		].join("\n");
	}
	return [
		"Master Plan Status",
		"",
		"Estado:",
		result.status,
		"",
		"JSON:",
		result.currentPlanJson,
		"",
		"Markdown:",
		result.currentPlanMd,
		...(result.staleReason ? ["", "Stale:", result.staleReason] : []),
	].join("\n");
}

export function formatMasterPlanReview(review: MasterPlanReview): string {
	return review.markdown;
}

export function formatMasterPlanOperation(
	result: MasterPlanDraftResult,
): string {
	return [
		"Master Plan",
		"",
		"Estado:",
		result.plan.status,
		"",
		"JSON:",
		result.jsonPath,
		"",
		"Markdown:",
		result.markdownPath,
		"",
		"No apliqué flows, no confirmé Project Core/Constitution, no ejecuté AgentLabs y no hice commit/push.",
	].join("\n");
}

export function formatMasterPlanMarkdown(plan: MasterPlan): string {
	return [
		"# Plan Maestro Idu-pi",
		"",
		"## Resumen ejecutivo",
		plan.executiveSummary,
		"",
		"## Modo de análisis automático",
		`${plan.autoDepth.mode} — ${plan.autoDepth.reason}`,
		"",
		"Señales:",
		...bulletList(plan.autoDepth.signals),
		"",
		"## Objetivo inferido",
		plan.inferredObjective,
		"",
		"## Alcance",
		...bulletList(plan.scope),
		"",
		"## Fuera de alcance",
		...bulletList(plan.outOfScope),
		"",
		"## Módulos detectados",
		...bulletList(plan.detectedModules),
		"",
		"## Flujos detectados",
		...bulletList(plan.detectedFlows),
		"",
		"## Riesgos",
		...bulletList([
			...plan.criticalRisks,
			...plan.securityRisks,
			...plan.architectureRisks,
			...plan.qualityRisks,
		]),
		"",
		"## Preguntas abiertas",
		...bulletList(plan.openQuestions),
		"",
		"## Próximos pasos",
		...bulletList(plan.recommendedNext),
		"",
		"## Estado de aprobación",
		plan.status,
	].join("\n");
}

function updatePlanDecision(
	stateRootInput: string,
	pathOrLatest: string,
	update: (plan: MasterPlan) => MasterPlan,
): MasterPlanDraftResult {
	const stateRoot = resolve(stateRootInput);
	const current = readCurrent(stateRoot);
	const jsonPath = resolvePlanPath(stateRoot, pathOrLatest, current);
	const plan = update(requirePlan(jsonPath));
	writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	const markdownPath =
		current?.currentPlanJson === relativeFromState(stateRoot, jsonPath)
			? safePathInsideState(stateRoot, current.currentPlanMd)
			: jsonPath.replace(/\.json$/u, ".md");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	const nextCurrent = writeCurrent(stateRoot, {
		currentPlanJson: relativeFromState(stateRoot, jsonPath),
		currentPlanMd: relativeFromState(stateRoot, markdownPath),
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: new Date().toISOString(),
	});
	const memory = writeMemory(stateRoot, plan, nextCurrent);
	return { plan, current: nextCurrent, memory, jsonPath, markdownPath };
}

type ProjectSignals = {
	fileCount: number;
	directoryCount: number;
	docsBytes: number;
	approxRelevantBytes: number;
	hasPackageJson: boolean;
	dependencyCount: number;
	hasTests: boolean;
	hasDb: boolean;
	hasAuth: boolean;
	routeCount: number;
	moduleCandidates: string[];
	flowCandidates: string[];
	dataStoreCandidates: string[];
	sourceFiles: string[];
};

function collectProjectSignals(projectPath: string): ProjectSignals {
	const files: string[] = [];
	const directories = new Set<string>();
	let docsBytes = 0;
	let approxRelevantBytes = 0;
	let hasTests = false;
	let hasDb = false;
	let hasAuth = false;
	let routeCount = 0;
	const moduleCandidates = new Set<string>();
	const flowCandidates = new Set<string>();
	const dataStoreCandidates = new Set<string>();
	walkProject(projectPath, (path, stats) => {
		const rel = relative(projectPath, path).replace(/\\/gu, "/");
		if (stats.isDirectory()) {
			directories.add(rel);
			if (rel.split("/").length <= 2 && rel)
				moduleCandidates.add(rel.split("/")[0] ?? rel);
			return;
		}
		files.push(rel);
		const ext = extname(rel).toLowerCase();
		if (TEXT_EXTENSIONS.has(ext))
			approxRelevantBytes += Math.min(Number(stats.size), 512_000);
		if (ext === ".md") docsBytes += Number(stats.size);
		if (/test|spec|__tests__/iu.test(rel)) hasTests = true;
		if (/db|schema|migration|prisma|sqlite|supabase/iu.test(rel)) {
			hasDb = true;
			dataStoreCandidates.add(rel);
		}
		if (/auth|login|session|user|password|token/iu.test(rel)) hasAuth = true;
		if (
			/routes?|pages?|screens?|views?/iu.test(rel) ||
			/\.(html|tsx|jsx)$/iu.test(rel)
		)
			routeCount += 1;
		if (/flow|workflow|process|orden|order|checkout|login/iu.test(rel))
			flowCandidates.add(rel);
	});
	const packagePath = join(projectPath, "package.json");
	const dependencyCount = readDependencyCount(packagePath);
	return {
		fileCount: files.length,
		directoryCount: directories.size,
		docsBytes,
		approxRelevantBytes,
		hasPackageJson: existsSync(packagePath),
		dependencyCount,
		hasTests,
		hasDb,
		hasAuth,
		routeCount,
		moduleCandidates: [...moduleCandidates].slice(0, 20),
		flowCandidates: [...flowCandidates].slice(0, 20),
		dataStoreCandidates: [...dataStoreCandidates].slice(0, 20),
		sourceFiles: files.slice(0, 200),
	};
}

function walkProject(
	root: string,
	visit: (path: string, stats: Stats) => void,
): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (SKIPPED_DIRS.has(entry.name)) continue;
		const path = join(root, entry.name);
		const stats = statSync(path);
		visit(path, stats);
		if (entry.isDirectory()) walkProject(path, visit);
	}
}

function decideAutoDepth(
	signals: ProjectSignals,
	source: MasterPlanSource,
): MasterPlanAutoDepth {
	const signalLines = [
		`files=${signals.fileCount}`,
		`dirs=${signals.directoryCount}`,
		`deps=${signals.dependencyCount}`,
		`tests=${signals.hasTests ? "yes" : "no"}`,
		`db=${signals.hasDb ? "yes" : "no"}`,
		`auth=${signals.hasAuth ? "yes" : "no"}`,
		`routes=${signals.routeCount}`,
		`core=${source.projectCoreStatus}`,
		`constitution=${source.constitutionStatus}`,
		`flows=${source.flowsStatus}`,
	];
	const selected = selectAgentLabs(signals, source);
	const complexityScore =
		signals.fileCount +
		signals.directoryCount * 2 +
		signals.dependencyCount * 3 +
		(signals.hasDb ? 25 : 0) +
		(signals.hasAuth ? 25 : 0) +
		(source.projectCoreStatus === "missing" ? 15 : 0) +
		(source.flowsStatus === "missing" ? 15 : 0);
	if (
		signals.fileCount > 100 ||
		complexityScore >= 170 ||
		(signals.hasAuth &&
			signals.hasDb &&
			source.projectCoreStatus !== "confirmed" &&
			signals.fileCount > 60)
	) {
		return {
			mode: "deep_required",
			reason:
				"proyecto grande/crítico; requiere aprobación humana antes de deep review",
			signals: signalLines,
			agentLabsSelected: [],
			skippedAgentLabs: selected.length ? selected : ["project_understanding"],
			tokenCostHint: "high — no ejecutar análisis profundo automáticamente",
		};
	}
	if (
		complexityScore >= 45 ||
		signals.hasDb ||
		signals.hasAuth ||
		signals.routeCount >= 3 ||
		signals.fileCount >= 15
	) {
		return {
			mode: "standard",
			reason:
				"proyecto mediano con señales de DB/UI/auth o estructura suficiente",
			signals: signalLines,
			agentLabsSelected: selected.slice(0, 3),
			skippedAgentLabs: selected.slice(3),
			tokenCostHint: "medium — máximo 3 AgentLabs como metadata/request",
		};
	}
	return {
		mode: "quick",
		reason: "proyecto pequeño; escaneo determinista barato suficiente",
		signals: signalLines,
		agentLabsSelected: selected.slice(0, 1),
		skippedAgentLabs: selected.slice(1),
		tokenCostHint: "low — 0 a 1 AgentLab como metadata/request",
	};
}

function selectAgentLabs(
	signals: ProjectSignals,
	source: MasterPlanSource,
): AgentLabSpecialty[] {
	const labs: AgentLabSpecialty[] = [];
	if (signals.hasAuth) labs.push("security");
	if (signals.hasDb) labs.push("database");
	if (
		source.projectCoreStatus !== "confirmed" ||
		source.flowsStatus !== "project-local"
	)
		labs.push("architecture");
	if (signals.routeCount > 0) labs.push("ui_ux");
	if (signals.approxRelevantBytes > 1_000_000 || signals.docsBytes > 80_000)
		labs.push("token_cost");
	if (signals.fileCount > 50) labs.push("project_understanding");
	if (!signals.hasTests && signals.fileCount > 5) labs.push("code_quality");
	return unique(labs);
}

function readSourceStatuses(
	projectPath: string,
	signals: ProjectSignals,
): MasterPlanSource {
	return {
		projectCoreStatus: safeStatus(() => loadProjectCore(projectPath).status),
		constitutionStatus: safeStatus(
			() => loadProjectConstitution(projectPath).status,
		),
		blueprintStatus: safeStatus(() =>
			loadProjectBlueprint(projectPath) ? "available" : "missing",
		),
		flowsStatus: safeStatus(() => {
			loadProjectFlows(projectPath);
			return existsSync(join(projectPath, "config", "project-flows.json"))
				? "project-local"
				: "default";
		}),
		scanStatus: `deterministic:${signals.fileCount}:files`,
	};
}

function safeStatus(read: () => string): string {
	try {
		return read();
	} catch {
		return "missing";
	}
}

function inferObjective(projectPath: string, signals: ProjectSignals): string {
	const readme = ["README.md", "readme.md"]
		.map((name) => join(projectPath, name))
		.find((path) => existsSync(path));
	if (readme) {
		const firstLine = readFileSync(readme, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.replace(/^#+\s*/u, "").trim())
			.find(Boolean);
		if (firstLine) return firstLine;
	}
	if (signals.hasDb && signals.hasAuth)
		return "Sistema con autenticación, datos persistentes y flujos operativos por confirmar.";
	return `Entender y supervisar ${basename(projectPath)} sin aplicar cambios automáticos.`;
}

function buildExecutiveSummary(
	projectId: string,
	autoDepth: MasterPlanAutoDepth,
	signals: ProjectSignals,
): string {
	return `Idu-pi generó un Plan Maestro draft para ${projectId} en modo ${autoDepth.mode}. Se revisaron ${signals.fileCount} archivos y ${signals.directoryCount} carpetas con escaneo determinista; AgentLabs quedan sólo como selección/recomendación.`;
}

function buildProblemStatement(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string {
	if (source.projectCoreStatus !== "confirmed")
		return "El proyecto necesita un Plan Maestro revisable antes de tratar Project Core/Constitution como fuente de verdad.";
	if (signals.hasDb || signals.hasAuth)
		return "El proyecto combina datos/autenticación y requiere guardrails explícitos antes de cambios funcionales.";
	return "Mantener alineación entre intención humana, estructura real y próximos cambios.";
}

function inferScope(signals: ProjectSignals): string[] {
	return unique([
		"Reconocer estructura del proyecto",
		"Consolidar objetivo, riesgos y próximos pasos en un draft revisable",
		...(signals.hasDb ? ["Revisar datos/schema como área sensible"] : []),
		...(signals.hasAuth
			? ["Revisar auth/login/security como área sensible"]
			: []),
	]);
}

function inferUserRoles(signals: ProjectSignals): string[] {
	if (signals.hasAuth)
		return [
			"usuario autenticado",
			"administrador/operador pendiente de confirmar",
		];
	return ["usuario final pendiente de confirmar"];
}

function inferCriticalRisks(
	autoDepth: MasterPlanAutoDepth,
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(autoDepth.mode === "deep_required"
			? ["Proyecto requiere deep review aprobado antes de gastar más contexto."]
			: []),
		...(source.projectCoreStatus !== "confirmed"
			? ["Project Core no confirmado; no es fuente de verdad."]
			: []),
		...(signals.hasDb && signals.hasAuth
			? [
					"DB + auth detectados; cambios high-risk requieren confirmación humana.",
				]
			: []),
	]);
}

function inferQualityRisks(signals: ProjectSignals): string[] {
	return unique([
		...(signals.hasTests
			? []
			: ["No se detectaron tests; validar antes de cambios funcionales."]),
		...(signals.fileCount > 80
			? ["Proyecto grande; riesgo de omitir módulos en revisión rápida."]
			: []),
	]);
}

function inferSecurityRisks(signals: ProjectSignals): string[] {
	return signals.hasAuth
		? [
				"Auth/login/session detectado; revisar secretos, permisos y flujos de acceso.",
			]
		: [];
}

function inferArchitectureRisks(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(source.flowsStatus !== "project-local"
			? [
					"Flows project-local ausentes o default; mapa funcional puede estar incompleto.",
				]
			: []),
		...(signals.moduleCandidates.length > 8
			? ["Muchos módulos/carpetas; conviene revisión de arquitectura."]
			: []),
	]);
}

function inferOpenQuestions(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(source.projectCoreStatus !== "confirmed"
			? ["¿El objetivo inferido representa la intención humana actual?"]
			: []),
		...(signals.hasDb
			? [
					"¿Qué tablas/datos son críticos y requieren aprobación antes de tocarse?",
				]
			: []),
		...(signals.hasAuth
			? ["¿Qué reglas de seguridad/login son no negociables?"]
			: []),
	]);
}

function inferAssumptions(signals: ProjectSignals, reason?: string): string[] {
	return unique([
		"El plan es draft y requiere aprobación humana.",
		"No se usó IA externa para generar este plan.",
		"AgentLabs no se ejecutaron automáticamente.",
		...(reason ? [`Motivo de redraft: ${reason}`] : []),
		...(signals.hasPackageJson
			? ["package.json indica proyecto Node/JS o frontend/backend relacionado."]
			: []),
	]);
}

function recommendedNext(autoDepth: MasterPlanAutoDepth): string[] {
	if (autoDepth.mode === "deep_required") {
		return [
			"Aprobar o ajustar objetivo antes de deep review.",
			"Usar idu-pi master-plan-review latest para ver detalle.",
			"Preparar AgentLabs recomendados como requests; no ejecutar sin aprobación.",
		];
	}
	return [
		"Revisar: idu-pi master-plan-review latest",
		"Aprobar si representa el proyecto: idu-pi master-plan-approve latest",
		"Rehacer si falta contexto: idu-pi master-plan-redraft latest",
	];
}

function readDependencyCount(packagePath: string): number {
	try {
		if (!existsSync(packagePath)) return 0;
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
			dependencies?: Record<string, unknown>;
			devDependencies?: Record<string, unknown>;
		};
		return (
			Object.keys(parsed.dependencies ?? {}).length +
			Object.keys(parsed.devDependencies ?? {}).length
		);
	} catch {
		return 0;
	}
}

function uniqueMasterPlanBaseName(reportsDir: string, iso: string): string {
	const stamp = iso
		.replace(/[-:]/gu, "")
		.replace(/T/u, "-")
		.replace(/\.\d+Z$/u, "");
	const base = `master-plan-${stamp}`;
	let candidate = base;
	let counter = 2;
	while (
		existsSync(join(reportsDir, `${candidate}.json`)) ||
		existsSync(join(reportsDir, `${candidate}.md`))
	) {
		candidate = `${base}-${counter}`;
		counter += 1;
	}
	return candidate;
}

function writeCurrent(
	stateRoot: string,
	current: MasterPlanCurrent,
): MasterPlanCurrent {
	mkdirSync(stateRoot, { recursive: true });
	writeFileSync(
		join(stateRoot, CURRENT_FILE),
		`${JSON.stringify(current, null, 2)}\n`,
		"utf8",
	);
	return current;
}

function writeMemory(
	stateRoot: string,
	plan: MasterPlan,
	current: MasterPlanCurrent,
): MasterPlanMemory {
	const memory: MasterPlanMemory = {
		projectId: plan.projectId,
		status: plan.status,
		currentPlanJson: current.currentPlanJson,
		objectiveSummary: plan.inferredObjective.slice(0, 240),
		topRisks: [
			...plan.criticalRisks,
			...plan.securityRisks,
			...plan.architectureRisks,
		].slice(0, 5),
		openQuestionsCount: plan.openQuestions.length,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: current.updatedAt,
	};
	writeFileSync(
		join(stateRoot, MEMORY_FILE),
		`${JSON.stringify(memory, null, 2)}\n`,
		"utf8",
	);
	return memory;
}

function readCurrent(stateRoot: string): MasterPlanCurrent | undefined {
	try {
		const path = join(stateRoot, CURRENT_FILE);
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as MasterPlanCurrent;
	} catch {
		return undefined;
	}
}

function resolvePlanPath(
	stateRoot: string,
	pathOrLatest: string,
	current?: MasterPlanCurrent,
): string {
	if (pathOrLatest === "latest") {
		if (!current) throw new Error("No existe master-plan.current.json");
		return safePathInsideState(stateRoot, current.currentPlanJson);
	}
	return safePathInsideState(stateRoot, pathOrLatest);
}

function safePathInsideState(stateRoot: string, path: string): string {
	const resolvedStateRoot = resolve(stateRoot);
	const resolved = isAbsolute(path)
		? resolve(path)
		: resolve(resolvedStateRoot, path);
	const relativePath = relative(resolvedStateRoot, resolved);
	if (relativePath.startsWith("..") || isAbsolute(relativePath))
		throw new Error("Master Plan fuera de stateRoot");
	return resolved;
}

function readPlan(path: string): MasterPlan | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as MasterPlan;
	} catch {
		return undefined;
	}
}

function requirePlan(path: string): MasterPlan {
	const plan = readPlan(path);
	if (!plan) throw new Error(`No pude leer Plan Maestro: ${path}`);
	return plan;
}

function relativeFromState(stateRoot: string, path: string): string {
	return relative(stateRoot, path).replace(/\\/gu, "/");
}

function bulletList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- —"];
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

export function readGitHead(projectPath: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}
