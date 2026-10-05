import {
  deleteSupportConversation as deleteSupportConversationCompatibility,
  sendSupportMessage as sendSupportMessageCompatibility,
  replyToSupportConversation as replyToSupportConversationCompatibility,
  requestSupportStaff as requestSupportStaffCompatibility,
  resumeSupportAssistant as resumeSupportAssistantCompatibility,
  subscribeSupportConversation as subscribeSupportConversationCompatibility,
  subscribeSupportMessages as subscribeSupportMessagesCompatibility
} from "../firebase.js";
import type { AppUser, EntityId, SupportConversation, SupportMessage } from "../../types/domain";

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

export const subscribeSupportConversation = (
  callback: (conversation: SupportConversation) => void,
  customerId: EntityId
): (() => void) => subscribeSupportConversationCompatibility(callback, customerId);

export const replyToSupportConversation = (
  text: string,
  actor: Pick<AppUser, "uid" | "name" | "role">,
  conversation: { customerId: EntityId; customerName: string }
) => replyToSupportConversationCompatibility(text, actor, conversation);

export const resumeSupportAssistant = (
  customerId: EntityId,
  actor: Pick<AppUser, "uid" | "name" | "role">
) => resumeSupportAssistantCompatibility(customerId, actor);

export const deleteSupportConversation = (
  customerId: EntityId,
  actor: Pick<AppUser, "uid" | "name" | "role">
) => deleteSupportConversationCompatibility(customerId, actor);

export const requestSupportStaff = (
  customerId: EntityId,
  actor: Pick<AppUser, "uid" | "name" | "role">,
  reason = ""
) => requestSupportStaffCompatibility(customerId, actor, reason);
