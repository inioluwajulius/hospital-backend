const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { checkSlot } = require('../utils/scheduling');

const APPOINTMENT_FIELDS = ['patientId', 'doctorId', 'appointmentDate', 'reason', 'isUrgent', 'status', 'mode'];

const pick = (body = {}, fields) => {
    const out = {};
    for (const key of fields) {
        if (body[key] !== undefined) out[key] = body[key];
    }
    if (typeof out.status === 'string') out.status = out.status.toLowerCase();
    return out;
};

const ownPatientRecord = (req) =>
    Patient.findOne({ userId: req.user.userId, ...(req.tenantFilter || {}) });

// Ensure referenced doctor/patient belong to the caller's hospital
const validateReferences = async (req, data) => {
    const hospitalId = req.tenantFilter?.hospitalId;
    if (!hospitalId) return null;
    if (data.doctorId !== undefined) {
        const doctor = await User.findOne({ _id: data.doctorId, role: 'doctor', hospitalId }).select('_id');
        if (!doctor) return 'Doctor not found in this hospital';
    }
    if (data.patientId !== undefined) {
        const patient = await Patient.findOne({ _id: data.patientId, hospitalId }).select('_id');
        if (!patient) return 'Patient not found in this hospital';
    }
    return null;
};

exports.createAppointment = async (req, res) => {
    try {
        const appointmentData = pick(req.body, APPOINTMENT_FIELDS);
        
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            appointmentData.hospitalId = req.tenantFilter.hospitalId;
        }

        // If patient is creating their own appointment, force patientId
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await ownPatientRecord(req);
            if (!patientRecord) {
                return res.status(404).json({ message: 'Patient profile not found' });
            }
            appointmentData.patientId = patientRecord._id;
            appointmentData.status = 'scheduled'; // Default for patient-booked
        } else if (req.user && req.user.role === 'doctor') {
            // Doctors book appointments for themselves
            appointmentData.doctorId = req.user.userId;
        }

        const referenceError = await validateReferences(req, appointmentData);
        if (referenceError) {
            return res.status(400).json({ success: false, message: referenceError });
        }

        if (!appointmentData.doctorId) {
            return res.status(400).json({ success: false, message: 'Please choose a doctor' });
        }
        const slotError = await checkSlot(appointmentData);
        if (slotError) {
            return res.status(409).json({ success: false, message: slotError });
        }

        const appointment = new Appointment(appointmentData);
        await appointment.save();

        // Notify Doctor
        if (appointment.doctorId) {
            try {
                const doctorRecord = await User.findById(appointment.doctorId);
                
                if (doctorRecord && doctorRecord.role === 'doctor') {
                    const isRemote = appointment.mode === 'telemedicine';
                    const notif = await Notification.create({
                        recipient: doctorRecord._id,
                        hospitalId: req.tenantFilter?.hospitalId || appointment.hospitalId,
                        type: 'APPOINTMENT',
                        message: `New ${isRemote ? 'video consultation' : 'appointment'} scheduled for ${new Date(appointment.appointmentDate).toLocaleDateString()}`,
                        link: isRemote ? '/telemedicine' : '/doctor/appointments'
                    });

                    const io = socketService.getIO();
                    if (io) {
                        io.to(doctorRecord._id.toString()).emit('new_notification', notif);
                    }
                }
            } catch (err) {
                console.error('Notification error:', err);
            }
        }

        res.status(201).json({ success: true, data: appointment });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.getAppointments = async (req, res) => {
    try {
        const query = {};
        
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }
        
        // Filter by patient ID if requester is a patient
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await ownPatientRecord(req);
            if (!patientRecord) {
                return res.json({ success: true, data: [] }); // No profile = no appointments
            }
            query.patientId = patientRecord._id;
        } else if (req.user && req.user.role === 'doctor') {
            // Filter by doctor ID if requester is a doctor
            query.doctorId = req.user.userId;
        }

        const appointments = await Appointment.find(query)
            .populate({
                path: 'patientId',
                select: 'userId patientCardNumber',
                populate: { path: 'userId', select: 'name email phone' }
            })
            .populate('doctorId', 'name email specialization department')
            .sort({ appointmentDate: 1 });

        res.json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateAppointment = async (req, res) => {
    try {
        const query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        let updates;

        // If patient, they can only cancel their own
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await ownPatientRecord(req);
            if (!patientRecord) {
                return res.status(404).json({ success: false, message: 'Appointment not found' });
            }
            query.patientId = patientRecord._id;
            updates = pick(req.body, ['status']);
            if (updates.status !== 'cancelled') {
                return res.status(403).json({ success: false, message: 'Patients can only cancel appointments' });
            }
        } else if (req.user && req.user.role === 'doctor') {
            query.doctorId = req.user.userId;
            updates = pick(req.body, ['appointmentDate', 'reason', 'isUrgent', 'status']);
        } else {
            updates = pick(req.body, ['doctorId', 'appointmentDate', 'reason', 'isUrgent', 'status']);
        }

        const referenceError = await validateReferences(req, updates);
        if (referenceError) {
            return res.status(400).json({ success: false, message: referenceError });
        }

        // Moving an appointment to another time or doctor must respect the same booking rules
        if (updates.appointmentDate !== undefined || updates.doctorId !== undefined) {
            const current = await Appointment.findOne(query).select('doctorId appointmentDate isUrgent');
            if (!current) return res.status(404).json({ success: false, message: 'Appointment not found' });
            const slotError = await checkSlot({
                doctorId: updates.doctorId || current.doctorId,
                appointmentDate: updates.appointmentDate || current.appointmentDate,
                isUrgent: updates.isUrgent ?? current.isUrgent,
                excludeAppointmentId: current._id,
            });
            if (slotError) return res.status(409).json({ success: false, message: slotError });
        }

        const appointment = await Appointment.findOneAndUpdate(query, updates, { new: true, runValidators: true });
        if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
        
        res.json({ success: true, data: appointment });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deleteAppointment = async (req, res) => {
    try {
        const query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }
        
        // Only admin or doctor can delete? Or patient can cancel (update).
        // Let's restrict delete to the authorized hospital tenant.

        const appointment = await Appointment.findOneAndDelete(query);
        if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
        
        res.json({ success: true, message: 'Appointment deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};