const mongoose = require('mongoose');

const dispenseSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    prescriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Prescription'
    },

    drugId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Drug',
        required: true
    },

    quantity: {
        type: Number,
        required: true
    },

    pharmacistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
},{ timestamps: true});

module.exports = mongoose.model('Dispense', dispenseSchema)