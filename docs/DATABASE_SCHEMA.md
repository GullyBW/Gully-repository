# Database schema

MongoDB (Mongoose). All collections also have an in-memory repository for tests.
Amounts are integers in **minor units** (thebe). Keys below omit `_id`/timestamps.

## users
`id` (uuid, unique), `name`, `email` (unique), `passwordHash`, `role`
(customer|provider|admin), `phone`, `profile`, `avatarUrl`, `emailVerified`,
`emailVerificationToken`, `passwordResetToken`/`Expires`, `suspended`,
`suspendedReason`, `blockedUserIds[]`.

## providers  (keyed by owning user)
`userId` (unique), `businessName`, `fullName`, `bio`, `category`, `categories[]`,
`yearsExperience`, `languages[]`, `certifications[]`, `licenses[]`, `profilePhoto`,
`portfolio[]`, `areasServed[]`, `operatingHours`, `startingPrice`,
`location{lat,lng,address}`, `verified`, `availabilityStatus`, `responseTimeMinutes`,
`rating`, `ratingSum`, `reviewCount`, `completedJobs`, `responseRate`,
`cancellationRate`, `memberSince`.

## bookings
`reference` (unique), `customerId`, `providerId`, `serviceType`, `description`,
`scheduledFor`, `location{address,lat,lng}`, `amount`, `currency`, `status`
(pending|accepted|in_progress|completed|cancelled|declined), `paymentReference`,
`paymentStatus`.

## transactions  (payment module — read-only elsewhere)
`reference` (unique), `bookingId`, `customerId`, `providerId`, `method`, `status`,
`amount`, `currency`, `payerMsisdn`, `providerTransactionId`, `providerMeta`,
`description`, `metadata`, `events[]`.

## reviews
`id`, `providerId`, `customerId`, `bookingReference` (unique), `rating` (1–5),
`title`, `comment`, `photos[]`, `customerName`, `status`
(published|reported|removed), `reportCount`, `reports[]`.

## availabilities  (keyed by provider)
`providerId` (unique), `workingDays[0–6]`, `startTime`, `endTime`, `slotMinutes`,
`holidays[YYYY-MM-DD]`, `emergencyAvailable`, `vacationMode`, `vacationUntil`.

## favourites
`id`, `customerId`, `providerId` (unique pair).

## notifications
`id`, `userId`, `type`, `title`, `body`, `data`, `read`, `createdAt`.

## deviceTokens
`id`, `userId`, `token` (unique), `platform` (android|ios|web), `lastSeenAt`.

## notificationPreferences  (keyed by user)
`userId` (unique), `categories{bookings,payments,reviews,messages,social,marketing:boolean}`.

## savedAddresses
`id`, `customerId`, `label`, `address`, `lat`, `lng`, `isDefault`.

## conversations  (one per booking)
`id`, `bookingReference` (unique), `customerId`, `providerId`, `lastMessageAt`.

## messages
`id`, `conversationId`, `senderId`, `type` (text|image|location), `text`,
`imageUrl`, `location{lat,lng}`, `readBy[]`, `reactions[{userId,emoji}]`,
`forwardedFrom`, `createdAt`.

## refreshTokens
`id`, `userId`, `tokenHash` (sha256), `device`, `ip`, `revoked`, `expiresAt`,
`lastUsedAt`.

## auditLogs
`id`, `action`, `actorId`, `targetId`, `ip`, `meta`, `createdAt`.

> Indexes exist on all lookup keys above (unique refs, `userId`, `email`,
> `status`, `providerId`, `createdAt`, etc.). See each `src/models/*.model.js`.
