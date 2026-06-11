const request = require('supertest');
const { app } = require('../server');

describe('API smoke checks', () => {
    it('returns 404 JSON for unknown route', async () => {
        const response = await request(app).get('/api/does-not-exist');

        expect(response.statusCode).toBe(404);
        expect(response.body).toEqual({ error: 'Endpoint not found' });
    });

    it('requires auth for patients list endpoint', async () => {
        const response = await request(app).get('/api/patients');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token missing' });
    }, 20000);

    it('requires auth for medical records endpoint', async () => {
        const response = await request(app).get('/api/medical-records/patient/507f1f77bcf86cd799439011');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token missing' });
    });

    it('requires auth for audit logs endpoint', async () => {
        const response = await request(app).get('/api/audit-logs');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token missing' });
    });
});
