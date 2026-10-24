const mongoose = require('mongoose');

/**
 * A patient-doctor message thread within one hospital. One thread per pair
 * (unique index), so reopening a conversation never creates a duplicate.
 */
const conversationSchema = new mongoose.Schema({
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastMessageAt: Date,
    lastMessageText: { type: String, maxlength: 140 },
    lastSenderRole: { type: String, enum: ['patient', 'doctor'] },
    patientUnread: { type: Number, default: 0 },
    doctorUnread: { type: Number, default: 0 },
}, { timestamps: true });

conversationSchema.index({ hospitalId: 1, patientId: 1, doctorId: 1 }, { unique: true });
conversationSchema.index({ doctorId: 1, lastMessageAt: -1 });
conversationSchema.index({ patientId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
