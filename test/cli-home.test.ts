import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildCliHomeStatus,
	formatCliHome,
	formatSetupPathHelp,
} from "../src/cli-home.js";
import { runCliCommand } from "../src/cli.js";

function tempDir(prefix = "idu-cli-home-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PNPM_HOME: process.env.PNPM_HOME,
		PATH: process.env.PATH,
		Path: process.env.Path,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

test("idu-pi without args shows home", async () => {
	const result = await runCliCommand([]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /^Idu-pi/mu);
	assert.match(result.stdout, /Acciones:/u);
});

test("home does not write files", async () => {
	const root = tempDir();
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		delete process.env.PI_CODING_AGENT_DIR;
		const before = readdirSync(root);
		const result = await runCliCommand(["home"]);
		const after = readdirSync(root);
		assert.equal(result.exitCode, 0);
		assert.deepEqual(after, before);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("home detects cwd project candidate from git root", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const status = buildCliHomeStatus({
		cwd: join(projectPath, "subdir"),
		gitRoot: projectPath,
		env: {
			DEFAULT_CWD: projectPath,
			ALLOWED_ROOTS: root,
			AGENT_WORKSPACE_ROOT: join(root, "workspace"),
			PATH: "",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(status.project.candidatePath, projectPath);
	assert.equal(status.project.isGitRepository, true);
	rmSync(root, { recursive: true, force: true });
});

test("home shows MCP installed and missing states", () => {
	const root = tempDir();
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	const missing = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(missing.mcpInstalled, false);
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "node" } } }),
		"utf8",
	);
	const installed = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(installed.mcpInstalled, true);
	rmSync(root, { recursive: true, force: true });
});

test("home shows enrolled and unenrolled project states", () => {
	const root = tempDir();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		const projectPath = join(root, "project");
		const workspaceRoot = join(root, "workspace");
		mkdirSync(join(root, "data"), { recursive: true });
		mkdirSync(projectPath, { recursive: true });
		const registryPath = join(root, "data", "projects.json");
		const unregistered = buildCliHomeStatus({
			cwd: projectPath,
			gitRoot: projectPath,
			registryPath,
			env: {
				DEFAULT_CWD: projectPath,
				ALLOWED_ROOTS: root,
				AGENT_WORKSPACE_ROOT: workspaceRoot,
				PATH: "",
			},
			runner: () => undefined,
			stdinInteractive: false,
		});
		assert.equal(unregistered.project.registered, false);
		writeFileSync(
			registryPath,
			JSON.stringify({
				activeProjectId: "project",
				projects: [
					{
						id: "project",
						name: "project",
						path: projectPath,
						stateRoot: join(workspaceRoot, "projects", "project"),
					},
				],
			}),
			"utf8",
		);
		const registered = buildCliHomeStatus({
			cwd: projectPath,
			gitRoot: projectPath,
			registryPath,
			env: {
				DEFAULT_CWD: projectPath,
				ALLOWED_ROOTS: root,
				AGENT_WORKSPACE_ROOT: workspaceRoot,
				PATH: "",
			},
			runner: () => undefined,
			stdinInteractive: false,
		});
		assert.equal(registered.project.registered, true);
		assert.match(formatCliHome(registered), /Proyecto enrolado: sí/u);
	} finally {
		process.chdir(previousCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("home shows PATH help when pnpm global bin is not in PATH", () => {
	const status = buildCliHomeStatus({
		env: {
			PNPM_HOME: "C:\\Users\\elmas\\AppData\\Local\\pnpm\\bin",
			PATH: "C:\\Windows",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	const text = formatCliHome(status);
	assert.match(text, /PNPM_HOME no está en PATH/u);
	assert.match(text, /corepack pnpm setup/u);
});

test("setup wizard in non-interactive mode does not wait", async () => {
	const result = await runCliCommand(["setup", "wizard"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /stdin no es interactivo/u);
});

test("setup path-help shows pnpm setup and global link steps", async () => {
	const result = await runCliCommand(["setup", "path-help"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /corepack pnpm setup/u);
	assert.match(result.stdout, /corepack pnpm link --global/u);
	assert.match(formatSetupPathHelp(), /No modifico PATH automáticamente/u);
});

test("existing setup command still works", async () => {
	const result = await runCliCommand(["setup", "status"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Idu-pi Setup/u);
});
