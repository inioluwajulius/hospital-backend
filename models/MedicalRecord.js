const mongoose = require("mongoose");

const medicalRecordSchema = new mongoose.Schema({

  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Patient",
    required: true
  },

  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true
  },

  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment"
  },

  symptoms: String,

  diagnosis: String,

  treatment: String,

  notes: String

}, { timestamps: true });

module.exports = mongoose.model("MedicalRecord", medicalRecordSchema);
