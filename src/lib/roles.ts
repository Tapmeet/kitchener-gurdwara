export type Role = 'PATH' | 'KIRTAN';
export const ROLES: Role[] = ['PATH', 'KIRTAN'];
export type RoleVector = Record<Role, number>;

export function add(a: RoleVector, b: RoleVector): RoleVector {
  return { PATH: (a.PATH || 0) + (b.PATH || 0), KIRTAN: (a.KIRTAN || 0) + (b.KIRTAN || 0) };
}

export function reqFromProgram(p: { minPathers: number; minKirtanis: number }): RoleVector {
  return { PATH: p.minPathers || 0, KIRTAN: p.minKirtanis || 0 };
}
