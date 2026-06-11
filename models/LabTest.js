const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({

    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Doctor',
        required: true
    },

    testName: {
        type: String,
        required: true
    },

    result: {
        type: String
    },

    labTechnicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LabTechnician'
    },
    date: {
        type: Date,
        default: Date.now
    }
} , 
{ timestamps: true }
);

module.exports = mongoose.model('LabTest', labTestSchema);