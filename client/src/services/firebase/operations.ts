import {
  sendSupportMessage as sendSupportMessageCompatibility,
  subscribeSupportMessages as subscribeSupportMessagesCompatibility
} from "../firebase.js";
import type { AppUser, EntityId, SupportMessage } from "../../types/domain";

export {
  archiveCompletedOrders,
  closeActiveShift,
  createApprovalRequest,
  getActiveShift,
  resolveApprovalRequest,
  saveShiftLog,
  startShift,
  subscribeApprovalRequests,
  subscribeAuditLogs,
  subscribeShiftLogs,
} from "../firebase.js";

export const sendSupportMessage = (
  text: string,
  actor: Pick<AppUser, "uid" | "name"> & Partial<Pick<AppUser, "role">>,
  conversation: { customerId: EntityId; customerName: string; conversationId: EntityId }
): Promise<void> => sendSupportMessageCompatibility(text, actor, conversation);

export const subscribeSupportMessages = (
  callback: (messages: SupportMessage[]) => void,
  customerId?: EntityId
): (() => void) => (subscribeSupportMessagesCompatibility as unknown as (
  callback: (messages: SupportMessage[]) => void,
  customerId?: EntityId
) => () => void)(callback, customerId);
