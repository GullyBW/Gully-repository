'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, auth } = require('./helpers');

const app = createApp();

// A real 1x1 PNG so optional image processing (sharp) can decode it.
const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('Secure image uploads', () => {
  let user;
  beforeEach(async () => {
    user = await registerUser(app, 'provider', 'up@example.com');
  });

  it('accepts an image upload and returns a public URL', async () => {
    const res = await request(app)
      .post('/api/uploads/provider_photo')
      .set(auth(user.token))
      .attach('image', pngBuffer, { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toContain('/uploads/provider_photo/');
    expect(res.body.data.thumbnailUrl).toBeDefined();
  });

  it('rejects a non-image file', async () => {
    const res = await request(app)
      .post('/api/uploads/provider_photo')
      .set(auth(user.token))
      .attach('image', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown upload kind', async () => {
    const res = await request(app)
      .post('/api/uploads/not_a_kind')
      .set(auth(user.token))
      .attach('image', pngBuffer, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/uploads/provider_photo')
      .attach('image', pngBuffer, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});
