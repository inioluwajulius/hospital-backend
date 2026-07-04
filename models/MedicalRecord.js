const mongoose = require("mongoose");

const medicalRecordSchema = new mongoose.Schema({

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

  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment"
  },

  vitals: {
    bloodPressure: String,
    heartRate: Number,
    weight: Number,
    height: Number,
    temperature: Number
  },

  symptoms: String,

  diagnosis: String,

  treatment: String,

  notes: String

}, { timestamps: true });

module.exports = mongoose.model("MedicalRecord", medicalRecordSchema);
