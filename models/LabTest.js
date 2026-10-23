const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({

    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    testName: {
        type: String,
        required: true
    },

    category: {
        type: String,
        enum: ['Blood', 'Urine', 'Biochemistry', 'Microbiology', 'Imaging', 'Other'],
        default: 'Other'
    },
    priority: {
        type: String,
        enum: ['Normal', 'Urgent', 'STAT'],
        default: 'Normal'
    },
    status: {
        type: String,
        enum: ['Pending', 'In-Progress', 'Completed'],
        default: 'Pending'
    },
    result: {
        type: String
    },

    labTechnicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    date: {
        type: Date,
        default: Date.now
    }
} , 
{ timestamps: true }
);

module.exports = mongoose.model('LabTest', labTestSchema);