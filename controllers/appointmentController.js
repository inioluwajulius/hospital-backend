const Appointment = require('../models/Appointment');

exports.createAppointment = async (req, res) => {
    try {
        const appointment = new Appointment(req.body);

        await appointment.save();
        res.status(201).json(appointment);
    } catch (error) {
        res.status(400).json({ error: error.message });

    }
};

exports.getAppointments = async (req, res) => {

    try {

        const appointments = await Appointment.find().populate('patientId', 'name').populate('doctorId', 'name');
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