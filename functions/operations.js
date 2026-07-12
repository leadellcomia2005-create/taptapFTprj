// Firebase Functions is an optional adapter. The Express domain is the single
// source of truth for order, catalog, inventory, rider, and review operations.
export {
  canAccessOrder,
  HttpError,
  validRecordId
} from "../server/src/security.js";

export {
  adjustInventoryRecord,
  createMenuItemRecord,
  createOrderRecord,
  listOrdersForUser,
  saveDeliveryProofRecord,
  saveRiderLocationRecord,
  saveShiftLogRecord,
  updateMenuItemRecord,
  updateOrderRecord,
  updateReviewRecord
} from "../server/src/business.js";
