const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');

/**
 * Load a telemedicine appointment if `user` is one of its two participants:
 * the assigned doctor or the patient it belongs to, within their own hospital.
 * Used by both the REST API and the Socket.IO signalling, so access rules match.
 *
 * @param {{userId: string, role: string, hospitalId?: string}} user  decoded token
 * @returns {Promise<{appointment: object, participant: 'doctor'|'patient'} | null>}
 */
const loadConsultation = async (user, appointmentId) => {
    if (!user || !mongoose.isValidObjectId(appointmentId)) return null;

    const appointment = await Appointment.findOne({ _id: appointmentId, mode: 'telemedicine' });
    if (!appointment) return null;
    if (user.hospitalId && String(appointment.hospitalId) !== String(user.hospitalId)) return null;

    if (user.role === 'doctor' && String(appointment.doctorId) === String(user.userId)) {
        return { appointment, participant: 'doctor' };
    }
    if (user.role === 'patient') {
        const patient = await Patient.findOne({ _id: appointment.patientId, userId: user.userId }).select('_id');
        if (patient) return { appointment, participant: 'patient' };
    }
    return null;
};

const consultationRoom = (appointmentId) => `consult_${appointmentId}`;

module.exports = { loadConsultation, consultationRoom };
