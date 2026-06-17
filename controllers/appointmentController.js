const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const Patient = require('../models/Patient');
const User = require('../models/User');

exports.createAppointment = async (req, res) => {
    try {
        const appointmentData = { ...req.body };
        
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            appointmentData.hospitalId = req.tenantFilter.hospitalId;
        }

        // If patient is creating their own appointment, force patientId
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) {
                return res.status(404).json({ message: 'Patient profile not found' });
            }
            appointmentData.patientId = patientRecord._id;
            appointmentData.status = 'scheduled'; // Default for patient-booked
        }

        const appointment = new Appointment(appointmentData);
        await appointment.save();

        // Notify Doctor
        if (appointment.doctorId) {
            try {
                const doctorRecord = await User.findById(appointment.doctorId);
                
                if (doctorRecord && doctorRecord.role === 'doctor') {
                    const notif = await Notification.create({
                        recipient: doctorRecord._id,
                        hospitalId: req.tenantFilter?.hospitalId || appointment.hospitalId,
                        type: 'APPOINTMENT',
                        message: `New appointment scheduled for ${new Date(appointment.appointmentDate).toLocaleDateString()}`,
                        link: '/doctor/appointments'
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
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
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
            .populate('doctorId', 'name email specialization department');

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

        // If patient, they can only update their own
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (patientRecord) {
                query.patientId = patientRecord._id;
            }
        } else if (req.user && req.user.role === 'doctor') {
            query.doctorId = req.user.userId;
        }

        const appointment = await Appointment.findOneAndUpdate(query, req.body, { new: true });
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