const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    specialization: {
        type: String,
        required: true
    },

    licenseNumber: {
        type: String,
        required: true,
        unique: true
    },

    department: {
        type: String
    },

    phone: String,

    experience: Number,

    availableDays: [String],
}, {
    timestamps: true
});

module.exports = mongoose.model('Doctor', doctorSchema);