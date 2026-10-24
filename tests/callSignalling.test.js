// utils/callSignalling.js: who a call rings, who may answer it, busy/offline/missed handling
jest.mock('../utils/consultationAccess', () => ({
    loadConsultation: jest.fn(),
    consultationRoom: (id) => `consult_${id}`,
}));
jest.mock('../models/User');
jest.mock('../models/Patient');
jest.mock('../models/Notification');

const { loadConsultation } = require('../utils/consultationAccess');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const { register, RING_MS } = require('../utils/callSignalling');

const DOCTOR = 'doctor-user', PATIENT = 'patient-user', STRANGER = 'stranger-user';
const select = (value) => ({ select: jest.fn().mockResolvedValue(value) });

// Minimal stand-ins for the Socket.IO server and sockets
const makeIo = (online) => {
    const emitted = [];
    const io = {
        emitted,
        in: (room) => ({ fetchSockets: async () => (online.has(room) ? [{ data: { userId: room } }] : []) }),
        to(room) {
            const rooms = [room];
            const chain = { to: (r) => { rooms.push(r); return chain; }, emit: (event, data) => emitted.push({ rooms, event, data }) };
            return chain;
        },
    };
    return io;
};
const makeSocket = (userId, role) => {
    const handlers = {};
    return {
        user: { userId, role }, data: {}, sent: [],
        on: (event, fn) => { handlers[event] = fn; },
        emit(event, data) { this.sent.push({ event, data }); },
        call: (event, payload) => new Promise((resolve) => {
            // Resolves with the ack, or once the handler finishes for events without one
            Promise.resolve(handlers[event](payload, resolve)).then(() => resolve());
        }),
    };
};

let appointmentCounter = 0;
const setup = ({ online = [DOCTOR, PATIENT] } = {}) => {
    const appointmentId = `appt-${++appointmentCounter}`;
    const appointment = { _id: appointmentId, status: 'in-progress', doctorId: DOCTOR, patientId: 'patient-record', hospitalId: 'h1' };
    loadConsultation.mockImplementation(async (user) => {
        if (user.userId === DOCTOR) return { appointment, participant: 'doctor' };
        if (user.userId === PATIENT) return { appointment, participant: 'patient' };
        return null;
    });
    const io = makeIo(new Set(online));
    const connect = register(io);
    const join = (userId, role) => {
        const socket = makeSocket(userId, role);
        connect(socket, () => ({ userId, role }));
        return socket;
    };
    return { io, join, appointmentId, appointment };
};

