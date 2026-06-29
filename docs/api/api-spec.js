'use strict';

/**
 * Single source of truth for the Tirelo Services REST API documentation.
 *
 * `scripts/generate-api-docs.js` turns this into an OpenAPI 3.0 document, a
 * Postman v2.1 collection and a Postman environment. Keeping the inventory here
 * (rather than hand-editing JSON) means the OpenAPI spec and the Postman
 * collection never drift apart.
 *
 * Endpoint shape:
 *   { method, path, summary, auth, query?, body?, form?, note? }
 *     auth: 'public' | 'user' | 'provider' | 'admin'
 *           (provider/admin also imply authentication; documented as the
 *            minimum role the route enforces)
 *     query: [{ name, example, description?, required? }]
 *     body:  a JSON example object (request body)
 *     form:  [{ name, type:'file'|'text', description? }] for multipart uploads
 * Path params (`:name`) are detected automatically from the path.
 */

const info = {
  title: 'Tirelo Services API',
  version: '1.0.0',
  description:
    'REST API for Tirelo Services — a Botswana on-demand local-services marketplace ' +
    '(provider discovery, bookings, payments, reviews, messaging, notifications, ' +
    'analytics and admin).\n\n' +
    '## Conventions\n' +
    '- All responses are JSON enveloped as `{ "success": true, "data": ... }`; errors are ' +
    '`{ "success": false, "error": { "message": ..., "details"?: ... } }`.\n' +
    '- Monetary amounts are integers in **minor units** (thebe; 100 thebe = 1 BWP).\n' +
    '- Authentication is a Bearer JWT in the `Authorization` header: `Authorization: Bearer <accessToken>`.\n' +
    '- Obtain tokens via `POST /api/auth/login` (or `/register`), refresh via `POST /api/auth/refresh`.\n',
};

// Reusable request body examples.
const examples = {
  register: {
    name: 'Kagiso Modise',
    email: 'kagiso@example.bw',
    password: 'Sup3rSecret!',
    role: 'customer',
    phone: '+26771000000',
  },
  login: { email: 'kagiso@example.bw', password: 'Sup3rSecret!' },
  refresh: { refreshToken: '{{refreshToken}}' },
  logout: { refreshToken: '{{refreshToken}}' },
  verifyEmail: { token: 'email-verification-token' },
  forgot: { email: 'kagiso@example.bw' },
  reset: { token: 'password-reset-token', password: 'N3wSecret!' },
  providerUpsert: {
    businessName: "Kagiso's Plumbing",
    fullName: 'Kagiso Modise',
    bio: 'Licensed plumber serving Gaborone and surrounds.',
    category: 'plumber',
    categories: ['plumber', 'general_handyman'],
    yearsExperience: 8,
    languages: ['Setswana', 'English'],
    startingPrice: 25000,
    operatingHours: 'Mon-Sat 08:00-17:00',
    location: { lat: -24.6282, lng: 25.9231, address: 'Gaborone' },
    responseTimeMinutes: 30,
  },
  providerAvailability: { status: 'available' },
  providerVerify: { verified: true },
  reviewCreate: {
    providerId: 'prov-123',
    bookingReference: 'BKG-ABC123',
    rating: 5,
    title: 'Excellent work',
    comment: 'Fast, tidy and professional.',
    photos: [],
  },
  reviewEdit: { rating: 4, comment: 'Updated: still great.' },
  reportReason: { reason: 'Inappropriate content' },
  reviewModerate: { action: 'remove' },
  availabilityUpsert: {
    workingDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '17:00',
    slotMinutes: 60,
    holidays: ['2026-07-01'],
    emergencyAvailable: false,
    vacationMode: false,
    vacationUntil: null,
  },
  device: { token: 'fcm-device-token-abc123', platform: 'android' },
  preferences: { bookings: true, payments: true, messages: true, marketing: false },
  geocode: { address: 'Plot 123, Gaborone' },
  address: {
    label: 'Home',
    address: 'Plot 123, Gaborone',
    lat: -24.6282,
    lng: 25.9231,
    isDefault: true,
  },
  messageSend: { type: 'text', text: 'Hi, are you available tomorrow morning?' },
  messageReact: { messageId: 'msg-123', emoji: '👍' },
  bookingCreate: {
    providerId: 'prov-123',
    serviceType: 'plumber',
    description: 'Leaking kitchen tap needs repair.',
    scheduledFor: '2026-07-05T09:00:00.000Z',
    amount: 35000,
    currency: 'BWP',
    location: { address: 'Plot 123, Gaborone', lat: -24.6282, lng: 25.9231 },
  },
  bookingStatus: { status: 'accepted' },
  bookingPay: { method: 'orange_money', payerMsisdn: '+26771000000' },
  paymentCreate: {
    customerId: 'cust-123',
    bookingId: 'BKG-ABC123',
    providerId: 'prov-123',
    amount: 35000,
    currency: 'BWP',
    method: 'orange_money',
    payerMsisdn: '+26771000000',
    description: 'Plumbing job',
  },
  paymentCancel: { reason: 'Customer abandoned checkout' },
  paymentWebhook: { reference: 'TRL-XXXX', status: 'PAID' },
  broadcast: { role: 'customer', title: 'Scheduled maintenance', body: 'The app will be briefly unavailable tonight.' },
  suspend: { suspended: true, reason: 'Policy violation' },
  adminCancel: { reason: 'Fraudulent booking' },
  adminRefund: { reason: 'Service not delivered' },
};

