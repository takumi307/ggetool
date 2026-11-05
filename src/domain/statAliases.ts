/**
 * The courtyard attack bonus on gems (G008) is the same in-game effect as
 * the equipment bonus (S003). Keep both persisted IDs for backup compatibility,
 * but aggregate them under the equipment stat ID for optimization and caps.
 */
export function canonicalStatId(id: string): string {
  return id === 'G008' ? 'S003' : id
}
