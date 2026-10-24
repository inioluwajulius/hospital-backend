const crypto = require('crypto');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const { loadConsultation, consultationRoom } = require('./consultationAccess');

/**
 * Ringing for telemedicine calls (native WebRTC; the media itself is set up in the
 * consultation room with 'consult:signal').
 *
 * A call rings the other participant's personal room (their user id), so the incoming-call
 * popup shows on whatever page they have open, on every tab and device they are signed in on.
 * The server decides who is called from the appointment; the client never names the recipient.
 *
 *   caller            server                         callee
 *   call:ring  ---->  checks access, busy, online --> call:incoming (popup + ringtone)
 *              <----  call:accepted  <-------------  call:accept   (then joins the room, sends 'ready')
 *              <----  call:closed {reason}  ------>  (declined | missed | cancelled | ended | busy | unavailable)
 *
 * Calls are kept in memory: this assumes one server process (as on Render). Several
 * instances would need a shared store such as Redis.
 */

const RING_MS = 45000;
const ACCEPT_GRACE_MS = 60000; // answered: time allowed for the callee to open the room and connect
const CALLER_RECONNECT_MS = 10000; // caller's connection dropped while ringing

const calls = new Map(); // callId -> call

const removeCall = (callId) => {
    const call = calls.get(callId);
    if (call) {
        clearTimeout(call.timer);
        calls.delete(callId);
    }
    return call;
};

const callsFor = (userId) => [...calls.values()].filter((c) => c.callerId === userId || c.calleeId === userId);

const incomingPayload = (call) => ({
    callId: call.callId,
    appointmentId: call.appointmentId,
    mode: call.mode,
    caller: call.caller,
    expiresAt: call.ringingSince + RING_MS,
});

const callLabel = (call) => `${call.mode === 'video' ? 'video' : 'voice'} call from ${call.caller.role === 'doctor' ? `Dr. ${String(call.caller.name).replace(/^Dr\.?\s*/i, '')}` : call.caller.name}`;

const register = (io) => {
    const socketsOf = (userId) => io.in(String(userId)).fetchSockets();

    // Answered calls count as live while both people are in the consultation room
    const isLive = async (call) => {
        if (call.state === 'ringing' || Date.now() - call.acceptedAt < ACCEPT_GRACE_MS) return true;
        const inRoom = new Set((await io.in(consultationRoom(call.appointmentId)).fetchSockets()).map((s) => s.data.userId));
        return inRoom.has(call.callerId) && inRoom.has(call.calleeId);
    };
    const pruneEnded = async () => {
        for (const call of [...calls.values()]) {
            if (!(await isLive(call))) removeCall(call.callId);
        }
    };

    const close = (call, reason) => {
        if (!removeCall(call.callId)) return;
        const event = { callId: call.callId, appointmentId: call.appointmentId, reason };
        io.to(call.callerId).to(call.calleeId).emit('call:closed', event);
    };

    // Saved so the person sees it in their notifications later (no medical details)
    const notifyMissed = async (call) => {
        try {
            const notif = await Notification.create({
                recipient: call.calleeId, hospitalId: call.hospitalId, type: 'APPOINTMENT',
                message: `Missed ${callLabel(call)}`, link: `/consultation/${call.appointmentId}`,
            });
            io.to(call.calleeId).emit('new_notification', notif);
        } catch (err) {
            console.error('Missed call notification error:', err.message);
        }
    };

    const recipientOf = async ({ appointment, participant }) => {
        if (participant === 'patient') return String(appointment.doctorId);
        const patient = await Patient.findById(appointment.patientId).select('userId');
        return patient?.userId ? String(patient.userId) : null;
    };

    return (socket, consultUser) => {
        const me = String(socket.user.userId);
        socket.data.userId = me;

        // Calls still ringing for this user (page refreshed, or the phone's connection dropped)
        callsFor(me).filter((c) => c.calleeId === me && c.state === 'ringing')
            .forEach((c) => socket.emit('call:incoming', incomingPayload(c)));

        socket.on('call:ring', async ({ appointmentId, mode } = {}, ack = () => {}) => {
            try {
                const access = await loadConsultation(consultUser(), appointmentId);
                if (!access) return ack({ ok: false, reason: 'not-found' });
                if (access.appointment.status !== 'in-progress') return ack({ ok: false, reason: 'not-started' });
                const calleeId = await recipientOf(access);
                if (!calleeId) return ack({ ok: false, reason: 'offline' });

                await pruneEnded();
                const id = String(access.appointment._id);
                if ([...calls.values()].some((c) => c.appointmentId === id)) return ack({ ok: false, reason: 'in-progress' });
                if (callsFor(calleeId).length) return ack({ ok: false, reason: 'busy' });

                const caller = await User.findById(me).select('name');
                const call = {
                    callId: crypto.randomUUID(),
                    appointmentId: id,
                    hospitalId: access.appointment.hospitalId,
                    callerId: me,
                    calleeId,
                    mode: mode === 'video' ? 'video' : 'audio',
                    caller: { name: caller?.name || 'Unknown', role: access.participant },
                    state: 'ringing',
                    ringingSince: Date.now(),
                };

                if (!(await socketsOf(calleeId)).length) {
                    await notifyMissed(call);
                    return ack({ ok: false, reason: 'offline' });
                }
                calls.set(call.callId, call);
                call.timer = setTimeout(() => {
                    if (calls.get(call.callId)?.state !== 'ringing') return;
                    close(call, 'missed');
                    notifyMissed(call);
                }, RING_MS);
                io.to(calleeId).emit('call:incoming', incomingPayload(call));
                ack({ ok: true, callId: call.callId });
            } catch (err) {
                console.error('call:ring error:', err.message);
                ack({ ok: false, reason: 'error' });
            }
        });

        // Only the person being called can answer or decline
        socket.on('call:accept', ({ callId } = {}, ack = () => {}) => {
            const call = calls.get(String(callId));
            if (!call || call.calleeId !== me || call.state !== 'ringing') return ack({ ok: false });
            clearTimeout(call.timer);
            call.state = 'accepted';
            call.acceptedAt = Date.now();
            // The caller starts connecting; the callee's other tabs stop ringing
            io.to(call.callerId).to(call.calleeId).emit('call:accepted', { callId: call.callId });
            ack({ ok: true, appointmentId: call.appointmentId, mode: call.mode });
        });

        socket.on('call:decline', ({ callId, reason } = {}) => {
            const call = calls.get(String(callId));
            if (!call || call.calleeId !== me) return;
            close(call, reason === 'busy' ? 'busy' : reason === 'media' ? 'unavailable' : 'declined');
        });

        socket.on('call:end', ({ callId } = {}) => {
            const call = calls.get(String(callId));
            if (!call || (call.callerId !== me && call.calleeId !== me)) return;
            close(call, call.state === 'ringing' && call.callerId === me ? 'cancelled' : 'ended');
        });

        socket.on('disconnect', () => {
            // Stop ringing the other person if the caller is gone for good
            setTimeout(async () => {
                if ((await socketsOf(me)).length) return;
                callsFor(me).filter((c) => c.callerId === me && c.state === 'ringing').forEach((c) => close(c, 'cancelled'));
            }, CALLER_RECONNECT_MS);
        });
    };
};

/** A hangup or decline relayed in the consultation room ends that appointment's call */
const endCallsFor = (appointmentId) => {
    [...calls.values()].filter((c) => c.appointmentId === String(appointmentId) && c.state === 'accepted').forEach((c) => removeCall(c.callId));
};

module.exports = { register, endCallsFor, RING_MS };
