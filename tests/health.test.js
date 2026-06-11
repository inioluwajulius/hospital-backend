const request = require('supertest');
const { app } = require('../server');

describe('Health endpoint', () => {
    it('returns API running message', async () => {
        const response = await request(app).get('/');

        expect(response.statusCode).toBe(200);
        expect(response.text).toBe('Hospital API is running');
    });
});