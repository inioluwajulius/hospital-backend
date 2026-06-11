const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    patientCardNumber: {
        type: String,
        required: true,
        unique: true
    },

    status: {
        type: String,
        enum: ['pending', 'active', 'rejected'],
        default: 'pending'
    },

    registrationStatus: {
        type: String,
        enum: ['new', 'existing_linked', 'self_registered'],
        default: 'new'
    },

    dateOfBirth: Date,

    gender: String,

    phone: String,

    address: String,

    bloodGroup: String,

    allergies: [String],

    medicalHistory: String,

    currentMedications: String,

    approvedAt: Date,

    approvalNotes: String,

    rejectedAt: Date,

    rejectionReason: String,
}, {
    timestamps: true
});

module.exports = mongoose.model('Patient', patientSchema);