jest.mock('../models/User');
jest.mock('../models/Patient');
jest.mock('../models/Hospital');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Hospital = require('../models/Hospital');

const { login, register, PASSWORD_REQUIREMENTS_MESSAGE } = require('../controllers/authController');

function createMockResponse() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('authController privacy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Hospital.findOne = jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' });
    });

    it('returns a sanitized user payload on login', async () => {
        const req = {
            body: {
                email: 'patient@gmail.com',
                password: 'Strong#123'
            }
        };
        const res = createMockResponse();

        const existingUser = {
            _id: '507f1f77bcf86cd799439011',
            name: 'Patient One',
            email: 'patient@gmail.com',
            role: 'patient',
            password: 'hashed-password',
            patientCardNumber: 'PAT-123456'
        };

        const select = jest.fn().mockResolvedValue(existingUser);
        User.findOne = jest.fn().mockReturnValue({ select });
        bcrypt.compare.mockResolvedValue(true);
        jwt.sign.mockReturnValue('signed-token');

        await login(req, res);

        expect(User.findOne).toHaveBeenCalledWith({ email: req.body.email });
        expect(select).toHaveBeenCalledWith('+password');
        expect(bcrypt.compare).toHaveBeenCalledWith(req.body.password, existingUser.password);
        expect(res.json).toHaveBeenCalledWith({
            token: 'signed-token',
            user: {
                id: existingUser._id,
                name: existingUser.name,
                email: existingUser.email,
                role: existingUser.role
            }
        });
        expect(res.json.mock.calls[0][0].user.patientCardNumber).toBeUndefined();
        expect(res.json.mock.calls[0][0].user.password).toBeUndefined();
    });

    it('rejects weak passwords during registration', async () => {
        const req = {
            body: {
                name: 'Patient One',
                email: 'patient@gmail.com',
                password: 'weakpass',
                userType: 'patient'
            }
        };
        const res = createMockResponse();

        await register(req, res);

        expect(User.findOne).not.toHaveBeenCalled();
        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: PASSWORD_REQUIREMENTS_MESSAGE });
    });

    it('normalizes email before login lookup', async () => {
        const req = {
            body: {
                email: '  PATIENT@GMAIL.COM  ',
                password: 'Strong#123'
            }
        };
        const res = createMockResponse();

        const existingUser = {
            _id: '507f1f77bcf86cd799439011',
            name: 'Patient One',
            email: 'patient@gmail.com',
            role: 'patient',
            password: 'hashed-password'
        };

        const select = jest.fn().mockResolvedValue(existingUser);
        User.findOne = jest.fn().mockReturnValue({ select });
        bcrypt.compare.mockResolvedValue(true);
        jwt.sign.mockReturnValue('signed-token');

        await login(req, res);

        expect(User.findOne).toHaveBeenCalledWith({ email: 'patient@gmail.com' });
    });

    it('rejects login with missing password', async () => {
        const req = {
            body: {
                email: 'patient@gmail.com'
            }
        };
        const res = createMockResponse();

        await login(req, res);

        expect(User.findOne).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Email and password are required' });
    });

    it('rejects login with invalid email format', async () => {
        const req = {
            body: {
                email: 'invalid-email',
                password: 'Strong#123'
            }
        };
        const res = createMockResponse();

        await login(req, res);

        expect(User.findOne).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Invalid email format' });
    });

    it('successfully registers a new patient without card number', async () => {
        const req = {
            body: {
                name: 'Jane Doe',
                email: 'jane@gmail.com',
                password: 'SecurePass#123',
                userType: 'patient'
            }
        };
        const res = createMockResponse();

        User.findOne = jest.fn().mockResolvedValue(null); // No existing user
        const mockUserInstance = {
            _id: 'patient-123',
            save: jest.fn().mockResolvedValue(true)
        };
        User.mockImplementation(() => mockUserInstance);
        
        const mockPatientInstance = {
            save: jest.fn().mockResolvedValue(true)
        };
        Patient.mockImplementation(() => mockPatientInstance);
        
        bcrypt.hash = jest.fn().mockResolvedValue('hashed-password-123');

        await register(req, res);

        expect(User.findOne).toHaveBeenCalledWith({ email: 'jane@gmail.com' });
        expect(bcrypt.hash).toHaveBeenCalledWith('SecurePass#123', 10);
        expect(mockUserInstance.save).toHaveBeenCalled();
        expect(mockPatientInstance.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Registration successful! Your profile is pending admin verification. You will be notified once approved.',
            userId: 'patient-123',
            patientCardNumber: expect.any(String),
            status: 'pending'
        });
    });

    it('rejects registration if email already exists', async () => {
        const req = {
            body: {
                name: 'John Doe',
                email: 'existing@gmail.com',
                password: 'StrongPass#123',
                userType: 'patient'
            }
        };
        const res = createMockResponse();

        const existingUser = { _id: '123', email: 'existing@gmail.com' };
        User.findOne = jest.fn().mockResolvedValue(existingUser);

        await register(req, res);

        expect(User.findOne).toHaveBeenCalledWith({ email: 'existing@gmail.com' });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Email already exists' });
    });

    it('rejects registration with missing required fields', async () => {
        const req = {
            body: {
                name: '',
                email: 'test@gmail.com',
                password: 'StrongPass#123',
                userType: 'patient'
            }
        };
        const res = createMockResponse();

        await register(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Name, email, password, and user type are required'
        });
    });

    it('successfully registers a non-patient user (doctor)', async () => {
        const req = {
            body: {
                name: 'Dr. Smith',
                email: 'doctor@hospital.com',
                password: 'DoctorPass#123',
                userType: 'staff',
                role: 'DOCTOR'
            }
        };
        const res = createMockResponse();

        User.findOne = jest.fn().mockResolvedValue(null);
        const mockUserInstance = {
            _id: 'doctor-123',
            save: jest.fn().mockResolvedValue(true)
        };
        User.mockImplementation(() => mockUserInstance);
        bcrypt.hash = jest.fn().mockResolvedValue('hashed-password-456');

        await register(req, res);

        expect(User.findOne).toHaveBeenCalledWith({ email: 'doctor@hospital.com' });
        expect(bcrypt.hash).toHaveBeenCalledWith('DoctorPass#123', 10);
        expect(mockUserInstance.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ message: 'Staff registration successful', userId: 'doctor-123' });
    });

    it('allows doctor registration without years of experience', async () => {
        const req = {
            body: {
                name: 'Dr. Smith',
                email: 'doctor@hospital.com',
                password: 'DoctorPass#123',
                userType: 'staff',
                role: 'DOCTOR'
            }
        };
        const res = createMockResponse();

        User.findOne = jest.fn().mockResolvedValue(null);
        const mockUserInstance = {
            _id: 'doctor-456',
            save: jest.fn().mockResolvedValue(true)
        };
        User.mockImplementation(() => mockUserInstance);
        bcrypt.hash = jest.fn().mockResolvedValue('hashed-password-456');

        await register(req, res);

        expect(mockUserInstance.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ message: 'Staff registration successful', userId: 'doctor-456' });
    });
});