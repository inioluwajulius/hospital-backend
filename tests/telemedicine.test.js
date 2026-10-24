jest.mock('../models/Appointment');
jest.mock('../models/User');
jest.mock('../models/Patient');

process.env.CLINIC_TIMEZONE = 'Africa/Lagos';

const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Patient = require('../models/Patient');
const { checkSlot, clinicTime, describeAvailability } = require('../utils/scheduling');
const { loadConsultation } = require('../utils/consultationAccess');

const DOCTOR = '64b0000000000000000000d1';
const HOSPITAL = '64b0000000000000000000a1';
const APPT = '64b0000000000000000000e1';
const select = (value) => ({ select: jest.fn().mockResolvedValue(value) });

describe('scheduling rules', () => {
    beforeEach(() => jest.clearAllMocks());

    it('converts times to clinic local time (Lagos = UTC+1)', () => {
        // Monday 26 Oct 2026, 08:30 UTC
        expect(clinicTime(new Date('2026-10-26T08:30:00Z'))).toEqual({ day: 1, time: '09:30' });
    });

    it('describes availability for messages', () => {
        expect(describeAvailability([{ day: 1, start: '09:00', end: '17:00' }])).toBe('Monday 09:00-17:00');
    });

    it('accepts a free slot inside the doctor\'s hours', async () => {
        User.findById = jest.fn().mockReturnValue(select({ name: 'Ada', availability: [{ day: 1, start: '09:00', end: '17:00' }] }));
        Appointment.findOne = jest.fn().mockReturnValue(select(null));
        await expect(checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T09:00:00Z' })).resolves.toBeNull(); // 10:00 Lagos
    });

    it('rejects a time outside the doctor\'s hours', async () => {
        User.findById = jest.fn().mockReturnValue(select({ name: 'Dr. Ada', availability: [{ day: 1, start: '09:00', end: '17:00' }] }));
        const error = await checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T17:30:00Z' }); // 18:30 Lagos
        expect(error).toMatch(/Dr\. Ada is not available/);
        expect(error).toMatch(/Monday 09:00-17:00/);
    });

    it('lets urgent appointments bypass availability but not double-booking', async () => {
        User.findById = jest.fn().mockReturnValue(select({ name: 'Ada', availability: [{ day: 1, start: '09:00', end: '17:00' }] }));
        Appointment.findOne = jest.fn().mockReturnValue(select(null));
        await expect(checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T20:00:00Z', isUrgent: true })).resolves.toBeNull();

        Appointment.findOne = jest.fn().mockReturnValue(select({ _id: 'other' }));
        await expect(checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T20:00:00Z', isUrgent: true })).resolves.toMatch(/already booked/);
    });

    it('checks for clashes within 30 minutes among active appointments only, excluding the one being moved', async () => {
        User.findById = jest.fn().mockReturnValue(select({ name: 'Ada', availability: [] }));
        Appointment.findOne = jest.fn().mockReturnValue(select(null));
        await checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T10:00:00Z', excludeAppointmentId: APPT });

        const filter = Appointment.findOne.mock.calls[0][0];
        expect(filter.status).toEqual({ $in: ['scheduled', 'in-progress'] });
        expect(filter._id).toEqual({ $ne: APPT });
        expect(filter.appointmentDate.$lt - filter.appointmentDate.$gt).toBe(60 * 60 * 1000);
    });

    it('rejects invalid dates and unknown doctors', async () => {
        await expect(checkSlot({ doctorId: DOCTOR, appointmentDate: 'not-a-date' })).resolves.toMatch(/valid date/);
        User.findById = jest.fn().mockReturnValue(select(null));
        await expect(checkSlot({ doctorId: DOCTOR, appointmentDate: '2026-10-26T10:00:00Z' })).resolves.toBe('Doctor not found');
    });
});

describe('consultation access', () => {
    const appointment = { _id: APPT, doctorId: DOCTOR, patientId: 'pat-1', hospitalId: HOSPITAL };

    beforeEach(() => {
        jest.clearAllMocks();
        Appointment.findOne = jest.fn().mockResolvedValue(appointment);
    });

    it('only loads telemedicine appointments', async () => {
        await loadConsultation({ userId: DOCTOR, role: 'doctor', hospitalId: HOSPITAL }, APPT);
        expect(Appointment.findOne).toHaveBeenCalledWith({ _id: APPT, mode: 'telemedicine' });
    });

    it('admits the assigned doctor', async () => {
        await expect(loadConsultation({ userId: DOCTOR, role: 'doctor', hospitalId: HOSPITAL }, APPT)).resolves.toEqual({ appointment, participant: 'doctor' });
    });

    it('refuses another doctor', async () => {
        await expect(loadConsultation({ userId: '64b0000000000000000000d2', role: 'doctor', hospitalId: HOSPITAL }, APPT)).resolves.toBeNull();
    });

    it('admits the appointment\'s own patient only', async () => {
        Patient.findOne = jest.fn().mockReturnValue(select({ _id: 'pat-1' }));
        await expect(loadConsultation({ userId: 'user-p', role: 'patient', hospitalId: HOSPITAL }, APPT)).resolves.toEqual({ appointment, participant: 'patient' });
        expect(Patient.findOne).toHaveBeenCalledWith({ _id: 'pat-1', userId: 'user-p' });

        Patient.findOne = jest.fn().mockReturnValue(select(null));
        await expect(loadConsultation({ userId: 'user-x', role: 'patient', hospitalId: HOSPITAL }, APPT)).resolves.toBeNull();
    });

    it('refuses users from another hospital and other roles', async () => {
        await expect(loadConsultation({ userId: DOCTOR, role: 'doctor', hospitalId: '64b0000000000000000000a2' }, APPT)).resolves.toBeNull();
        await expect(loadConsultation({ userId: 'n1', role: 'nurse', hospitalId: HOSPITAL }, APPT)).resolves.toBeNull();
    });

    it('rejects malformed ids without querying', async () => {
        Appointment.findOne = jest.fn();
        await expect(loadConsultation({ userId: DOCTOR, role: 'doctor' }, 'not-an-id')).resolves.toBeNull();
        expect(Appointment.findOne).not.toHaveBeenCalled();
    });
});
