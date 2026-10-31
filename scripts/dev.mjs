// Starts the relay server and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const run = (name, color, cmd) => {
  const child = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) => out.write(String(d).split(/\r?\n/).filter(Boolean).map((l) => prefix + l).join('\n') + '\n'));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited (${code ?? 0})`);
    process.exit(code ?? 0);
  });
  return child;
};

const children = [run('server', 36, 'npx tsx server/index.ts'), run('client', 35, 'npx vite')];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
