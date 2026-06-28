'use strict';

const domain = require('../domain/message');
const NotificationService = require('./notification.service');
const bus = require('../realtime/bus');
const {
  getConversationRepository,
  getMessageRepository,
  getBookingRepository,
} = require('../repositories');
const { USER_ROLES, NOTIFICATION_TYPES } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/**
 * Booking-scoped messaging between a customer and a provider. The same service
 * powers both the REST API (history/send) and the Socket.IO gateway, so access
 * control and persistence live in one place.
 */
class MessageService {
  static get conversations() {
    return getConversationRepository();
  }

  static get messages() {
    return getMessageRepository();
  }

  /** Find or create the conversation for a booking; asserts participation. */
  static async getOrCreateConversation(actor, bookingReference) {
    const booking = await getBookingRepository().findByReference(bookingReference);
    if (!booking) throw ApiError.notFound('Booking not found');
    MessageService._assertParticipant(booking, actor);

    let conversation = await MessageService.conversations.findByBooking(bookingReference);
    if (!conversation) {
      conversation = await MessageService.conversations.create(
        domain.createConversation(bookingReference, booking.customerId, booking.providerId)
      );
    }
    return conversation;
  }

  static async listConversations(actor) {
    const list = await MessageService.conversations.listByParticipant(actor.id);
    return list.map(domain.conversationJSON);
  }

  static async listMessages(actor, bookingReference, { limit } = {}) {
    const conversation = await MessageService.getOrCreateConversation(actor, bookingReference);
    const msgs = await MessageService.messages.listByConversation(conversation.id, { limit });
    return { conversation: domain.conversationJSON(conversation), messages: msgs.map(domain.messageJSON) };
  }

  static async sendMessage(actor, bookingReference, input) {
    const conversation = await MessageService.getOrCreateConversation(actor, bookingReference);
    const message = await MessageService.messages.create(
      domain.createMessage(conversation.id, actor.id, input)
    );

    conversation.lastMessageAt = new Date();
    await MessageService.conversations.save(conversation);

    const recipient =
      actor.id === conversation.customerId ? conversation.providerId : conversation.customerId;

    // Real-time push to the room + an in-app/push notification to the recipient.
    bus.emit('message:new', conversation.id, domain.messageJSON(message));
    await NotificationService.emit(recipient, NOTIFICATION_TYPES.NEW_MESSAGE, {
      bookingReference,
      conversationId: conversation.id,
      preview: message.type === 'text' ? message.text.slice(0, 80) : `[${message.type}]`,
    });

    return domain.messageJSON(message);
  }

  static async markRead(actor, bookingReference) {
    const conversation = await MessageService.getOrCreateConversation(actor, bookingReference);
    await MessageService.messages.markRead(conversation.id, actor.id);
    bus.emit('message:read', conversation.id, { userId: actor.id });
    return { success: true };
  }

  static _assertParticipant(booking, actor) {
    const ok =
      actor.role === USER_ROLES.ADMIN ||
      actor.id === booking.customerId ||
      actor.id === booking.providerId;
    if (!ok) throw new ApiError(403, 'You are not part of this conversation');
  }
}

module.exports = MessageService;
