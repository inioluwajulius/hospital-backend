const mongoose = require('mongoose');

const radiologySchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    examOrder: {
        type: String,
        unique: true,
        required: true
    },

    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Doctor'
    },

    radiologist: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    examType: {
        type: String,
        enum: ['xray', 'ct', 'mri', 'ultrasound', 'pet', 'mammography', 'fluoroscopy', 'other'],
        required: true
    },

    bodyPart: String, // e.g., "Chest", "Abdomen", "Brain"

    orderedDate: {
        type: Date,
        default: Date.now
    },

    examDate: Date,

    reportGeneratedDate: Date,

    reportFindings: String, // Radiologist's findings/interpretation

    impression: String, // Clinical impression/diagnosis

    recommendations: String, // Recommended follow-up or next steps

    imageCount: Number,

    imageUrls: [String], // URLs to stored images (DICOM or other format)

    status: {
        type: String,
        enum: ['ordered', 'scheduled', 'completed', 'pending_review', 'reviewed'],
        default: 'ordered'
    },

    priority: {
        type: String,
        enum: ['routine', 'urgent', 'stat'],
        default: 'routine'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Radiology', radiologySchema);
