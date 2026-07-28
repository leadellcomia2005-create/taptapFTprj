import type { Order } from "../../types/domain";

type WorkflowOrder = Pick<Order, "id" | "status"> & Partial<Order>;

const statusPriority: Record<string, number> = {
  arrived: 0,
  "out-for-delivery": 1,
  ready: 2,
  preparing: 3,
  received: 4,
  "pending-payment": 5,
  delivered: 20,
  completed: 21,
  cancelled: 22
};

function oldestFirst(first: WorkflowOrder, second: WorkflowOrder): number {
  const firstTime = Number(first.assignedAt || first.createdAt || 0);
  const secondTime = Number(second.assignedAt || second.createdAt || 0);
  return firstTime - secondTime || String(first.id).localeCompare(String(second.id));
}

export function prioritizeAssignedDeliveries<T extends WorkflowOrder>(orders: readonly T[]): T[] {
  return [...orders].sort((first, second) => (
    (statusPriority[first.status] ?? 10) - (statusPriority[second.status] ?? 10)
    || oldestFirst(first, second)
  ));
}

export function prioritizeAvailableDeliveries<T extends WorkflowOrder>(orders: readonly T[]): T[] {
  return [...orders].sort(oldestFirst);
}
