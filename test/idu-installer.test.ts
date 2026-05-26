import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	backupAgentConfigFile,
	buildIduMcpConfig,
	detectAgentConfigs,
	detectSystem,
	detectTools,
	formatIduSetupStatus,
	formatProjectEnrollResult,
	formatProjectInstallStatus,
	installIduMcpConfig,
	printIduMcpConfig,
	projectEnroll,
	projectInstallStatus,
	resolvePiAgentDir,
} from "../src/idu-installer.js";
import { runCliCommand } from "../src/cli.js";

function tempDir(prefix = "idu-installer-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("detectSystem and detectTools return best-effort diagnostics", () => {
	const system = detectSystem({ env: { SHELL: "bash" }, platform: "linux" });
	assert.equal(system.os, "linux");
	assert.equal(system.shell, "bash");
	const tools = detectTools({
		runner: (command: string) => (command === "node" ? "v20.0.0" : undefined),
	});
	assert.equal(tools.node.found, true);
	assert.equal(typeof tools.git.found, "boolean");
});

test("resolvePiAgentDir uses PI_CODING_AGENT_DIR if present", () => {
	const root = tempDir();
	const dir = join(root, "custom-pi-agent");
	const resolved = resolvePiAgentDir({
		env: { PI_CODING_AGENT_DIR: dir },
		homeDir: root,
	});
	assert.equal(resolved, dir);
	rmSync(root, { recursive: true, force: true });
});

test("detectAgentConfigs detects Pi best-effort", () => {
	const root = tempDir();
	const piDir = join(root, ".pi", "agent");
	const configs = detectAgentConfigs({
		env: {},
		homeDir: root,
		exists: (path: string) => path === piDir,
	});
	assert.equal(configs.pi.present, true);
	assert.equal(configs.pi.path, piDir);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init creates mcp.json when missing", () => {
	const root = tempDir();
	const mcpServerPath = join(root, "dist", "src", "mcp-server.js");
	const result = installIduMcpConfig({ agentDir: root, mcpServerPath });
	assert.equal(result.status, "installed");
	assert.equal(existsSync(join(root, "mcp.json")), true);
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<
			string,
			{ args: string[]; cwd?: string; directTools?: boolean }
		>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].args[0], mcpServerPath);
	assert.equal(parsed.mcpServers["idu-pi"].directTools, true);
	assert.equal(parsed.mcpServers["idu-pi"].cwd, root);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init preserves other mcpServers", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { other: { command: "x" } } }),
		"utf8",
	);
	installIduMcpConfig({ agentDir: root, mcpServerPath: join(root, "mcp.js") });
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, unknown>;
	};
	assert.ok(parsed.mcpServers.other);
	assert.ok(parsed.mcpServers["idu-pi"]);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init does not overwrite idu-pi without force", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "old" } } }),
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
	});
	assert.equal(result.status, "exists");
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, { command: string }>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].command, "old");
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init force replaces idu-pi and creates backup", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "old" } } }),
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
		force: true,
		now: () => new Date("2026-05-25T01:02:03Z"),
	});
	assert.equal(result.status, "installed");
	assert.ok(result.backupPath);
	assert.equal(existsSync(result.backupPath ?? ""), true);
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, { command: string }>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].command, "node");
	rmSync(root, { recursive: true, force: true });
});

test("mcp-print and dry-run do not write files", () => {
	const root = tempDir();
	const printed = printIduMcpConfig({ mcpServerPath: join(root, "mcp.js") });
	assert.match(printed, /idu-pi/u);
	const dryRun = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
		dryRun: true,
	});
	assert.equal(dryRun.status, "dry_run");
	assert.equal(existsSync(join(root, "mcp.json")), false);
	rmSync(root, { recursive: true, force: true });
});

test("backupAgentConfigFile returns undefined for missing config", () => {
	const root = tempDir();
	assert.equal(backupAgentConfigFile(join(root, "mcp.json")), undefined);
	rmSync(root, { recursive: true, force: true });
});

test("buildIduMcpConfig uses node lazy server config", () => {
	const config = buildIduMcpConfig("C:/idu/dist/src/mcp-server.js");
	assert.equal(config.command, "node");
	assert.match(config.args[0], /idu[\\/]dist[\\/]src[\\/]mcp-server\.js$/u);
	assert.equal(config.lifecycle, "lazy");
	assert.equal(config.directTools, true);
	assert.match(config.cwd, /idu$/u);
});

