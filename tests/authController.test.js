jest.mock('../models/User');
jest.mock('../models/Patient');
jest.mock('../models/Hospital');
jest.mock('../models/Notification');
jest.mock('../utils/email', () => jest.fn().mockResolvedValue());
jest.mock('../utils/otp', () => ({
    RESEND_COOLDOWN_SECONDS: 60,
    issueCode: jest.fn().mockResolvedValue({ issued: true, code: '123456', expiresInMinutes: 10 }),
}));
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Hospital = require('../models/Hospital');
const sendEmail = require('../utils/email');
const otp = require('../utils/otp');

const { login, register, forgotPassword, PASSWORD_REQUIREMENTS_MESSAGE } = require('../controllers/authController');

const HOSPITAL_ID = '64b000000000000000000001';

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

// User.find(query).populate(...).select('+password') -> users
const mockLoginLookup = (users) => {
    const select = jest.fn().mockResolvedValue(users);
    const populate = jest.fn().mockReturnValue({ select });
    User.find = jest.fn().mockReturnValue({ populate });
    return { select, populate };
};

// Hospital.findById(id).select('status') -> hospital
const mockHospital = (hospital = { _id: HOSPITAL_ID, status: 'active' }) => {
    Hospital.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(hospital) });
};

const mockNewUser = (id) => {
    const instance = { _id: id, email: 'x', save: jest.fn().mockResolvedValue(true) };
    User.mockImplementation((data) => Object.assign(instance, data, { _id: id }));
    return instance;
};

const activeUser = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    name: 'Patient One',
    email: 'patient@gmail.com',
    role: 'patient',
    status: 'active',
    password: 'hashed-password',
    patientCardNumber: 'PAT-123456',
    hospitalId: { _id: HOSPITAL_ID, name: 'General' },
    ...overrides,
});

