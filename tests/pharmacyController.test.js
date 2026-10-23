jest.mock('../models/Drug');
jest.mock('../models/Dispense');

const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');

const {
    addDrug,
    getAllDrugs,
    updateStock,
    deleteDrug,
    dispenseDrug
} = require('../controllers/pharmacyController');

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('pharmacyController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('addDrug creates and returns drug', async () => {
        const req = {
            body: {
                name: 'Paracetamol',
                category: 'Analgesic',
                manufacturer: 'Acme Pharma',
                price: 120,
                stock: 50,
                expiryDate: '2027-12-31'
            }
        };
        const res = createMockResponse();

        const savedDrug = { _id: 'drug-1', save: jest.fn().mockResolvedValue() };
        Drug.mockImplementation(() => savedDrug);

        await addDrug(req, res);

        expect(Drug).toHaveBeenCalledWith(req.body);
        expect(savedDrug.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Drug added successfully',
            drug: savedDrug
        });
    });

    it('getAllDrugs returns only active drugs by default', async () => {
        const req = { query: {} };
        const res = createMockResponse();

        const drugs = [{ _id: 'drug-1', isActive: true }];
        Drug.find = jest.fn().mockResolvedValue(drugs);

        await getAllDrugs(req, res);

        expect(Drug.find).toHaveBeenCalledWith({ isActive: true });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(drugs);
    });

    it('getAllDrugs includes inactive drugs when includeInactive=true', async () => {
        const req = { query: { includeInactive: 'true' } };
        const res = createMockResponse();

        const drugs = [{ _id: 'drug-1', isActive: true }, { _id: 'drug-2', isActive: false }];
        Drug.find = jest.fn().mockResolvedValue(drugs);

        await getAllDrugs(req, res);

        expect(Drug.find).toHaveBeenCalledWith();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(drugs);
    });

    it('updateStock updates stock for active drug', async () => {
        const req = {
            params: { drugId: '507f1f77bcf86cd799439011' },
            body: { stock: 99 }
        };
        const res = createMockResponse();

        const updatedDrug = { _id: req.params.drugId, stock: 99, isActive: true };
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue(updatedDrug);

        await updateStock(req, res);

        expect(Drug.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: req.params.drugId, isActive: true },
            { stock: 99 },
            { new: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Stock updated successfully',
            drug: updatedDrug
        });
    });

    it('deleteDrug rejects deleting when stock is greater than zero', async () => {
        const req = { params: { drugId: '507f1f77bcf86cd799439011' } };
        const res = createMockResponse();

        Drug.findById = jest.fn().mockResolvedValue({ _id: req.params.drugId, isActive: true, stock: 5 });

        await deleteDrug(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Cannot delete drug with stock greater than zero' });
    });

    it('deleteDrug soft-deletes active drug with zero stock', async () => {
        const req = { params: { drugId: '507f1f77bcf86cd799439011' } };
        const res = createMockResponse();

        const drug = {
            _id: req.params.drugId,
            isActive: true,
            stock: 0,
            save: jest.fn().mockResolvedValue()
        };
        Drug.findById = jest.fn().mockResolvedValue(drug);

        await deleteDrug(req, res);

        expect(drug.isActive).toBe(false);
        expect(drug.deletedAt).toBeInstanceOf(Date);
        expect(drug.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'Drug deleted successfully' });
    });

    it('dispenseDrug atomically decrements stock and creates dispense record', async () => {
        const req = {
            user: { userId: '507f1f77bcf86cd799439014', role: 'pharmacist' },
            body: {
                patientId: '507f1f77bcf86cd799439012',
                prescriptionId: '507f1f77bcf86cd799439013',
                drugId: '507f1f77bcf86cd799439011',
                quantity: 2,
                pharmacistId: 'ignored-body-value'
            }
        };
        const res = createMockResponse();

        Drug.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: req.body.drugId, stock: 8 });

        const newDispense = { _id: 'dispense-1', save: jest.fn().mockResolvedValue() };
        Dispense.mockImplementation(() => newDispense);

        await dispenseDrug(req, res);

        // Stock check and decrement happen in a single conditional update
        expect(Drug.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: req.body.drugId, isActive: true, stock: { $gte: 2 } },
            { $inc: { stock: -2 } },
            { new: true }
        );
        // Pharmacist comes from the token, not the request body
        expect(Dispense).toHaveBeenCalledWith({
            patientId: req.body.patientId,
            prescriptionId: req.body.prescriptionId,
            drugId: req.body.drugId,
            quantity: 2,
            pharmacistId: req.user.userId
        });
        expect(newDispense.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Drug dispensed successfully',
            dispense: newDispense
        });
    });

    it('dispenseDrug rejects when stock is insufficient', async () => {
        const req = {
            user: { userId: 'pharm-1', role: 'pharmacist' },
            body: {
                drugId: '507f1f77bcf86cd799439011',
                quantity: 20
            }
        };
        const res = createMockResponse();

        // Conditional update matches nothing, but the drug exists
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue(null);
        Drug.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: req.body.drugId }) });

        await dispenseDrug(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient stock' });
    });

    it('dispenseDrug rejects non-positive or fractional quantities', async () => {
        for (const quantity of [0, -5, 1.5, 'abc']) {
            const res = createMockResponse();
            Drug.findOneAndUpdate = jest.fn();

            await dispenseDrug({ user: { userId: 'pharm-1' }, body: { drugId: 'drug-1', quantity } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(Drug.findOneAndUpdate).not.toHaveBeenCalled();
        }
    });
});