// Common query-param descriptors reused across endpoints.
const pagination = [
  { name: 'page', example: '1', description: 'Page number (default 1).' },
  { name: 'limit', example: '10', description: 'Items per page (max 50).' },
];

const groups = [
  {
    tag: 'Auth',
    description: 'Registration, login, token refresh, sessions and password reset.',
    base: '/api/auth',
    endpoints: [
      { method: 'POST', path: '/register', summary: 'Register a customer or provider', auth: 'public', body: examples.register },
      { method: 'POST', path: '/login', summary: 'Log in and receive access + refresh tokens', auth: 'public', body: examples.login },
      { method: 'POST', path: '/refresh', summary: 'Rotate the refresh token for a new access token', auth: 'public', body: examples.refresh },
      { method: 'POST', path: '/logout', summary: 'Revoke a refresh token (sign out)', auth: 'public', body: examples.logout },
      { method: 'POST', path: '/verify-email', summary: 'Verify an email address with a token', auth: 'public', body: examples.verifyEmail },
      { method: 'POST', path: '/forgot-password', summary: 'Request a password-reset token', auth: 'public', body: examples.forgot },
      { method: 'POST', path: '/reset-password', summary: 'Set a new password using a reset token', auth: 'public', body: examples.reset },
      { method: 'GET', path: '/me', summary: 'Get the authenticated user profile', auth: 'user' },
      { method: 'GET', path: '/sessions', summary: 'List active refresh-token sessions', auth: 'user' },
      { method: 'DELETE', path: '/sessions/:id', summary: 'Revoke a specific session', auth: 'user' },
    ],
  },
  {
    tag: 'Categories',
    description: 'Service category catalogue.',
    base: '/api/categories',
    endpoints: [
      { method: 'GET', path: '/', summary: 'List service categories', auth: 'public' },
    ],
  },
  {
    tag: 'Providers',
    description: 'Provider discovery, profiles and self-management.',
    base: '/api/providers',
    endpoints: [
      {
        method: 'GET', path: '/', summary: 'Search / discover providers', auth: 'public',
        query: [
          { name: 'q', example: 'plumb', description: 'Free-text search (business name, name, bio).' },
          { name: 'category', example: 'plumber', description: 'Service category key.' },
          { name: 'minRating', example: '4', description: 'Minimum average rating.' },
          { name: 'maxPrice', example: '50000', description: 'Max starting price (minor units).' },
          { name: 'availableOnly', example: 'true', description: 'Only providers currently available.' },
          { name: 'verifiedOnly', example: 'true', description: 'Only verified providers.' },
          { name: 'lat', example: '-24.6282', description: 'Caller latitude (enables distance ranking).' },
          { name: 'lng', example: '25.9231', description: 'Caller longitude.' },
          { name: 'maxDistanceKm', example: '20', description: 'Filter to within this distance (requires lat/lng).' },
          { name: 'sort', example: 'highest_rated', description: 'nearest | highest_rated | lowest_price | most_jobs | fastest_response.' },
          ...pagination,
        ],
      },
      { method: 'GET', path: '/me', summary: 'Get my provider profile', auth: 'user' },
      { method: 'POST', path: '/', summary: 'Create or update my provider profile', auth: 'provider', body: examples.providerUpsert },
      { method: 'PATCH', path: '/availability', summary: 'Set my live availability status', auth: 'provider', body: examples.providerAvailability },
      { method: 'PATCH', path: '/:userId/verify', summary: 'Verify / unverify a provider (admin)', auth: 'admin', body: examples.providerVerify },
      { method: 'GET', path: '/:userId', summary: 'Get a provider public profile', auth: 'public' },
    ],
  },
  {
    tag: 'Reviews',
    description: 'Provider reviews, editing, reporting and moderation.',
    base: '/api/reviews',
    endpoints: [
      { method: 'GET', path: '/provider/:providerId', summary: 'List published reviews for a provider', auth: 'public' },
      { method: 'GET', path: '/mine', summary: 'List my submitted reviews', auth: 'user' },
      { method: 'POST', path: '/', summary: 'Create a review (verified booking required)', auth: 'user', body: examples.reviewCreate },
      { method: 'PATCH', path: '/:id', summary: 'Edit my review', auth: 'user', body: examples.reviewEdit },
      { method: 'POST', path: '/:id/report', summary: 'Report a review for moderation', auth: 'user', body: examples.reportReason },
      { method: 'PATCH', path: '/:id/moderate', summary: 'Moderate a reported review (admin)', auth: 'admin', body: examples.reviewModerate },
    ],
  },
  {
    tag: 'Favourites',
    description: 'Saved/favourite providers.',
    base: '/api/favourites',
    endpoints: [
      { method: 'GET', path: '/', summary: 'List my favourite providers', auth: 'user' },
      { method: 'POST', path: '/:providerId', summary: 'Add a provider to favourites', auth: 'user' },
      { method: 'DELETE', path: '/:providerId', summary: 'Remove a provider from favourites', auth: 'user' },
    ],
  },
  {
    tag: 'Availability',
    description: 'Provider working hours and bookable slots.',
    base: '/api/availability',
    endpoints: [
      { method: 'GET', path: '/me', summary: 'Get my availability settings', auth: 'user' },
      { method: 'PUT', path: '/', summary: 'Upsert my availability settings', auth: 'provider', body: examples.availabilityUpsert },
      {
        method: 'GET', path: '/:providerId/slots', summary: 'Get bookable slots for a date', auth: 'public',
        query: [{ name: 'date', example: '2026-07-05', description: 'ISO date (YYYY-MM-DD).' }],
      },
      { method: 'GET', path: '/:providerId', summary: 'Get a provider availability', auth: 'public' },
    ],
  },
  {
    tag: 'Notifications',
    description: 'In-app notifications, device tokens and preferences.',
    base: '/api/notifications',
    endpoints: [
      { method: 'GET', path: '/', summary: 'List my notifications', auth: 'user', query: [{ name: 'unreadOnly', example: 'true', description: 'Only unread.' }, { name: 'limit', example: '50' }] },
      { method: 'GET', path: '/unread-count', summary: 'Count my unread notifications', auth: 'user' },
      { method: 'PATCH', path: '/read-all', summary: 'Mark all my notifications read', auth: 'user' },
      { method: 'GET', path: '/devices', summary: 'List my registered push devices', auth: 'user' },
      { method: 'POST', path: '/devices', summary: 'Register a push device token', auth: 'user', body: examples.device },
      { method: 'DELETE', path: '/devices/:token', summary: 'Unregister a push device token', auth: 'user' },
      { method: 'GET', path: '/preferences', summary: 'Get my notification preferences', auth: 'user' },
      { method: 'PUT', path: '/preferences', summary: 'Update my notification preferences', auth: 'user', body: examples.preferences },
      { method: 'PATCH', path: '/:id/read', summary: 'Mark one notification read', auth: 'user' },
    ],
  },
  {
    tag: 'Geo',
    description: 'Geocoding, distance and directions (Botswana sandbox unless a Maps key is set).',
    base: '/api/geo',
    endpoints: [
      { method: 'GET', path: '/search', summary: 'Search places by text', auth: 'user', query: [{ name: 'q', example: 'Gaborone', required: true }] },
      { method: 'GET', path: '/reverse', summary: 'Reverse geocode a coordinate', auth: 'user', query: [{ name: 'lat', example: '-24.6282', required: true }, { name: 'lng', example: '25.9231', required: true }] },
      { method: 'GET', path: '/distance', summary: 'Estimate travel distance between two points', auth: 'user', query: [{ name: 'fromLat', example: '-24.6282', required: true }, { name: 'fromLng', example: '25.9231', required: true }, { name: 'toLat', example: '-24.65', required: true }, { name: 'toLng', example: '25.91', required: true }] },
      { method: 'GET', path: '/directions', summary: 'Get directions between two points', auth: 'user', query: [{ name: 'fromLat', example: '-24.6282', required: true }, { name: 'fromLng', example: '25.9231', required: true }, { name: 'toLat', example: '-24.65', required: true }, { name: 'toLng', example: '25.91', required: true }] },
      { method: 'POST', path: '/geocode', summary: 'Geocode an address', auth: 'user', body: examples.geocode },
    ],
  },
  {
    tag: 'Saved Addresses',
    description: 'Customer saved addresses.',
    base: '/api/addresses',
    endpoints: [
      { method: 'GET', path: '/', summary: 'List my saved addresses', auth: 'user' },
      { method: 'POST', path: '/', summary: 'Create a saved address', auth: 'user', body: examples.address },
      { method: 'PUT', path: '/:id', summary: 'Update a saved address', auth: 'user', body: examples.address },
      { method: 'DELETE', path: '/:id', summary: 'Delete a saved address', auth: 'user' },
    ],
  },
  {
    tag: 'Uploads',
    description: 'Secure image uploads (multipart/form-data, field "image").',
    base: '/api/uploads',
    endpoints: [
      {
        method: 'POST', path: '/:kind', summary: 'Upload an image', auth: 'user',
        note: 'kind ∈ customer_photo | provider_photo | business_logo | portfolio | certificate | job_photo | review_photo | message_image',
        form: [{ name: 'image', type: 'file', description: 'The image file to upload.' }],
      },
    ],
  },
  {
    tag: 'Messages',
    description: 'Booking-scoped real-time chat (also over Socket.IO).',
    base: '/api/messages',
    endpoints: [
      { method: 'GET', path: '/conversations', summary: 'List my conversations', auth: 'user' },
      { method: 'GET', path: '/:bookingReference', summary: 'Get message history for a booking', auth: 'user' },
      { method: 'POST', path: '/:bookingReference', summary: 'Send a message', auth: 'user', body: examples.messageSend },
      { method: 'POST', path: '/:bookingReference/read', summary: 'Mark the conversation read', auth: 'user' },
      { method: 'POST', path: '/:bookingReference/react', summary: 'React to a message', auth: 'user', body: examples.messageReact },
      { method: 'POST', path: '/:bookingReference/report', summary: 'Report a conversation', auth: 'user', body: examples.reportReason },
    ],
  },
  {
    tag: 'Blocks',
    description: 'Block / unblock other users.',
    base: '/api/blocks',
    endpoints: [
      { method: 'GET', path: '/', summary: 'List users I have blocked', auth: 'user' },
      { method: 'POST', path: '/:userId', summary: 'Block a user', auth: 'user' },
      { method: 'DELETE', path: '/:userId', summary: 'Unblock a user', auth: 'user' },
    ],
  },
  {
    tag: 'Analytics',
    description: 'Provider, customer and admin analytics + exports.',
    base: '/api/analytics',
    endpoints: [
      { method: 'GET', path: '/provider', summary: 'Provider analytics dashboard', auth: 'provider' },
      { method: 'GET', path: '/customer', summary: 'Customer analytics dashboard', auth: 'user' },
      { method: 'GET', path: '/admin', summary: 'Admin analytics dashboard', auth: 'admin' },
      {
        method: 'GET', path: '/export', summary: 'Export a report (CSV or JSON)', auth: 'user',
        query: [
          { name: 'report', example: 'bookings', description: 'Report name to export.' },
          { name: 'format', example: 'csv', description: 'csv (default) or json.' },
        ],
      },
    ],
  },
  {
    tag: 'Bookings',
    description: 'Create and manage bookings; initiate payment for a booking.',
    base: '/api/bookings',
    endpoints: [
      { method: 'POST', path: '/', summary: 'Create a booking', auth: 'user', body: examples.bookingCreate },
      { method: 'GET', path: '/', summary: 'List my bookings', auth: 'user', query: [{ name: 'limit', example: '20' }] },
      { method: 'GET', path: '/:reference', summary: 'Get a booking', auth: 'user' },
      { method: 'PATCH', path: '/:reference/status', summary: 'Update booking status', auth: 'user', body: examples.bookingStatus },
      { method: 'POST', path: '/:reference/pay', summary: 'Initiate payment for a booking', auth: 'user', body: examples.bookingPay },
      { method: 'GET', path: '/:reference/payment', summary: 'Get a booking payment status', auth: 'user' },
    ],
  },
  {
    tag: 'Payments',
    description: 'Payment creation, lookup, cancellation and gateway webhooks. ' +
      'These routes are unauthenticated by design (the gateway calls the webhook; ' +
      'the app initiates payments via the Bookings endpoints).',
    base: '/api/payments',
    endpoints: [
      { method: 'GET', path: '/methods', summary: 'List supported payment methods', auth: 'public' },
      { method: 'GET', path: '/', summary: 'List payments', auth: 'public', query: [{ name: 'status', example: 'succeeded' }, { name: 'method', example: 'orange_money' }] },
      { method: 'POST', path: '/', summary: 'Create a payment', auth: 'public', body: examples.paymentCreate },
      { method: 'GET', path: '/:reference', summary: 'Get a payment by reference', auth: 'public' },
      { method: 'POST', path: '/:reference/cancel', summary: 'Cancel a pending payment', auth: 'public', body: examples.paymentCancel },
      {
        method: 'POST', path: '/webhook/:method', summary: 'Gateway webhook (Orange Money / MyZaka / card / bank)', auth: 'public',
        note: 'Signature is read from x-signature / x-orange-signature / x-myzaka-signature headers. ' +
          'method ∈ orange_money | myzaka | card | bank_transfer.',
        body: examples.paymentWebhook,
        headers: [{ name: 'x-signature', example: 'sha256-hmac-of-raw-body', description: 'Gateway HMAC signature.' }],
      },
    ],
  },
  {
    tag: 'Admin',
    description: 'Administrative dashboard, moderation, payments and audit. Requires an admin token.',
    base: '/api/admin',
    endpoints: [
      { method: 'GET', path: '/dashboard', summary: 'Admin dashboard summary', auth: 'admin' },
      { method: 'GET', path: '/users', summary: 'Search users', auth: 'admin', query: [{ name: 'q', example: 'kagiso' }, { name: 'role', example: 'provider' }] },
      { method: 'PATCH', path: '/providers/:userId/verify', summary: 'Verify / unverify a provider', auth: 'admin', body: examples.providerVerify },
      { method: 'PATCH', path: '/users/:userId/suspend', summary: 'Suspend / unsuspend a user', auth: 'admin', body: examples.suspend },
      { method: 'GET', path: '/bookings', summary: 'List bookings', auth: 'admin', query: [{ name: 'status', example: 'pending' }] },
      { method: 'POST', path: '/bookings/:reference/cancel', summary: 'Cancel a booking (admin)', auth: 'admin', body: examples.adminCancel },
      { method: 'POST', path: '/payments/:reference/refund', summary: 'Record a refund', auth: 'admin', body: examples.adminRefund },
      { method: 'GET', path: '/payments', summary: 'List payments', auth: 'admin', query: [{ name: 'status', example: 'succeeded' }] },
      { method: 'POST', path: '/broadcast', summary: 'Broadcast a notification', auth: 'admin', body: examples.broadcast },
      { method: 'GET', path: '/reviews', summary: 'List reviews (moderation queue)', auth: 'admin', query: [{ name: 'status', example: 'reported' }] },
      { method: 'GET', path: '/audit-logs', summary: 'List audit-log entries', auth: 'admin', query: [{ name: 'action', example: 'login' }, { name: 'actorId', example: 'cust-123' }] },
    ],
  },
  {
    tag: 'Operational',
    description: 'Health, readiness and metrics (no /api prefix).',
    base: '',
    endpoints: [
      { method: 'GET', path: '/health', summary: 'Liveness (service name)', auth: 'public' },
      { method: 'GET', path: '/health/live', summary: 'Liveness probe', auth: 'public' },
      { method: 'GET', path: '/health/ready', summary: 'Readiness probe (DB + cache + driver)', auth: 'public' },
      { method: 'GET', path: '/metrics', summary: 'In-process metrics (JSON)', auth: 'public' },
      { method: 'GET', path: '/metrics/prometheus', summary: 'Prometheus exposition metrics', auth: 'public' },
    ],
  },
];

module.exports = { info, groups, examples };
