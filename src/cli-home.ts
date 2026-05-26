import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDirectory, isAllowedCwd } from "./config.js";
import {
	detectGlobalIduInstall,
	detectTools,
	formatPnpmPathHelp,
	projectInstallStatus,
	resolvePiAgentDir,
	type GlobalIduInstallStatus,
} from "./idu-installer.js";
import { resolveProjectStatePaths } from "./project-state.js";
import { slugifyProjectId } from "./projects.js";

export type CliHomeOptions = {
	cwd?: string;
	argvPath?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	stdinInteractive?: boolean;
	version?: string;
	exists?: (path: string) => boolean;
	runner?: (command: string, args: string[]) => string | undefined;
	gitRoot?: string | null;
	registryPath?: string;
};

export type CliHomeProjectStatus = {
	candidatePath: string;
	isGitRepository: boolean;
	registered: boolean;
	projectId: string;
	stateRoot?: string;
	labDbPath?: string;
	reportsDir?: string;
	supervisor: "active" | "inactive" | "unknown";
	projectCore: "confirmed" | "pending" | "missing" | "unknown";
	warning?: string;
};

export type CliHomeStatus = {
	version: string;
	cwd: string;
	nodeFound: boolean;
	gitFound: boolean;
	mcpInstalled: boolean;
	globalInstall: GlobalIduInstallStatus;
	project: CliHomeProjectStatus;
	stdinInteractive: boolean;
};

export function buildCliHomeStatus(
	options: CliHomeOptions = {},
): CliHomeStatus {
	const env = options.env ?? mergedPackageEnv();
	const exists = options.exists ?? existsSync;
	const cwd = resolve(options.cwd ?? process.cwd());
	const tools = detectTools({ env, runner: options.runner });
	const agentDir = resolvePiAgentDir({ env });
	const mcpInstalled = mcpConfigHasIdu(join(agentDir, "mcp.json"), exists);
	const globalInstall = detectGlobalIduInstall({
		env,
		argvPath: options.argvPath,
		runner: options.runner,
	});
	return {
		version: options.version ?? readPackageVersion(),
		cwd,
		nodeFound: tools.node.found,
		gitFound: tools.git.found,
		mcpInstalled,
		globalInstall,
		project: detectHomeProjectStatus({ ...options, cwd, env, exists }),
		stdinInteractive: options.stdinInteractive ?? Boolean(process.stdin.isTTY),
	};
}

export function formatCliHome(status: CliHomeStatus): string {
	const project = status.project;
	return [
		"Idu-pi",
		`version: ${status.version}`,
		"",
		"Proyecto actual:",
		project.candidatePath,
		"",
		"Estado:",
		`- node: ${status.nodeFound ? "found" : "missing"}`,
		`- git: ${status.gitFound ? "found" : "missing"}`,
		`- MCP idu-pi: ${status.mcpInstalled ? "instalado" : "no instalado"}`,
		`- Proyecto git: ${project.isGitRepository ? "sí" : "no"}`,
		`- Proyecto enrolado: ${project.registered ? "sí" : "no"}`,
		`- Supervisor: ${project.supervisor}`,
		`- Project Core: ${project.projectCore}`,
		...(project.stateRoot ? [`- stateRoot: ${project.stateRoot}`] : []),
		...(project.warning ? [`- aviso: ${project.warning}`] : []),
		"",
		"Acciones:",
		"1. Activar supervisor: idu-pi idu",
		"2. Preparar proyecto: idu-pi prepare",
		"3. Ver estado: idu-pi project status .",
		"4. Setup: idu-pi setup status",
		"",
		"Comandos recomendados:",
		status.mcpInstalled ? "- MCP ya está instalado" : "- idu-pi setup mcp-init",
		project.registered
			? "- idu-pi idu-status"
			: project.isGitRepository
				? "- idu-pi project enroll ."
				: "- idu-pi project enroll <path>",
		"- idu-pi setup path-help",
		"",
		"Instalación global:",
		`- idu-pi global: ${status.globalInstall.iduPiLikelyGlobal ? "disponible" : "no disponible"}`,
		`- pnpm global bin en PATH: ${status.globalInstall.pnpmGlobalBinInPath ? "sí" : "no"}`,
		...(status.globalInstall.pnpmGlobalBinInPath
			? []
			: [
					"- PNPM_HOME no está en PATH",
					"- Acción recomendada: corepack pnpm setup; abrir nueva terminal; corepack pnpm link --global",
				]),
		...(status.stdinInteractive
			? [
					"",
					"Menú:",
					"1. Setup status",
					"2. Instalar/actualizar MCP",
					"3. Enrolar proyecto actual",
					"4. Ver estado del proyecto actual",
					"5. Activar Idu-pi",
					"6. Preparar proyecto",
					"7. Ver comandos útiles",
					"8. Salir",
				]
			: ["", "Modo no interactivo: mostré resumen y no espero input."]),
	].join("\n");
}

