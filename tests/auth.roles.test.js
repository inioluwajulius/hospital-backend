const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { app } = require('../server');

function makeToken(role, userId = '507f1f77bcf86cd799439011') {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET);
}

describe('Authenticated role checks', () => {
    it('blocks patient role from medical records read endpoint', async () => {
        const token = makeToken('patient');

        const response = await request(app)
            .get('/api/medical-records/patient/507f1f77bcf86cd799439011')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('blocks nurse role from prescription create endpoint', async () => {
        const token = makeToken('nurse');

        const response = await request(app)
            .post('/api/prescriptions')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('blocks doctor role from lab tests admin endpoint', async () => {
        const token = makeToken('doctor');

        const response = await request(app)
            .get('/api/lab/tests')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('rejects invalid JWT token', async () => {
        const response = await request(app)
            .get('/api/patients')
            .set('Authorization', 'Bearer invalid.token.value');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token invalid' });
    }, 20000);
});