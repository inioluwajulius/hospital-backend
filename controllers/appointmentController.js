const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const socketService = require('../socket');

exports.createAppointment = async (req, res) => {
    try {
        // If patient is creating their own appointment, force patientId
        const appointmentData = { ...req.body };
        if (req.user && req.user.role === 'patient') {
            const Patient = require('../models/Patient');
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
                const Doctor = require('../models/Doctor');
                const doctorRecord = await Doctor.findById(appointment.doctorId);
                
                if (doctorRecord && doctorRecord.userId) {
                    const notif = await Notification.create({
                        recipient: doctorRecord.userId,
                        hospitalId: req.tenant?.id || appointment.hospitalId,
                        type: 'APPOINTMENT',
                        message: `New appointment scheduled for ${new Date(appointment.appointmentDate).toLocaleDateString()}`,
                        link: '/doctor/appointments'
                    });

                    const io = socketService.getIO();
                    if (io) {
                        io.to(doctorRecord.userId.toString()).emit('new_notification', notif);
                    }
                }
            } catch (err) {
                console.error('Notification error:', err);
            }
        }

        res.status(201).json(appointment);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAppointments = async (req, res) => {
    try {
        const query = {};
        
        // Filter by patient ID if requester is a patient
        if (req.user && req.user.role === 'patient') {
            const Patient = require('../models/Patient');
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) {
                return res.json([]); // No profile = no appointments
            }
            query.patientId = patientRecord._id;
        }

        const appointments = await Appointment.find(query).populate('patientId', 'name').populate('doctorId', 'name');
        res.json(appointments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
        res.json(appointment);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findByIdAndDelete(req.params.id);
        if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
        res.json({ message: 'Appointment deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};