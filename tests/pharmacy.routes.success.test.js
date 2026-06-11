jest.mock('../models/Drug');
jest.mock('../models/Dispense');

const jwt = require('jsonwebtoken');
const request = require('supertest');

const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { app } = require('../server');

function makeToken(role, userId = '507f1f77bcf86cd799439011') {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET);
}

describe('Pharmacy routes success paths', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('allows admin to add a drug', async () => {
        const token = makeToken('admin');

        const savedDrug = { _id: 'drug-1', save: jest.fn().mockResolvedValue() };
        Drug.mockImplementation(() => savedDrug);

        const response = await request(app)
            .post('/api/pharmacy/drugs')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Amoxicillin',
                category: 'Antibiotic',
                manufacturer: 'Acme',
                price: 200,
                stock: 30
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe('Drug added successfully');
        expect(savedDrug.save).toHaveBeenCalledTimes(1);
    });

    it('allows authenticated user to list active drugs', async () => {
        const token = makeToken('patient');
        Drug.find = jest.fn().mockResolvedValue([{ _id: 'drug-1', isActive: true }]);

        const response = await request(app)
            .get('/api/pharmacy/drugs')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual([{ _id: 'drug-1', isActive: true }]);
        expect(Drug.find).toHaveBeenCalledWith({ isActive: true });
    });

    it('allows pharmacist to update stock', async () => {
        const token = makeToken('pharmacist');
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439011',
            stock: 75,
            isActive: true
        });

        const response = await request(app)
            .patch('/api/pharmacy/drugs/507f1f77bcf86cd799439011/stock')
            .set('Authorization', `Bearer ${token}`)
            .send({ stock: 75 });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe('Stock updated successfully');
    });

    it('allows admin to soft-delete drug with zero stock', async () => {
        const token = makeToken('admin');
        const drug = {
            _id: '507f1f77bcf86cd799439011',
            isActive: true,
            stock: 0,
            save: jest.fn().mockResolvedValue()
        };
        Drug.findById = jest.fn().mockResolvedValue(drug);

        const response = await request(app)
            .delete('/api/pharmacy/drugs/507f1f77bcf86cd799439011')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({ message: 'Drug deleted successfully' });
        expect(drug.isActive).toBe(false);
        expect(drug.deletedAt).toBeTruthy();
        expect(drug.save).toHaveBeenCalledTimes(1);
    });

    it('allows pharmacist to dispense a drug', async () => {
        const token = makeToken('pharmacist');
        const drug = {
            _id: '507f1f77bcf86cd799439011',
            isActive: true,
            stock: 10,
            save: jest.fn().mockResolvedValue()
        };
        Drug.findById = jest.fn().mockResolvedValue(drug);

        const dispenseRecord = { _id: 'dispense-1', save: jest.fn().mockResolvedValue() };
        Dispense.mockImplementation(() => dispenseRecord);

        const response = await request(app)
            .post('/api/pharmacy/dispense')
            .set('Authorization', `Bearer ${token}`)
            .send({
                patientId: '507f1f77bcf86cd799439012',
                prescriptionId: '507f1f77bcf86cd799439013',
                drugId: '507f1f77bcf86cd799439011',
                quantity: 2,
                pharmacistId: '507f1f77bcf86cd799439014'
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe('Drug dispensed successfully');
        expect(drug.stock).toBe(8);
        expect(drug.save).toHaveBeenCalledTimes(1);
        expect(dispenseRecord.save).toHaveBeenCalledTimes(1);
    });
});
