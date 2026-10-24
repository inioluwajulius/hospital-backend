// utils/staffApplications.js: hospital-scoped doctor/nurse approvals
jest.mock('../models/User');
jest.mock('../models/Hospital');
jest.mock('../models/Notification');
jest.mock('../utils/email', () => jest.fn().mockResolvedValue({ sent: true }));
jest.mock('../utils/audit', () => ({ recordAudit: jest.fn().mockResolvedValue() }));
jest.mock('../socket', () => ({ getIO: () => null }));

const mongoose = require('mongoose');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Notification = require('../models/Notification');
const sendEmail = require('../utils/email');
const { recordAudit } = require('../utils/audit');
const { listApplications, decideApplication } = require('../utils/staffApplications');

const HOSPITAL_A = '64b0000000000000000000a1';
const DOCTOR = '64b0000000000000000000d1';
const ADMIN = { userId: '64b0000000000000000000f1', role: 'hospital_admin' };

// Chainable query mock resolving to `value`
const chain = (value) => {
    const q = { select: jest.fn(() => q), populate: jest.fn(() => q), sort: jest.fn(() => q), limit: jest.fn(() => q) };
    q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
    return q;
};
const doctorDoc = (overrides = {}) => ({
    _id: DOCTOR, name: 'Dr. Ada', email: 'ada@example.com', role: 'doctor', status: 'active', hospitalId: HOSPITAL_A,
    populate: jest.fn().mockResolvedValue(), ...overrides,
});

describe('staff applications', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Hospital.findById = jest.fn(() => chain({ name: 'Alpha General' }));
        Notification.create = jest.fn().mockResolvedValue({});
    });

    it('lists only pending, self-registered doctors and nurses of the given hospital', async () => {
        User.find = jest.fn(() => chain([]));
        await listApplications(HOSPITAL_A, { search: 'ada' });
        const query = User.find.mock.calls[0][0];
        expect(String(query.hospitalId)).toBe(HOSPITAL_A);
        expect(query.status).toBe('pending');
        expect(query.role).toEqual({ $in: ['doctor', 'nurse'] });
        expect(query.invitedBy).toBeNull();
        expect(query.$or).toHaveLength(4);
    });

    it('lists every hospital (but never hospital-less accounts) for the super admin', async () => {
        User.find = jest.fn(() => chain([]));
        await listApplications(null);
        expect(User.find.mock.calls[0][0].hospitalId).toEqual({ $ne: null });
    });

    it('approves atomically: only a still-pending application in this hospital changes', async () => {
        User.findOneAndUpdate = jest.fn(() => chain(doctorDoc()));
        const result = await decideApplication(HOSPITAL_A, DOCTOR, 'approve', ADMIN);

        const [filter, update] = User.findOneAndUpdate.mock.calls[0];
        expect(filter).toMatchObject({ _id: DOCTOR, status: 'pending', invitedBy: null });
        expect(String(filter.hospitalId)).toBe(HOSPITAL_A);
        expect(update.$set).toMatchObject({ status: 'active', approvedBy: ADMIN.userId });
        expect(update.$set.approvedAt).toBeInstanceOf(Date);
        expect(result.status).toBe('active');
        expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com', subject: expect.stringMatching(/approved/) }));
        expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ recipient: DOCTOR }));
        expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ hospitalId: HOSPITAL_A, action: 'Approved doctor application' }));
    });

    it('records the rejection reason', async () => {
        User.findOneAndUpdate = jest.fn(() => chain(doctorDoc({ status: 'rejected', rejectionReason: 'License could not be verified' })));
        await decideApplication(HOSPITAL_A, DOCTOR, 'reject', ADMIN, { reason: '  License could not be verified ' });
        const update = User.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set).toMatchObject({ status: 'rejected', rejectedBy: ADMIN.userId, rejectionReason: 'License could not be verified' });
    });

    it('refuses a second decision on the same application (409)', async () => {
        User.findOneAndUpdate = jest.fn(() => chain(null));
        User.findOne = jest.fn(() => chain({ status: 'active' }));
        await expect(decideApplication(HOSPITAL_A, DOCTOR, 'reject', ADMIN)).rejects.toMatchObject({ status: 409, message: 'This application has already been approved.' });
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('cannot reach another hospital\'s applicant (404)', async () => {
        User.findOneAndUpdate = jest.fn(() => chain(null));
        User.findOne = jest.fn(() => chain(null));
        await expect(decideApplication(HOSPITAL_A, DOCTOR, 'approve', ADMIN)).rejects.toMatchObject({ status: 404 });
    });

    it('does not let anyone decide on their own application', async () => {
        User.findOneAndUpdate = jest.fn();
        await expect(decideApplication(HOSPITAL_A, DOCTOR, 'approve', { userId: DOCTOR })).rejects.toMatchObject({ status: 403 });
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects malformed ids without querying', async () => {
        User.findOneAndUpdate = jest.fn();
        await expect(decideApplication(HOSPITAL_A, 'not-an-id', 'approve', ADMIN)).rejects.toMatchObject({ status: 404 });
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mongoose.isValidObjectId(DOCTOR)).toBe(true);
    });
});
