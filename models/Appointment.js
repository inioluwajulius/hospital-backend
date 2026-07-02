const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true
    },

    appointmentDate: {
        type: Date,
        required: true
    },

    reason: String,

    isUrgent: {
        type: Boolean,
        default: false
    },

    status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled'],
        default: 'scheduled'
    },
}
, {
    timestamps: true
});

module.exports = mongoose.model('Appointment', appointmentSchema);