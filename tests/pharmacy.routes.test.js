jest.mock('../models/Drug');

const jwt = require('jsonwebtoken');
const request = require('supertest');
const Drug = require('../models/Drug');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { app } = require('../server');

function makeToken(role, userId = '507f1f77bcf86cd799439011') {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET);
}

describe('Pharmacy routes auth and role checks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('requires auth for pharmacy drugs list endpoint', async () => {
        const response = await request(app).get('/api/pharmacy/drugs');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token missing' });
    });

    it('blocks patient role from adding drug', async () => {
        const token = makeToken('patient');

        const response = await request(app)
            .post('/api/pharmacy/drugs')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Paracetamol', price: 50, stock: 10 });

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('blocks nurse role from updating stock', async () => {
        const token = makeToken('nurse');

        const response = await request(app)
            .patch('/api/pharmacy/drugs/507f1f77bcf86cd799439011/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ stock: 20 });

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('blocks doctor role from deleting drug', async () => {
        const token = makeToken('doctor');

        const response = await request(app)
            .delete('/api/pharmacy/drugs/507f1f77bcf86cd799439011')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });

    it('rejects invalid JWT token for pharmacy endpoint', async () => {
        const response = await request(app)
            .post('/api/pharmacy/dispense')
            .set('Authorization', 'Bearer invalid.token.value')
            .send({});

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Not authorized, token invalid' });
    });

    it('returns 400 when admin tries deleting drug with stock > 0', async () => {
        const token = makeToken('admin');
        Drug.findById = jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439011',
            isActive: true,
            stock: 4
        });

        const response = await request(app)
            .delete('/api/pharmacy/drugs/507f1f77bcf86cd799439011')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual({ message: 'Cannot delete drug with stock greater than zero' });
    });
});
