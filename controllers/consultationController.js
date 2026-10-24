const Appointment = require('../models/Appointment');
const ConsultationMessage = require('../models/ConsultationMessage');
const MedicalRecord = require('../models/MedicalRecord');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const { loadConsultation, consultationRoom } = require('../utils/consultationAccess');

/**
 * Telemedicine consultations: details, chat, start and completion.
 * Only the appointment's doctor and patient can access a consultation.
 */

const tokenUser = (req) => ({ userId: req.user.userId, role: req.user.role, hospitalId: req.user.hospitalId });

const notFound = (res) => res.status(404).json({ success: false, message: 'Consultation not found' });

const notify = async ({ recipient, hospitalId, message, link }) => {
    try {
        const notif = await Notification.create({ recipient, hospitalId, type: 'APPOINTMENT', message, link });
        socketService.getIO()?.to(String(recipient)).emit('new_notification', notif);
    } catch (err) {
        console.error('Consultation notification error:', err.message);
    }
};

const patientUserId = async (appointment) => {
    const patient = await Patient.findById(appointment.patientId).select('userId');
    return patient?.userId || null;
};

/** GET /consultations/:id  appointment, messages and (for the doctor) a patient summary */
exports.getConsultation = async (req, res) => {
    try {
        const access = await loadConsultation(tokenUser(req), req.params.id);
        if (!access) return notFound(res);

        const appointment = await Appointment.findById(access.appointment._id)
            .populate({ path: 'patientId', select: 'userId name patientCardNumber age gender bloodGroup allergies currentMedications', populate: { path: 'userId', select: 'name' } })
            .populate('doctorId', 'name specialization department');

        const messages = await ConsultationMessage.find({ appointmentId: appointment._id }).sort({ createdAt: 1 }).limit(500).lean();

        let history = [];
        if (access.participant === 'doctor') {
            history = await MedicalRecord.find({ patientId: appointment.patientId._id, hospitalId: appointment.hospitalId })
                .sort({ createdAt: -1 }).limit(5).select('diagnosis treatment symptoms notes createdAt').lean();
        }

        const patient = appointment.patientId || {};
        res.json({
            success: true,
            data: {
                participant: access.participant,
                appointment: {
                    _id: appointment._id,
                    appointmentDate: appointment.appointmentDate,
                    reason: appointment.reason,
                    status: appointment.status,
                    isUrgent: appointment.isUrgent,
                    startedAt: appointment.startedAt,
                    endedAt: appointment.endedAt,
                    doctor: appointment.doctorId ? { name: appointment.doctorId.name, specialization: appointment.doctorId.specialization } : null,
                    patient: {
                        name: patient.userId?.name || patient.name,
                        patientCardNumber: patient.patientCardNumber,
                        // Clinical details are only shared with the treating doctor
                        ...(access.participant === 'doctor' ? {
                            age: patient.age, gender: patient.gender, bloodGroup: patient.bloodGroup,
                            allergies: patient.allergies, currentMedications: patient.currentMedications,
                        } : {}),
                    },
                },
                messages,
                history,
            },
        });
    } catch (error) {
        console.error('Get consultation error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the consultation' });
    }
};

/** GET /consultations/:id/messages?after=<ISO date>  new messages (polling fallback) */
exports.getMessages = async (req, res) => {
    try {
        const access = await loadConsultation(tokenUser(req), req.params.id);
        if (!access) return notFound(res);
        const query = { appointmentId: access.appointment._id };
        const after = new Date(req.query.after);
        if (typeof req.query.after === 'string' && !Number.isNaN(after.getTime())) query.createdAt = { $gt: after };
        const messages = await ConsultationMessage.find(query).sort({ createdAt: 1 }).limit(200).lean();
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Get messages error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load messages' });
    }
};

/** POST /consultations/:id/messages  { text, clientId } */
exports.postMessage = async (req, res) => {
    try {
        const access = await loadConsultation(tokenUser(req), req.params.id);
        if (!access) return notFound(res);
        if (['cancelled', 'completed'].includes(access.appointment.status)) {
            return res.status(400).json({ success: false, message: 'This consultation has ended' });
        }

        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        if (text.length > 2000) return res.status(400).json({ success: false, message: 'Message is too long (2000 characters max)' });
        const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 64) : undefined;

        let message;
        try {
            message = await ConsultationMessage.create({
                appointmentId: access.appointment._id,
                hospitalId: access.appointment.hospitalId,
                senderId: req.user.userId,
                senderRole: access.participant,
                text,
                clientId,
            });
        } catch (err) {
            // Same clientId already stored: the client is retrying after a dropped connection
            if (err.code === 11000 && clientId) {
                message = await ConsultationMessage.findOne({ appointmentId: access.appointment._id, clientId });
                return res.status(200).json({ success: true, data: message });
            }
            throw err;
        }

        socketService.getIO()?.to(consultationRoom(access.appointment._id)).emit('consult:message', message);
        res.status(201).json({ success: true, data: message });
    } catch (error) {
        console.error('Post message error:', error.message);
        res.status(500).json({ success: false, message: 'Could not send the message' });
    }
};