describe('call ringing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        User.findById = jest.fn().mockReturnValue(select({ name: 'Ada Obi' }));
        Patient.findById = jest.fn().mockReturnValue(select({ userId: PATIENT }));
        Notification.create = jest.fn().mockResolvedValue({ _id: 'n1' });
    });

    it('rings the other participant (derived from the appointment) with name, role and type only', async () => {
        const { io, join, appointmentId } = setup();
        const doctor = join(DOCTOR, 'doctor');
        const ack = await doctor.call('call:ring', { appointmentId, mode: 'video', calleeId: STRANGER });
        expect(ack.ok).toBe(true);
        const ring = io.emitted.find((e) => e.event === 'call:incoming');
        expect(ring.rooms).toEqual([PATIENT]); // a client-supplied calleeId is ignored
        expect(ring.data).toEqual(expect.objectContaining({ callId: ack.callId, appointmentId, mode: 'video', caller: { name: 'Ada Obi', role: 'doctor' } }));
        expect(JSON.stringify(ring.data)).not.toMatch(/reason|diagnosis/);
        await doctor.call('call:end', { callId: ack.callId });
    });

    it('refuses calls from people who are not participants', async () => {
        const { join, appointmentId } = setup();
        const stranger = join(STRANGER, 'patient');
        expect(await stranger.call('call:ring', { appointmentId, mode: 'audio' })).toEqual({ ok: false, reason: 'not-found' });
    });

    it('only the person called can answer or decline', async () => {
        const { io, join, appointmentId } = setup();
        const doctor = join(DOCTOR, 'doctor');
        const patient = join(PATIENT, 'patient');
        const stranger = join(STRANGER, 'patient');
        const { callId } = await doctor.call('call:ring', { appointmentId, mode: 'audio' });

        expect(await stranger.call('call:accept', { callId })).toEqual({ ok: false });
        await stranger.call('call:decline', { callId });
        await stranger.call('call:end', { callId });
        expect(io.emitted.some((e) => e.event === 'call:closed')).toBe(false);

        expect(await patient.call('call:accept', { callId })).toEqual({ ok: true, appointmentId, mode: 'audio' });
        expect(io.emitted.find((e) => e.event === 'call:accepted').rooms).toEqual([DOCTOR, PATIENT]);
        expect(await patient.call('call:accept', { callId })).toEqual({ ok: false }); // answered once only
        await patient.call('call:end', { callId });
    });

    it('declining tells both sides', async () => {
        const { io, join, appointmentId } = setup();
        const doctor = join(DOCTOR, 'doctor');
        const patient = join(PATIENT, 'patient');
        const { callId } = await doctor.call('call:ring', { appointmentId, mode: 'audio' });
        await patient.call('call:decline', { callId });
        expect(io.emitted.find((e) => e.event === 'call:closed')).toEqual({ rooms: [DOCTOR, PATIENT], event: 'call:closed', data: { callId, appointmentId, reason: 'declined' } });
    });

    it('caller hanging up while it rings cancels it', async () => {
        const { io, join, appointmentId } = setup();
        const doctor = join(DOCTOR, 'doctor');
        const { callId } = await doctor.call('call:ring', { appointmentId, mode: 'audio' });
        await doctor.call('call:end', { callId });
        expect(io.emitted.find((e) => e.event === 'call:closed').data.reason).toBe('cancelled');
    });

    it('reports an offline recipient at once and leaves them a missed-call notification', async () => {
        const { join, appointmentId } = setup({ online: [DOCTOR] });
        const doctor = join(DOCTOR, 'doctor');
        expect(await doctor.call('call:ring', { appointmentId, mode: 'video' })).toEqual({ ok: false, reason: 'offline' });
        expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ recipient: PATIENT, message: 'Missed video call from Dr. Ada Obi' }));
    });

    it('a second call to someone already ringing or in a call gets "busy"; one call per appointment', async () => {
        const first = setup();
        const doctor = first.join(DOCTOR, 'doctor');
        const { callId } = await doctor.call('call:ring', { appointmentId: first.appointmentId, mode: 'audio' });
        expect(await doctor.call('call:ring', { appointmentId: first.appointmentId, mode: 'audio' })).toEqual({ ok: false, reason: 'in-progress' });

        // Another doctor's appointment with the same patient
        const OTHER = 'other-doctor';
        const appointment2 = { _id: 'appt-other', status: 'in-progress', doctorId: OTHER, patientId: 'patient-record', hospitalId: 'h1' };
        loadConsultation.mockResolvedValueOnce({ appointment: appointment2, participant: 'doctor' });
        const other = first.join(OTHER, 'doctor');
        expect(await other.call('call:ring', { appointmentId: 'appt-other', mode: 'audio' })).toEqual({ ok: false, reason: 'busy' });
        await doctor.call('call:end', { callId });
    });

    it('stops ringing after the timeout and records a missed call', async () => {
        jest.useFakeTimers();
        try {
            const { io, join, appointmentId } = setup();
            const patient = join(PATIENT, 'patient');
            const { callId } = await patient.call('call:ring', { appointmentId, mode: 'audio' });
            jest.advanceTimersByTime(RING_MS + 10);
            expect(io.emitted.find((e) => e.event === 'call:closed').data).toEqual({ callId, appointmentId, reason: 'missed' });
            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ recipient: DOCTOR, message: 'Missed voice call from Ada Obi' }));
        } finally {
            jest.useRealTimers();
        }
    });

    it('re-sends a still-ringing call when the person reconnects or refreshes', async () => {
        const { join, appointmentId } = setup();
        const doctor = join(DOCTOR, 'doctor');
        const { callId } = await doctor.call('call:ring', { appointmentId, mode: 'video' });
        const reconnected = join(PATIENT, 'patient');
        expect(reconnected.sent).toEqual([{ event: 'call:incoming', data: expect.objectContaining({ callId }) }]);
        await doctor.call('call:end', { callId });
    });

    it('does not ring before the doctor has started the consultation', async () => {
        const { join, appointmentId, appointment } = setup();
        appointment.status = 'scheduled';
        expect(await join(PATIENT, 'patient').call('call:ring', { appointmentId, mode: 'audio' })).toEqual({ ok: false, reason: 'not-started' });
    });
});
