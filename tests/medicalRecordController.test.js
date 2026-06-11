jest.mock('../models/MedicalRecord');

const MedicalRecord = require('../models/MedicalRecord');
const {
    createMedicalRecord,
    getPatientRecords
} = require('../controllers/medicalRecordController');

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('medicalRecordController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('createMedicalRecord creates and returns populated record', async () => {
        const req = {
            body: {
                patientId: '507f1f77bcf86cd799439011',
                doctorId: '507f1f77bcf86cd799439012',
                diagnosis: 'Flu'
            }
        };
        const res = createMockResponse();

        const savedRecord = { _id: 'record-1', save: jest.fn().mockResolvedValue() };
        MedicalRecord.mockImplementation(() => savedRecord);

        const populatedRecord = {
            _id: 'record-1',
            diagnosis: 'Flu',
            patientId: { _id: '507f1f77bcf86cd799439011' },
            doctorId: { _id: '507f1f77bcf86cd799439012' }
        };

        const secondPopulate = jest.fn().mockResolvedValue(populatedRecord);
        const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
        MedicalRecord.findById = jest.fn().mockReturnValue({ populate: firstPopulate });

        await createMedicalRecord(req, res);

        expect(MedicalRecord).toHaveBeenCalledWith(req.body);
        expect(savedRecord.save).toHaveBeenCalledTimes(1);
        expect(MedicalRecord.findById).toHaveBeenCalledWith('record-1');
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(populatedRecord);
    });

    it('createMedicalRecord returns 500 on save error', async () => {
        const req = { body: { diagnosis: 'Flu' } };
        const res = createMockResponse();

        MedicalRecord.mockImplementation(() => ({
            save: jest.fn().mockRejectedValue(new Error('save failed'))
        }));

        await createMedicalRecord(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: 'save failed' });
    });

    it('getPatientRecords returns populated records list', async () => {
        const req = { params: { patientId: '507f1f77bcf86cd799439011' } };
        const res = createMockResponse();

        const records = [{ _id: 'record-1' }, { _id: 'record-2' }];
        const secondPopulate = jest.fn().mockResolvedValue(records);
        const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
        MedicalRecord.find = jest.fn().mockReturnValue({ populate: firstPopulate });

        await getPatientRecords(req, res);

        expect(MedicalRecord.find).toHaveBeenCalledWith({ patientId: '507f1f77bcf86cd799439011' });
        expect(res.json).toHaveBeenCalledWith(records);
    });

    it('getPatientRecords returns 500 when query fails', async () => {
        const req = { params: { patientId: '507f1f77bcf86cd799439011' } };
        const res = createMockResponse();

        const secondPopulate = jest.fn().mockRejectedValue(new Error('query failed'));
        const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
        MedicalRecord.find = jest.fn().mockReturnValue({ populate: firstPopulate });

        await getPatientRecords(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: 'query failed' });
    });
});