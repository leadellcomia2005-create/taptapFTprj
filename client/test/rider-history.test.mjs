import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryHistoryTime, prioritizeAssignedDeliveries } from '../src/features/workspaces/riderWorkflow.ts';

test('delivery history uses completion time newest first and preserves active priority', () => {
  const orders = [
    { id: 'old', status: 'delivered', deliveredAt: 100, createdAt: 90 },
    { id: 'new', status: 'completed', completedAt: 300, createdAt: 80 },
    { id: 'middle', status: 'delivered', deliveredAt: 200 },
    { id: 'ready', status: 'ready', createdAt: 500 },
    { id: 'arrived', status: 'arrived', createdAt: 600 }
  ];
  assert.deepEqual(prioritizeAssignedDeliveries(orders).map(order => order.id), ['arrived', 'ready', 'new', 'middle', 'old']);
  assert.equal(orders[0].id, 'old');
});

test('legacy history falls back to order date instead of later remittance updates', () => {
  assert.equal(deliveryHistoryTime({ id: 'legacy', status: 'delivered', createdAt: 100, updatedAt: 900 }), 100);
});