export function formatSetupWizardNonInteractive(
	status: CliHomeStatus = buildCliHomeStatus({ stdinInteractive: false }),
): string {
	return [
		formatCliHome({ ...status, stdinInteractive: false }),
		"",
		"Wizard:",
		"stdin no es interactivo; no espero input ni escribo archivos.",
		"Ejecutá `idu-pi` en una terminal interactiva para elegir acciones.",
	].join("\n");
}

export function formatSetupPathHelp(
	status: GlobalIduInstallStatus = detectGlobalIduInstall(),
): string {
	return formatPnpmPathHelp(status);
}

function detectHomeProjectStatus(
	options: CliHomeOptions & {
		cwd: string;
		env: NodeJS.ProcessEnv | Record<string, string | undefined>;
		exists: (path: string) => boolean;
	},
): CliHomeProjectStatus {
	const gitRoot = options.gitRoot ?? detectGitRoot(options.cwd, options.runner);
	const candidatePath = gitRoot ?? options.cwd;
	const isGitRepository = Boolean(gitRoot);
	const env = options.env;
	const workspaceRoot =
		env.AGENT_WORKSPACE_ROOT?.trim() ||
		join(resolveHomeFallback(), "Documents", "bridge-agents");
	const allowedRoots = parseAllowedRoots(env.ALLOWED_ROOTS, env.DEFAULT_CWD);
	if (!allowedRoots.length) {
		const projectId =
			slugifyProjectId(candidatePath.split(/[\\/]/u).at(-1) ?? "project") ||
			"project";
		const paths = resolveProjectStatePaths({
			workspaceRoot,
			projectId,
			projectPath: candidatePath,
		});
		return {
			candidatePath,
			isGitRepository,
			registered: false,
			projectId,
			stateRoot: paths.stateRoot,
			supervisor: "unknown",
			projectCore: projectCoreStatus(candidatePath, options.exists),
			warning:
				"DEFAULT_CWD/ALLOWED_ROOTS no están configurados; usá ruta explícita para enrolar.",
		};
	}
	try {
		const canonicalCandidate = canonicalDirectory(candidatePath);
		if (!isAllowedCwd(canonicalCandidate, allowedRoots)) {
			const projectId =
				slugifyProjectId(
					canonicalCandidate.split(/[\\/]/u).at(-1) ?? "project",
				) || "project";
			const paths = resolveProjectStatePaths({
				workspaceRoot,
				projectId,
				projectPath: canonicalCandidate,
			});
			return {
				candidatePath: canonicalCandidate,
				isGitRepository,
				registered: false,
				projectId,
				stateRoot: paths.stateRoot,
				supervisor: "unknown",
				projectCore: projectCoreStatus(canonicalCandidate, options.exists),
				warning:
					"cwd fuera de ALLOWED_ROOTS; usá una ruta permitida o ajustá configuración.",
			};
		}
		const status = projectInstallStatus({
			projectPath: canonicalCandidate,
			workspaceRoot,
			allowedRoots,
			mcpAvailable: false,
			registryPath: options.registryPath ?? resolveIduRegistryPath(options.env),
		});
		return {
			candidatePath: canonicalCandidate,
			isGitRepository,
			registered: status.registered,
			projectId: status.projectId,
			stateRoot: status.stateRoot,
			labDbPath: status.labDbPath,
			reportsDir: status.reportsDir,
			supervisor: readSupervisorStatus(
				status.projectId,
				status.stateRoot,
				options.exists,
			),
			projectCore: projectCoreStatus(canonicalCandidate, options.exists),
		};
	} catch (error) {
		const projectId =
			slugifyProjectId(candidatePath.split(/[\\/]/u).at(-1) ?? "project") ||
			"project";
		return {
			candidatePath,
			isGitRepository,
			registered: false,
			projectId,
			supervisor: "unknown",
			projectCore: "unknown",
			warning: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseAllowedRoots(
	raw: string | undefined,
	defaultCwd: string | undefined,
): string[] {
	return (raw?.trim() ? raw.split(";") : defaultCwd ? [defaultCwd] : [])
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function detectGitRoot(
	cwd: string,
	runner?: (command: string, args: string[]) => string | undefined,
): string | null {
	try {
		const output = runner
			? runner("git", ["-C", cwd, "rev-parse", "--show-toplevel"])
			: execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				});
		const root = output?.trim();
		return root ? resolve(root) : null;
	} catch {
		return null;
	}
}

function projectCoreStatus(
	projectPath: string,
	exists: (path: string) => boolean,
): CliHomeProjectStatus["projectCore"] {
	const corePath = join(projectPath, "config", "project-core.json");
	if (!exists(corePath)) return "pending";
	try {
		const parsed = JSON.parse(readFileSync(corePath, "utf8")) as {
			status?: string;
		};
		return parsed.status === "confirmed" ? "confirmed" : "pending";
	} catch {
		return "pending";
	}
}

function readSupervisorStatus(
	projectId: string,
	stateRoot: string,
	exists: (path: string) => boolean,
): "active" | "inactive" | "unknown" {
	const sessionPath = join(stateRoot, "idu-session-state.json");
	if (!exists(sessionPath)) return "inactive";
	try {
		const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as {
			projects?: Record<string, { active?: boolean }>;
		};
		return parsed.projects?.[projectId]?.active === true
			? "active"
			: "inactive";
	} catch {
		return "unknown";
	}
}

function mcpConfigHasIdu(
	path: string,
	exists: (path: string) => boolean,
): boolean {
	if (!exists(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		return Boolean(parsed.mcpServers?.["idu-pi"]);
	} catch {
		return false;
	}
}

function readPackageVersion(): string {
	try {
		const packagePath = join(resolveCliPackageRoot(), "package.json");
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
			version?: string;
		};
		return parsed.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

export function applyPackageEnvDefaults(): void {
	for (const [key, value] of Object.entries(readPackageEnv())) {
		if (value !== undefined && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

export function resolveCliPackageRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function resolveIduRegistryPath(
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
	return resolve(
		env.IDU_PI_REGISTRY_PATH?.trim() ||
			join(resolveCliPackageRoot(), "data", "projects.json"),
	);
}

function mergedPackageEnv(): Record<string, string | undefined> {
	return { ...readPackageEnv(), ...process.env };
}

function readPackageEnv(): Record<string, string | undefined> {
	const envPath = join(resolveCliPackageRoot(), ".env");
	if (!existsSync(envPath)) return {};
	const values: Record<string, string | undefined> = {};
	try {
		for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const separator = trimmed.indexOf("=");
			if (separator === -1) continue;
			const key = trimmed.slice(0, separator).trim();
			let value = trimmed.slice(separator + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			values[key] = value;
		}
	} catch {
		return {};
	}
	return values;
}

function resolveHomeFallback(): string {
	return process.env.USERPROFILE || process.env.HOME || process.cwd();
}
