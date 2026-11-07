import { SLOT_TYPES, type Equipment, type EquipmentAllocation } from './types'

export function equipmentAvailability(equipment: Equipment[], allocations: EquipmentAllocation[]) {
  const reserved = new Set(allocations.map(allocation => allocation.equipmentId))
  return SLOT_TYPES.map(slot => ({
    slot,
    available: equipment.filter(item => item.slotType === slot && !reserved.has(item.id)).length,
  }))
}
