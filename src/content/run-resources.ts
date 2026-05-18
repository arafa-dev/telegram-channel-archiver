export interface RunResourceGlobals<TPool, TPort> {
  activeRunId: number;
  pool: TPool | null;
  keepalivePort: TPort | null;
}

export interface RunResources<TPool, TPort> {
  runId: number;
  pool: TPool;
  keepalivePort: TPort;
}

export function clearRunGlobalsIfCurrent<TPool, TPort>(
  globals: RunResourceGlobals<TPool, TPort>,
  resources: RunResources<TPool, TPort>
): RunResourceGlobals<TPool, TPort> {
  if (globals.activeRunId !== resources.runId) return globals;

  return {
    activeRunId: globals.activeRunId,
    pool: globals.pool === resources.pool ? null : globals.pool,
    keepalivePort: globals.keepalivePort === resources.keepalivePort ? null : globals.keepalivePort,
  };
}
