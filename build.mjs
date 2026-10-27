import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const run = promisify(execFile);
const dockerBuild = process.env.DOJO_DOCKER_BUILD === "1";

const serverDirectories = [
	"accounts",
	"lib",
	"pushtx",
	"scripts",
	"tracker",
	...(dockerBuild ? [] : ["keys"]),
];

await rm(dist, { recursive: true, force: true });

await build({
	absWorkingDir: root,
	entryPoints: [
		...serverDirectories.map((directory) => `${directory}/**/*.ts`),
		...(dockerBuild
			? [{ in: "docker/my-dojo/node/keys.index.ts", out: "keys/index" }]
			: []),
	],
	outbase: root,
	outdir: dist,
	platform: "node",
	format: "esm",
	target: "node24",
	packages: "external",
});

await run(join(root, "node_modules/.bin/vite"), ["build"], {
	cwd: join(root, "admin-app"),
});

const adminOutput = join(dist, "static/admin");
await mkdir(adminOutput, { recursive: true });
await cp(join(root, "admin-app/dist/client"), adminOutput, { recursive: true });
await cp(join(adminOutput, "_shell.html"), join(adminOutput, "index.html"));
await mkdir(join(adminOutput, "dmt"), { recursive: true });
await cp(join(adminOutput, "_shell.html"), join(adminOutput, "dmt/index.html"));
