import type { McpToolCategory } from "../../runtime/config.js";

export const ZALO_PERSONAL_OPERATION_NAMES = [
  "acceptFriendRequest", "addGroupBlockedMember", "addGroupDeputy", "addPollOptions", "addQuickMessage", "addReaction",
  "addUnreadMark", "addUserToGroup", "blockUser", "blockViewFeed", "changeAccountAvatar", "changeFriendAlias",
  "changeGroupAvatar", "changeGroupName", "changeGroupOwner", "createAutoReply", "createCatalog", "createGroup", "createNote",
  "createPoll", "createProductCatalog", "createReminder", "deleteAutoReply", "deleteAvatar", "deleteCatalog", "deleteChat",
  "deleteGroupInviteBox", "deleteMessage", "deleteProductCatalog", "disableGroupLink", "disperseGroup", "editNote", "editReminder",
  "enableGroupLink", "fetchAccountInfo", "findUser", "findUserByUsername", "forwardMessage", "getAliasList", "getAllFriends",
  "getAllGroups", "getArchivedChatList", "getAutoDeleteChat", "getAutoReplyList", "getAvatarList", "getAvatarUrlProfile", "getBizAccount",
  "getCatalogList", "getCloseFriends", "getContext", "getCookie", "getFriendBoardList", "getFriendOnlines", "getFriendRecommendations",
  "getFriendRequestStatus", "getFullAvatar", "getGroupBlockedMember", "getGroupChatHistory", "getGroupInfo", "getGroupInviteBoxInfo",
  "getGroupInviteBoxList", "getGroupLinkDetail", "getGroupLinkInfo", "getGroupMembersInfo", "getHiddenConversations", "getLabels",
  "getListBoard", "getListReminder", "getMultiUsersByPhones", "getMute", "getOwnId", "getPendingGroupMembers", "getPinConversations",
  "getPollDetail", "getProductCatalogList", "getQR", "getQuickMessageList", "getRelatedFriendGroup", "getReminder", "getReminderResponses",
  "getSentFriendRequest", "getSettings", "getStickerCategoryDetail", "getStickers", "getStickersDetail", "getUnreadMark", "getUserInfo",
  "inviteUserToGroups", "joinGroupInviteBox", "joinGroupLink", "keepAlive", "lastOnline", "leaveGroup", "lockPoll", "parseLink",
  "rejectFriendRequest", "removeFriend", "removeFriendAlias", "removeGroupBlockedMember", "removeGroupDeputy", "removeQuickMessage",
  "removeReminder", "removeUnreadMark", "removeUserFromGroup", "resetHiddenConversPin", "reuseAvatar", "reviewPendingMemberRequest",
  "searchSticker", "sendBankCard", "sendCard", "sendDeliveredEvent", "sendFriendRequest", "sendLink", "sendMessage", "sendReport",
  "sendSeenEvent", "sendSticker", "sendTypingEvent", "sendVideo", "sendVoice", "setHiddenConversations", "setMute", "setPinnedConversations",
  "sharePoll", "unblockUser", "undo", "undoFriendRequest", "updateActiveStatus", "updateArchivedChatList", "updateAutoDeleteChat",
  "updateAutoReply", "updateCatalog", "updateGroupSettings", "updateHiddenConversPin", "updateLabels", "updateLang", "updateProductCatalog",
  "updateProfile", "updateProfileBio", "updateQuickMessage", "updateSettings", "upgradeGroupToCommunity", "uploadAttachment", "uploadProductPhoto",
  "votePoll",
] as const;

export type ZaloPersonalOperation = (typeof ZALO_PERSONAL_OPERATION_NAMES)[number];

export interface ZaloPersonalOperationDescriptor {
  category: McpToolCategory;
  description: string;
  sensitiveResult?: boolean;
}

const READ_OPERATIONS = new Set<ZaloPersonalOperation>([
  "fetchAccountInfo", "findUser", "findUserByUsername", "getAliasList", "getAllFriends", "getAllGroups", "getArchivedChatList",
  "getAutoDeleteChat", "getAutoReplyList", "getAvatarList", "getAvatarUrlProfile", "getBizAccount", "getCatalogList", "getCloseFriends",
  "getContext", "getCookie", "getFriendBoardList", "getFriendOnlines", "getFriendRecommendations", "getFriendRequestStatus", "getFullAvatar",
  "getGroupBlockedMember", "getGroupChatHistory", "getGroupInfo", "getGroupInviteBoxInfo", "getGroupInviteBoxList", "getGroupLinkDetail",
  "getGroupLinkInfo", "getGroupMembersInfo", "getHiddenConversations", "getLabels", "getListBoard", "getListReminder", "getMultiUsersByPhones",
  "getMute", "getOwnId", "getPendingGroupMembers", "getPinConversations", "getPollDetail", "getProductCatalogList", "getQR", "getQuickMessageList",
  "getRelatedFriendGroup", "getReminder", "getReminderResponses", "getSentFriendRequest", "getSettings", "getStickerCategoryDetail", "getStickers",
  "getStickersDetail", "getUnreadMark", "getUserInfo", "keepAlive", "lastOnline", "parseLink", "searchSticker",
]);

const MONEY_OPERATIONS = new Set<ZaloPersonalOperation>(["sendBankCard"]);
const DESTRUCTIVE_OPERATIONS = new Set<ZaloPersonalOperation>([
  "blockUser", "deleteAutoReply", "deleteAvatar", "deleteCatalog", "deleteChat", "deleteGroupInviteBox", "deleteMessage", "deleteProductCatalog",
  "disperseGroup", "leaveGroup", "removeFriend", "removeFriendAlias", "removeGroupBlockedMember", "removeGroupDeputy", "removeQuickMessage",
  "removeReminder", "removeUnreadMark", "removeUserFromGroup", "sendReport",
]);

export const ZALO_PERSONAL_OPERATION_DESCRIPTORS: Record<ZaloPersonalOperation, ZaloPersonalOperationDescriptor> = Object.fromEntries(
  ZALO_PERSONAL_OPERATION_NAMES.map((operation) => [operation, {
    category: MONEY_OPERATIONS.has(operation) ? "money" : DESTRUCTIVE_OPERATIONS.has(operation) ? "destructive" : READ_OPERATIONS.has(operation) ? "read" : "external_write",
    description: operation,
    ...(operation === "getContext" || operation === "getCookie" ? { sensitiveResult: true } : {}),
  }]),
) as Record<ZaloPersonalOperation, ZaloPersonalOperationDescriptor>;

export function isZaloPersonalOperation(value: string): value is ZaloPersonalOperation {
  return (ZALO_PERSONAL_OPERATION_NAMES as readonly string[]).includes(value);
}

export function redactZaloPersonalOperationResult(operation: ZaloPersonalOperation, result: unknown): unknown {
  if (operation !== "getContext" && operation !== "getCookie") return result;
  return { available: true, message: `Zalo Personal ${operation} result was retrieved but is intentionally redacted.` };
}
