jest.mock('../models/Drug');
jest.mock('../models/Dispense');
jest.mock('../models/Patient');
jest.mock('../models/Prescription');

const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');
const Patient = require('../models/Patient');
const Prescription = require('../models/Prescription');
const {
    addDrug,
    getAllDrugs,
    updateStock,
    deleteDrug,
    dispenseDrug
} = require('../controllers/pharmacyController');

const HOSPITAL_ID = '64b000000000000000000001';
const DRUG_ID = '507f1f77bcf86cd799439011';
const PATIENT_ID = '507f1f77bcf86cd799439012';
const PRESCRIPTION_ID = '507f1f77bcf86cd799439013';

const tenant = { tenantFilter: { hospitalId: HOSPITAL_ID } };
const pharmacist = { user: { userId: '507f1f77bcf86cd799439014', role: 'pharmacist' } };

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

// Model.findOne(...).select(...) resolving to value
const selectResolving = (value) => jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) });

describe('pharmacyController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Patient.findOne = selectResolving({ _id: PATIENT_ID });
        Prescription.findOne = selectResolving({ _id: PRESCRIPTION_ID, status: 'pending' });
        Prescription.updateOne = jest.fn().mockResolvedValue({});
    });

    it('addDrug creates the drug in the caller\'s hospital', async () => {
        const body = { name: 'Paracetamol', category: 'Analgesic', manufacturer: 'Acme Pharma', price: 120, stock: 50, expiryDate: '2027-12-31' };
        const res = createMockResponse();
        const savedDrug = { _id: 'drug-1', save: jest.fn().mockResolvedValue() };
        Drug.mockImplementation(() => savedDrug);

        await addDrug({ ...tenant, body: { ...body, hospitalId: 'other-hospital' } }, res);

        expect(Drug).toHaveBeenCalledWith({ ...body, hospitalId: HOSPITAL_ID });
        expect(savedDrug.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ message: 'Drug added successfully', drug: savedDrug });
    });

    it('getAllDrugs returns active drugs for the hospital', async () => {
        const res = createMockResponse();
        const drugs = [{ _id: 'drug-1' }];
        Drug.find = jest.fn().mockResolvedValue(drugs);

        await getAllDrugs({ ...tenant, query: {} }, res);

        expect(Drug.find).toHaveBeenCalledWith({ hospitalId: HOSPITAL_ID, isActive: true });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(drugs);
    });

    it('getAllDrugs includes inactive drugs when includeInactive=true', async () => {
        const res = createMockResponse();
        Drug.find = jest.fn().mockResolvedValue([]);

        await getAllDrugs({ ...tenant, query: { includeInactive: 'true' } }, res);

        expect(Drug.find).toHaveBeenCalledWith({ hospitalId: HOSPITAL_ID });
    });

    it('updateStock updates an active drug in the hospital', async () => {
        const res = createMockResponse();
        const updatedDrug = { _id: DRUG_ID, stock: 99, isActive: true };
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue(updatedDrug);

        await updateStock({ ...tenant, params: { drugId: DRUG_ID }, body: { stock: 99 } }, res);

        expect(Drug.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: DRUG_ID, isActive: true, hospitalId: HOSPITAL_ID },
            { stock: 99 },
            { new: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'Stock updated successfully', drug: updatedDrug });
    });

    it('updateStock rejects negative or non-numeric stock', async () => {
        for (const stock of [-1, 'abc', 2.5]) {
            const res = createMockResponse();
            Drug.findOneAndUpdate = jest.fn();
            await updateStock({ ...tenant, params: { drugId: DRUG_ID }, body: { stock } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(Drug.findOneAndUpdate).not.toHaveBeenCalled();
        }
    });

    it('deleteDrug rejects deleting when stock is greater than zero', async () => {
        const res = createMockResponse();
        Drug.findOne = jest.fn().mockResolvedValue({ _id: DRUG_ID, isActive: true, stock: 5 });

        await deleteDrug({ ...tenant, params: { drugId: DRUG_ID } }, res);

        expect(Drug.findOne).toHaveBeenCalledWith({ _id: DRUG_ID, hospitalId: HOSPITAL_ID });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Cannot delete drug with stock greater than zero' });
    });

    it('deleteDrug soft-deletes an active drug with zero stock', async () => {
        const res = createMockResponse();
        const drug = { _id: DRUG_ID, isActive: true, stock: 0, save: jest.fn().mockResolvedValue() };
        Drug.findOne = jest.fn().mockResolvedValue(drug);

        await deleteDrug({ ...tenant, params: { drugId: DRUG_ID } }, res);

        expect(drug.isActive).toBe(false);
        expect(drug.deletedAt).toBeInstanceOf(Date);
        expect(drug.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'Drug deleted successfully' });
    });

    it('deleteDrug returns 404 for a drug in another hospital', async () => {
        const res = createMockResponse();
        Drug.findOne = jest.fn().mockResolvedValue(null);

        await deleteDrug({ ...tenant, params: { drugId: DRUG_ID } }, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('dispenseDrug atomically decrements stock, records the dispense and marks the prescription dispensed', async () => {
        const req = {
            ...tenant,
            ...pharmacist,
            body: { patientId: PATIENT_ID, prescriptionId: PRESCRIPTION_ID, drugId: DRUG_ID, quantity: 2, pharmacistId: 'ignored-body-value' }
        };
        const res = createMockResponse();
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: DRUG_ID, stock: 8 });
        const newDispense = { _id: 'dispense-1', save: jest.fn().mockResolvedValue() };
        Dispense.mockImplementation(() => newDispense);

        await dispenseDrug(req, res);

        expect(Patient.findOne).toHaveBeenCalledWith({ _id: PATIENT_ID, hospitalId: HOSPITAL_ID });
        expect(Drug.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: DRUG_ID, isActive: true, stock: { $gte: 2 }, hospitalId: HOSPITAL_ID },
            { $inc: { stock: -2 } },
            { new: true }
        );
        // Pharmacist comes from the token, not the request body
        expect(Dispense).toHaveBeenCalledWith({
            patientId: PATIENT_ID,
            prescriptionId: PRESCRIPTION_ID,
            drugId: DRUG_ID,
            quantity: 2,
            pharmacistId: pharmacist.user.userId,
            hospitalId: HOSPITAL_ID
        });
        expect(newDispense.save).toHaveBeenCalledTimes(1);
        expect(Prescription.updateOne).toHaveBeenCalledWith({ _id: PRESCRIPTION_ID, hospitalId: HOSPITAL_ID }, { status: 'dispensed' });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ message: 'Drug dispensed successfully', dispense: newDispense });
    });

    it('dispenseDrug rejects when stock is insufficient', async () => {
        const res = createMockResponse();
        Drug.findOneAndUpdate = jest.fn().mockResolvedValue(null);
        Drug.findOne = selectResolving({ _id: DRUG_ID });

        await dispenseDrug({ ...tenant, ...pharmacist, body: { patientId: PATIENT_ID, drugId: DRUG_ID, quantity: 20 } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient stock' });
    });

    it('dispenseDrug rejects non-positive or fractional quantities', async () => {
        for (const quantity of [0, -5, 1.5, 'abc']) {
            const res = createMockResponse();
            Drug.findOneAndUpdate = jest.fn();

            await dispenseDrug({ ...tenant, ...pharmacist, body: { patientId: PATIENT_ID, drugId: DRUG_ID, quantity } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(Drug.findOneAndUpdate).not.toHaveBeenCalled();
        }
    });

    it('dispenseDrug rejects a patient from another hospital', async () => {
        const res = createMockResponse();
        Patient.findOne = selectResolving(null);
        Drug.findOneAndUpdate = jest.fn();

        await dispenseDrug({ ...tenant, ...pharmacist, body: { patientId: PATIENT_ID, drugId: DRUG_ID, quantity: 1 } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(Drug.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('dispenseDrug refuses an already-dispensed prescription', async () => {
        const res = createMockResponse();
        Prescription.findOne = selectResolving({ _id: PRESCRIPTION_ID, status: 'dispensed' });
        Drug.findOneAndUpdate = jest.fn();

        await dispenseDrug({ ...tenant, ...pharmacist, body: { patientId: PATIENT_ID, prescriptionId: PRESCRIPTION_ID, drugId: DRUG_ID, quantity: 1 } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Prescription has already been dispensed' });
        expect(Drug.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