/** POST /consultations/:id/start  doctor opens the session; patient is notified */
exports.startConsultation = async (req, res) => {
    try {
        const access = await loadConsultation(tokenUser(req), req.params.id);
        if (!access) return notFound(res);
        if (access.participant !== 'doctor') return res.status(403).json({ success: false, message: 'Only the doctor can start the consultation' });

        const appointment = await Appointment.findOneAndUpdate(
            { _id: access.appointment._id, status: { $in: ['scheduled', 'in-progress'] } },
            { $set: { status: 'in-progress' }, $min: { startedAt: new Date() } },
            { new: true }
        );
        if (!appointment) return res.status(400).json({ success: false, message: 'This consultation can no longer be started' });

        const recipient = await patientUserId(appointment);
        if (recipient) {
            await notify({ recipient, hospitalId: appointment.hospitalId, message: 'Your doctor has started your video consultation. Join now.', link: `/consultation/${appointment._id}` });
        }
        socketService.getIO()?.to(consultationRoom(appointment._id)).emit('consult:status', { status: appointment.status });
        res.json({ success: true, data: { status: appointment.status, startedAt: appointment.startedAt } });
    } catch (error) {
        console.error('Start consultation error:', error.message);
        res.status(500).json({ success: false, message: 'Could not start the consultation' });
    }
};

/** POST /consultations/:id/complete  { diagnosis, notes, treatment } doctor closes and records notes */
exports.completeConsultation = async (req, res) => {
    try {
        const access = await loadConsultation(tokenUser(req), req.params.id);
        if (!access) return notFound(res);
        if (access.participant !== 'doctor') return res.status(403).json({ success: false, message: 'Only the doctor can complete the consultation' });

        const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, 5000) : '');
        const diagnosis = clean(req.body?.diagnosis);
        const notes = clean(req.body?.notes);
        const treatment = clean(req.body?.treatment);
        if (!diagnosis && !notes) {
            return res.status(400).json({ success: false, message: 'Add a diagnosis or consultation notes before completing' });
        }

        // Atomic status change so the consultation can only be completed once
        const appointment = await Appointment.findOneAndUpdate(
            { _id: access.appointment._id, status: { $in: ['scheduled', 'in-progress'] } },
            { $set: { status: 'completed', endedAt: new Date() }, $min: { startedAt: new Date() } },
            { new: true }
        );
        if (!appointment) return res.status(400).json({ success: false, message: 'This consultation is already closed' });

        const record = await MedicalRecord.create({
            patientId: appointment.patientId,
            doctorId: req.user.userId,
            hospitalId: appointment.hospitalId,
            appointmentId: appointment._id,
            symptoms: appointment.reason,
            diagnosis,
            treatment,
            notes: notes ? `[Telemedicine consultation] ${notes}` : '[Telemedicine consultation]',
        });

        const recipient = await patientUserId(appointment);
        if (recipient) {
            await notify({ recipient, hospitalId: appointment.hospitalId, message: 'Your consultation is complete. The notes are in your medical records.', link: '/patient/medical-records' });
        }
        socketService.getIO()?.to(consultationRoom(appointment._id)).emit('consult:status', { status: 'completed' });
        res.json({ success: true, data: { status: appointment.status, endedAt: appointment.endedAt, recordId: record._id } });
    } catch (error) {
        console.error('Complete consultation error:', error.message);
        res.status(500).json({ success: false, message: 'Could not complete the consultation' });
    }
};

/**
 * GET /consultations/ice-servers  STUN/TURN servers for the call.
 * TURN is optional (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL) and helps on strict networks.
 */
exports.getIceServers = (req, res) => {
    const iceServers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean) }];
    if (process.env.TURN_URL) {
        iceServers.push({
            urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL,
        });
    }
    res.json({ success: true, data: { iceServers, realtimeAvailable: Boolean(socketService.getIO()) } });
};

