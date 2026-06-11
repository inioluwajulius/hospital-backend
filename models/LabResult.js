const mongoose = require('mongoose');

const labResultSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    testOrder: {
        type: String,
        unique: true,
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Doctor'
    },

    labTechnician: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    testName: {
        type: String,
        required: true
    },

    testCategory: {
        type: String,
        enum: ['blood', 'urine', 'biochemistry', 'microbiology', 'imaging', 'other'],
        default: 'blood'
    },

    orderedDate: {
        type: Date,
        default: Date.now
    },

    collectionDate: Date,

    completionDate: Date,

    results: [{
        parameter: String,
        value: String,
        unit: String,
        referenceRange: String,
        status: {
            type: String,
            enum: ['normal', 'abnormal', 'critical'],
            default: 'normal'
        }
    }],

    notes: String,

    attachments: [String], // File URLs for test results

    status: {
        type: String,
        enum: ['ordered', 'in_progress', 'completed', 'pending_review', 'reviewed'],
        default: 'ordered'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LabResult', labResultSchema);
