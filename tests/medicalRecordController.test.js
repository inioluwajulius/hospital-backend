jest.mock('../models/MedicalRecord');
jest.mock('../models/Patient');

const MedicalRecord = require('../models/MedicalRecord');
const Patient = require('../models/Patient');
const {
    createMedicalRecord,
    getPatientRecords
} = require('../controllers/medicalRecordController');

const HOSPITAL_ID = '64b000000000000000000001';
const PATIENT_ID = '507f1f77bcf86cd799439011';
const DOCTOR_ID = '507f1f77bcf86cd799439012';

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

// Patient.findOne(...).select(...) resolving to the given value
const mockPatientLookup = (value) => {
    Patient.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) });
};

// Model.find/findById(...).populate(...).populate(...) resolving/rejecting
const mockPopulateChain = (result, { reject = false } = {}) => {
    const secondPopulate = reject ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
    const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
    return jest.fn().mockReturnValue({ populate: firstPopulate });
};

describe('medicalRecordController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('createMedicalRecord saves whitelisted fields, forces the doctor and hospital, and returns the populated record', async () => {
        const req = {
            user: { userId: DOCTOR_ID, role: 'doctor' },
            tenantFilter: { hospitalId: HOSPITAL_ID },
            body: {
                patientId: PATIENT_ID,
                diagnosis: 'Flu',
                doctorId: 'someone-else',
                hospitalId: 'other-hospital',
            }
        };
        const res = createMockResponse();
        mockPatientLookup({ _id: PATIENT_ID });

        const savedRecord = { _id: 'record-1', save: jest.fn().mockResolvedValue() };
        MedicalRecord.mockImplementation(() => savedRecord);

        const populatedRecord = { _id: 'record-1', diagnosis: 'Flu' };
        MedicalRecord.findById = mockPopulateChain(populatedRecord);

        await createMedicalRecord(req, res);

        expect(Patient.findOne).toHaveBeenCalledWith({ _id: PATIENT_ID, hospitalId: HOSPITAL_ID });
        expect(MedicalRecord).toHaveBeenCalledWith({
            patientId: PATIENT_ID,
            diagnosis: 'Flu',
            hospitalId: HOSPITAL_ID,
            doctorId: DOCTOR_ID,
        });
        expect(savedRecord.save).toHaveBeenCalledTimes(1);
        expect(MedicalRecord.findById).toHaveBeenCalledWith('record-1');
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ success: true, data: populatedRecord });
    });

    it('createMedicalRecord requires a patientId', async () => {
        const req = { user: { userId: DOCTOR_ID, role: 'doctor' }, tenantFilter: { hospitalId: HOSPITAL_ID }, body: { diagnosis: 'Flu' } };
        const res = createMockResponse();

        await createMedicalRecord(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(MedicalRecord).not.toHaveBeenCalled();
    });

    it('createMedicalRecord rejects a patient from another hospital', async () => {
        const req = { user: { userId: DOCTOR_ID, role: 'doctor' }, tenantFilter: { hospitalId: HOSPITAL_ID }, body: { patientId: PATIENT_ID } };
        const res = createMockResponse();
        mockPatientLookup(null);

        await createMedicalRecord(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Patient not found in this hospital' });
        expect(MedicalRecord).not.toHaveBeenCalled();
    });

    it('createMedicalRecord returns 500 on save error', async () => {
        const req = { user: { userId: DOCTOR_ID, role: 'doctor' }, tenantFilter: { hospitalId: HOSPITAL_ID }, body: { patientId: PATIENT_ID } };
        const res = createMockResponse();
        mockPatientLookup({ _id: PATIENT_ID });

        MedicalRecord.mockImplementation(() => ({
            save: jest.fn().mockRejectedValue(new Error('save failed'))
        }));

        await createMedicalRecord(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'save failed' });
    });

    it('getPatientRecords returns records scoped to the hospital', async () => {
        const req = { params: { patientId: PATIENT_ID }, tenantFilter: { hospitalId: HOSPITAL_ID } };
        const res = createMockResponse();

        const records = [{ _id: 'record-1' }, { _id: 'record-2' }];
        MedicalRecord.find = mockPopulateChain(records);

        await getPatientRecords(req, res);

        expect(MedicalRecord.find).toHaveBeenCalledWith({ patientId: PATIENT_ID, hospitalId: HOSPITAL_ID });
        expect(res.json).toHaveBeenCalledWith({ success: true, data: records });
    });

    it('getPatientRecords returns 500 when query fails', async () => {
        const req = { params: { patientId: PATIENT_ID }, tenantFilter: { hospitalId: HOSPITAL_ID } };
        const res = createMockResponse();

        MedicalRecord.find = mockPopulateChain(new Error('query failed'), { reject: true });

        await getPatientRecords(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'query failed' });
    });
});
