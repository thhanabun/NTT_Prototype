import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudTemplate, bootstrapTemplate } from "../infra/cloud/template.mjs";

const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(root, 'data/cloud-package');
const marker = resolve(root, 'data/cloud-package.marker');
if (target !== resolve(root, 'data', 'cloud-package')) throw new Error('Unexpected package path');
await mkdir(resolve(root, 'data'), { recursive: true });
try {
  const contents = await readdir(target);
  const recognized = contents.includes('.basketly-cloud-package') || await readFile(marker, 'utf8').then(value => value.trim() === target).catch(() => false);
  if (contents.length && !recognized) throw new Error('Refusing to replace an unrecognized directory');
  await writeFile(marker, target + '\n');
  if (contents.length && process.platform === 'win32') {
    // OneDrive can expose this generated package as read-only cloud-file reparse points.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; $root=[IO.Path]::GetFullPath($env:FAST_CLOUD_REPO_ROOT).TrimEnd('\\'); $target=[IO.Path]::GetFullPath($env:FAST_CLOUD_PACKAGE_TARGET); if ($target -ne [IO.Path]::GetFullPath((Join-Path $root 'data/cloud-package')) -or (Get-Content -LiteralPath (Join-Path $root 'data/cloud-package.marker') -Raw).Trim() -ne $target -or -not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to replace an unrecognized cloud package path' }; Remove-Item -LiteralPath $target -Recurse -Force"], { env: { ...process.env, FAST_CLOUD_REPO_ROOT: root, FAST_CLOUD_PACKAGE_TARGET: target } });
  } else if (contents.length) await rm(target, { recursive: true, force: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(target, { recursive: true });
await writeFile(marker, target + '\n');
await writeFile(join(target, '.basketly-cloud-package'), 'Generated Lambda source package; safe to regenerate\n');
for (const name of ['src', 'package.json', 'package-lock.json']) await cp(join(root, name), join(target, name), { recursive: true });
for (const [name, template] of [['template', cloudTemplate()], ['bootstrap', bootstrapTemplate()]]) await writeFile(resolve(root, 'infra/cloud', name + '.json'), JSON.stringify(template, null, 2) + '\n');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
console.log(JSON.stringify({ package: target, templates: ['infra/cloud/template.json', 'infra/cloud/bootstrap.json'], runtimeDependencies: Object.keys(pkg.dependencies), cloudResourcesCreated: false }, null, 2));
