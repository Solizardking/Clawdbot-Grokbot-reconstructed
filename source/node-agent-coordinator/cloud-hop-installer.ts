import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

type Execute = (name: string, args: unknown) => Promise<unknown>;
type Artifact = { name: "openai-hop-session.cjs" | "provider-maps.cjs"; bytes: Buffer };

export async function installCloudHop(artifacts: readonly Artifact[], execute: Execute) {
  await execute("e2b_computer_status", {});
  async function command(command: string) {
    const result = await execute("e2b_computer_run_command", { command }) as { exitCode?: number; stdout?: string; stderr?: string };
    if (result?.exitCode !== 0) throw new Error(`Cloud hop installation command failed (exit ${result?.exitCode}); installation is not verified. ${(result?.stderr ?? "").slice(0,500)}`);
    return result.stdout ?? "";
  }
  const prepared = await command("mkdir -p /home/user/sand-data && mktemp -d /home/user/sand-data/.hop-install-XXXXXX");
  const staging = prepared.trim();
  if (!/^\/home\/user\/sand-data\/\.hop-install-[A-Za-z0-9]{6,}$/.test(staging)) throw new Error("Cloud hop staging directory was not confirmed.");
  const nodePath = (await command(`python3 - <<'PY'
import hashlib, io, platform, shutil, subprocess, tarfile, urllib.request
from pathlib import Path
existing=shutil.which('node')
if existing and subprocess.run([existing,'--version'],capture_output=True,text=True).stdout.strip() == 'v26.5.0':
 print(existing)
else:
 arch={'x86_64':('x64','22b5f47ad6ae78837e4c2b846019965ce1a06ba143de176102294a1bf44fc677'),'aarch64':('arm64','308e5fe89a82461ba5a6cf15ff5221b2cdbd7ae87600aa72bb3c3fbdc66412d1')}.get(platform.machine())
 assert platform.system() == 'Linux' and arch, 'Unsupported cloud Node platform'
 name='node-v26.5.0-linux-'+arch[0]
 with urllib.request.urlopen('https://nodejs.org/dist/v26.5.0/'+name+'.tar.gz',timeout=20) as r: data=r.read(100000001)
 assert len(data)<=100000000 and hashlib.sha256(data).hexdigest() == arch[1], 'Node download checksum failed'
 destination=Path('/home/user/sand-data/bin/node')
 destination.parent.mkdir(parents=True,exist_ok=True)
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  binary=archive.extractfile(name+'/bin/node')
  assert binary is not None
  temporary=destination.with_suffix('.new')
  temporary.write_bytes(binary.read())
  temporary.chmod(0o755)
  temporary.replace(destination)
 assert subprocess.check_output([str(destination),'--version'],text=True).strip() == 'v26.5.0'
 print(destination)
PY`)).trim();
  if (!/^\/[A-Za-z0-9_./-]+\/node$/.test(nodePath)) throw new Error("Cloud Node runtime was not confirmed.");
  const installed = [];
  for (const artifact of artifacts) {
    const encoded = gzipSync(artifact.bytes).toString("base64");
    const digest = createHash("sha256").update(artifact.bytes).digest("hex");
    const temporary = `${staging}/${artifact.name}`;
    // Compressed chunks stay below the hosted command limit. The only embedded
    // data are validated paths, base64 and hex, never raw source or credentials.
    for (let offset = 0; offset < encoded.length; offset += 10000) {
      await command(`python3 - <<'PY'\nfrom pathlib import Path\nwith Path('${temporary}.b64').open('a') as f: f.write('${encoded.slice(offset, offset + 10000)}')\nPY`);
    }
    await command(`python3 - <<'PY'\nfrom pathlib import Path\nimport base64, gzip, hashlib\np=Path('${temporary}')\ndata=gzip.decompress(base64.b64decode(Path(str(p)+'.b64').read_text(), validate=True))\nassert hashlib.sha256(data).hexdigest() == '${digest}', 'File verification failed'\np.write_bytes(data)\nPY`);
    installed.push({ name: artifact.name, bytes: artifact.bytes.length, sha256: digest });
  }
  await command(`'${nodePath}' --check '${staging}/openai-hop-session.cjs' && '${nodePath}' --check '${staging}/provider-maps.cjs'`);
  await command(`python3 - <<'PY'\nfrom pathlib import Path\nimport hashlib, shutil\ns=Path('${staging}')\nexpected=${JSON.stringify(Object.fromEntries(installed.map(file => [file.name, file.sha256])))}\nfor name, digest in expected.items():\n p=s/name\n assert hashlib.sha256(p.read_bytes()).hexdigest() == digest\n p.replace(Path('/home/user/sand-data')/name)\nfor name, digest in expected.items():\n assert hashlib.sha256((Path('/home/user/sand-data')/name).read_bytes()).hexdigest() == digest\nshutil.rmtree(s)\nprint('verified')\nPY`);
  return { ok: true, dest: "/home/user/sand-data", nodePath, nodeVersion: "26.5.0", files: installed, consumerInstalled: false,
    note: "Hop files verified. A host binding consumer and a routed conversation still need to be configured and verified." };
}
