export function flag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parsePort(args: string[], fallback: number): number {
  const raw = flag(args, "port");
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    throw new Error(`invalid --port=${raw}`);
  }
  return n;
}