describe('authController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockHospital();
        // No hospital admins to notify by default
        User.find = jest.fn().mockResolvedValue([]);
        jwt.sign.mockReturnValue('signed-token');
        bcrypt.hash.mockResolvedValue('hashed-password-123');
    });

    describe('login', () => {
        it('returns a sanitized user payload', async () => {
            const req = { body: { email: 'patient@gmail.com', password: 'Strong#123' } };
            const res = createMockResponse();
            const user = activeUser();
            const { select } = mockLoginLookup([user]);
            bcrypt.compare.mockResolvedValue(true);

            await login(req, res);

            expect(User.find).toHaveBeenCalledWith({ email: 'patient@gmail.com' });
            expect(select).toHaveBeenCalledWith('+password');
            expect(bcrypt.compare).toHaveBeenCalledWith('Strong#123', 'hashed-password');
            expect(res.json).toHaveBeenCalledWith({
                token: 'signed-token',
                user: { id: user._id, name: user.name, email: user.email, role: user.role }
            });
            const payload = res.json.mock.calls[0][0].user;
            expect(payload.patientCardNumber).toBeUndefined();
            expect(payload.password).toBeUndefined();
        });

        it('normalizes email before lookup', async () => {
            const req = { body: { email: '  PATIENT@Gmail.com ', password: 'Strong#123' } };
            const res = createMockResponse();
            mockLoginLookup([activeUser()]);
            bcrypt.compare.mockResolvedValue(true);

            await login(req, res);

            expect(User.find).toHaveBeenCalledWith({ email: 'patient@gmail.com' });
        });

        it('rejects missing password', async () => {
            const res = createMockResponse();
            mockLoginLookup([]);

            await login({ body: { email: 'patient@gmail.com' } }, res);

            expect(User.find).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Email and password are required' });
        });

        it('rejects invalid email format', async () => {
            const res = createMockResponse();
            mockLoginLookup([]);

            await login({ body: { email: 'not-an-email', password: 'Strong#123' } }, res);

            expect(User.find).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Invalid email format' });
        });

        it.each(['pending', 'rejected', 'suspended', 'inactive'])('blocks %s accounts and issues no token', async (status) => {
            const res = createMockResponse();
            mockLoginLookup([activeUser({ role: 'doctor', status })]);
            bcrypt.compare.mockResolvedValue(true);

            await login({ body: { email: 'patient@gmail.com', password: 'Strong#123' } }, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(jwt.sign).not.toHaveBeenCalled();
        });
    });

    describe('register', () => {
        const baseBody = { name: 'Jane Doe', email: 'jane@gmail.com', password: 'Strong#123', hospitalId: HOSPITAL_ID };

        it('rejects weak passwords', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn();

            await register({ body: { ...baseBody, password: 'weakpass', userType: 'patient' } }, res);

            expect(User.findOne).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        });

        it('rejects missing required fields', async () => {
            const res = createMockResponse();

            await register({ body: { email: 'jane@gmail.com' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Name, email, password, and user type are required' });
        });

        it('rejects an unknown or inactive hospital', async () => {
            const res = createMockResponse();
            mockHospital({ _id: HOSPITAL_ID, status: 'suspended' });

            await register({ body: { ...baseBody, userType: 'patient' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Invalid hospital' });
        });

        it('rejects a duplicate email in the same hospital', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockResolvedValue({ _id: 'existing' });

            await register({ body: { ...baseBody, userType: 'patient' } }, res);

            expect(User.findOne).toHaveBeenCalledWith({ email: 'jane@gmail.com', hospitalId: HOSPITAL_ID });
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Email already exists in this hospital' });
        });

        it('registers a new patient with a generated card number', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockResolvedValue(null);
            const user = mockNewUser('patient-123');
            const patient = { save: jest.fn().mockResolvedValue(true) };
            Patient.mockImplementation(() => patient);

            await register({ body: { ...baseBody, userType: 'patient', phone: '08031234567', age: 30, gender: 'female' } }, res);

            expect(user.save).toHaveBeenCalled();
            expect(user.role).toBe('patient');
            expect(patient.save).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(201);
            const body = res.json.mock.calls[0][0];
            expect(body.userId).toBe('patient-123');
            expect(body.patientCardNumber).toMatch(/^PAT-\d{6}$/);
        });

        it('registers a doctor as pending approval', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockResolvedValue(null);
            const user = mockNewUser('doctor-123');

            await register({ body: { ...baseBody, email: 'doc@clinic.ng', userType: 'staff', role: 'DOCTOR', specialization: 'Cardiology', licenseNumber: 'MD1', yearsOfExperience: '5' } }, res);

            expect(user.save).toHaveBeenCalled();
            expect(user.role).toBe('doctor');
            expect(user.status).toBe('pending');
            expect(user.yearsOfExperience).toBe(5);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json.mock.calls[0][0].userId).toBe('doctor-123');
        });

        it('allows doctor registration without years of experience', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockResolvedValue(null);
            const user = mockNewUser('doctor-456');

            await register({ body: { ...baseBody, userType: 'staff', role: 'DOCTOR' } }, res);

            expect(user.save).toHaveBeenCalled();
            expect(user.yearsOfExperience).toBeUndefined();
            expect(res.status).toHaveBeenCalledWith(201);
        });

        it.each(['ADMIN', 'STAFF', 'SUPER_ADMIN', 'HOSPITAL_ADMIN'])('refuses self-registration as %s', async (role) => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockResolvedValue(null);
            mockNewUser('x');

            await register({ body: { ...baseBody, userType: 'staff', role } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(User).not.toHaveBeenCalled();
        });

        describe('linking an existing patient record', () => {
            const linkBody = { ...baseBody, userType: 'patient', existingPatientId: '507f1f77bcf86cd799439099' };

            it('links when the phone matches and the record is unclaimed', async () => {
                const res = createMockResponse();
                User.findOne = jest.fn().mockResolvedValue(null);
                const existing = { _id: linkBody.existingPatientId, phone: '0803 123 4567', patientCardNumber: 'PAT-111111', save: jest.fn().mockResolvedValue(true) };
                Patient.findOne = jest.fn().mockResolvedValue(existing);
                mockNewUser('linked-user');

                await register({ body: { ...linkBody, phone: '08031234567' } }, res);

                expect(Patient.findOne).toHaveBeenCalledWith({ _id: linkBody.existingPatientId, hospitalId: HOSPITAL_ID });
                expect(existing.userId).toBe('linked-user');
                expect(existing.save).toHaveBeenCalled();
                expect(res.status).toHaveBeenCalledWith(201);
            });

            it('refuses when the phone does not match', async () => {
                const res = createMockResponse();
                User.findOne = jest.fn().mockResolvedValue(null);
                Patient.findOne = jest.fn().mockResolvedValue({ phone: '08031234567', save: jest.fn() });

                await register({ body: { ...linkBody, phone: '09000000000' } }, res);

                expect(res.status).toHaveBeenCalledWith(404);
                expect(User).not.toHaveBeenCalled();
            });

            it('refuses a record already linked to another account', async () => {
                const res = createMockResponse();
                User.findOne = jest.fn().mockResolvedValue(null);
                Patient.findOne = jest.fn().mockResolvedValue({ phone: '08031234567', userId: 'someone-else', save: jest.fn() });

                await register({ body: { ...linkBody, phone: '08031234567' } }, res);

                expect(res.status).toHaveBeenCalledWith(400);
                expect(User).not.toHaveBeenCalled();
            });
        });
    });

    describe('forgotPassword', () => {
        it('gives the same response whether or not the email exists', async () => {
            const missingRes = createMockResponse();
            User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
            await forgotPassword({ body: { email: 'nobody@gmail.com' } }, missingRes);

            const existingRes = createMockResponse();
            User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ name: 'Jane', email: 'jane@gmail.com' }) });
            await forgotPassword({ body: { email: 'jane@gmail.com' } }, existingRes);

            expect(missingRes.status).toHaveBeenCalledWith(200);
            expect(existingRes.status).toHaveBeenCalledWith(200);
            expect(missingRes.json.mock.calls[0][0]).toEqual(existingRes.json.mock.calls[0][0]);
            // Only the real account gets a code
            expect(otp.issueCode).toHaveBeenCalledTimes(1);
            expect(otp.issueCode).toHaveBeenCalledWith('jane@gmail.com', 'password_reset');
            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(sendEmail.mock.calls[0][0].message).toContain('123456');
        });

        it('still gives the generic response when email delivery fails', async () => {
            const res = createMockResponse();
            User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ name: 'Jane', email: 'jane@gmail.com' }) });
            sendEmail.mockRejectedValueOnce(new Error('Email delivery failed'));

            await forgotPassword({ body: { email: 'jane@gmail.com' } }, res);

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('rejects an invalid email address', async () => {
            const res = createMockResponse();
            await forgotPassword({ body: { email: 'not-an-email' } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });
});
