// Emitted once per pod flip; the tick that crosses the flip time owns the record.
export function crossed(t: Date, stepMs: number, when: number): boolean {
  return t.getTime() - stepMs < when && when <= t.getTime();
}