test("project enroll registers project and creates isolated state dirs", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "Sistema_de_mantencion");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	writeFileSync(join(root, "marker.txt"), "ok", "utf8");
	const result = projectEnroll({
		projectPath,
		projectId: "Sistema de Mantención",
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
	});
	assert.equal(result.project.id, "sistema-de-mantencion");
	assert.equal(existsSync(result.statePaths.stateRoot), true);
	assert.equal(
		existsSync(join(projectPath, "config", "project-core.json")),
		false,
	);
	const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
		projects: Array<{ id: string }>;
	};
	assert.equal(registry.projects[0].id, "sistema-de-mantencion");
	rmSync(root, { recursive: true, force: true });
});

test("project status reports registered and state paths", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	projectEnroll({
		projectPath,
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
	});
	const status = projectInstallStatus({
		projectPath,
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
		mcpAvailable: true,
	});
	assert.equal(status.registered, true);
	assert.equal(status.mcpAvailable, true);
	assert.match(formatProjectInstallStatus(status), /registered/u);
	rmSync(root, { recursive: true, force: true });
});

test("setup status formatter includes recommendations", () => {
	const text = formatIduSetupStatus({
		system: detectSystem({ platform: "linux", env: { SHELL: "bash" } }),
		tools: detectTools({ runner: () => undefined }),
		agentConfigs: detectAgentConfigs({
			env: {},
			homeDir: tempDir(),
			exists: () => false,
		}),
		mcpInstalled: false,
	});
	assert.match(text, /Idu-pi Setup/u);
	assert.match(text, /idu-pi setup mcp-init/u);
});

test("formatProjectEnrollResult shows created paths", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const result = projectEnroll({
		projectPath,
		workspaceRoot: join(root, "workspace"),
		allowedRoots: [root],
		registryPath: join(root, "registry.json"),
	});
	assert.match(formatProjectEnrollResult(result), /Proyecto enrolado/u);
	rmSync(root, { recursive: true, force: true });
});

test("CLI setup status works with temp environment", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["setup", "status"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Setup/u);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI setup mcp-init works in temp agent dir", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["setup", "mcp-init"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /MCP idu-pi configurado/u);
		assert.equal(existsSync(join(agentDir, "mcp.json")), true);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI project enroll works in temp project dir", async () => {
	const root = tempDir();
	const projectPath = join(root, "Sistema_de_mantencion");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["project", "enroll", projectPath]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Proyecto enrolado/u);
		assert.equal(
			existsSync(
				join(workspaceRoot, "projects", "sistema_de_mantencion", "reports"),
			),
			true,
		);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function setCliEnv(input: {
	projectPath: string;
	workspaceRoot: string;
	agentDir: string;
	allowedRoot: string;
}): void {
	process.env.DEFAULT_CWD = input.projectPath;
	process.env.ALLOWED_ROOTS = input.allowedRoot;
	process.env.AGENT_WORKSPACE_ROOT = input.workspaceRoot;
	process.env.PI_CODING_AGENT_DIR = input.agentDir;
	process.env.IDU_PI_REGISTRY_PATH = join(input.workspaceRoot, "projects.json");
	delete process.env.TELEGRAM_BOT_TOKEN;
	delete process.env.ALLOWED_USER_ID;
}

test("setup mcp-print does not require project env", async () => {
	const previous = snapshotEnv();
	try {
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		const result = await runCliCommand(["setup", "mcp-print"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /idu-pi/u);
	} finally {
		restoreEnv(previous);
	}
});

test("project status rejects paths outside allowed roots", () => {
	const root = tempDir();
	const allowed = join(root, "allowed");
	const outside = join(root, "outside");
	mkdirSync(allowed, { recursive: true });
	mkdirSync(outside, { recursive: true });
	assert.throws(
		() =>
			projectInstallStatus({
				projectPath: outside,
				workspaceRoot: join(root, "workspace"),
				allowedRoots: [allowed],
			}),
		/Ruta fuera de ALLOWED_ROOTS/u,
	);
	rmSync(root, { recursive: true, force: true });
});
