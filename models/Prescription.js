const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema({

    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Hospital",
        required: true
    },

    medications: [
        {
            name: String,
            dosage: String,
            frequency: String,
            duration: String
        }
    ],

    notes: String,

    status: {
        type: String,
        enum: ["pending", "dispensed"],
        default: "pending"
    }

}, { timestamps: true });

module.exports = mongoose.model("Prescription", prescriptionSchema);
