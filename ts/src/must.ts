/** Narrows a value the parser guarantees is present; Go would panic on the nil dereference this stands in for. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('unexpected missing value')
  return value
}
