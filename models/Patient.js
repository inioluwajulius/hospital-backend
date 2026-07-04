const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true
    },

    patientCardNumber: {
        type: String,
        required: true,
        unique: true
    },

    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },

    registrationStatus: {
        type: String,
        enum: ['new', 'existing_linked', 'self_registered'],
        default: 'new'
    },

    dateOfBirth: Date,

    age: Number,

    gender: String,

    phone: String,

    address: String,

    bloodGroup: String,

    allergies: [String],

    medicalHistory: String,

    currentMedications: String,

    insurance: {
        provider: String,
        policyNumber: String,
        status: {
            type: String,
            enum: ['Active', 'Inactive', 'Expired'],
            default: 'Active'
        }
    },

    immunizations: [{
        name: String,
        date: Date,
        status: {
            type: String,
            enum: ['completed', 'due', 'scheduled'],
            default: 'completed'
        }
    }],

    approvedAt: Date,

    approvalNotes: String,

    rejectedAt: Date,

    rejectionReason: String,
}, {
    timestamps: true
});

module.exports = mongoose.model('Patient', patientSchema);