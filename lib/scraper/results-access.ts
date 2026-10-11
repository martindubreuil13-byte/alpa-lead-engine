/** Guest results remain a five-lead preview; signed-in users see and export their complete saved batch. */
export function getAccessibleResults<T>(leads: T[], fullAccess: boolean): T[] {
  return fullAccess ? leads : leads.slice(0, 5)
}
