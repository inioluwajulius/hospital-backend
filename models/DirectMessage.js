const mongoose = require('mongoose');

/** A message in a patient-doctor conversation */
const directMessageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['patient', 'doctor'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    // Client-generated id so a resend after a dropped connection isn't stored twice
    clientId: { type: String, maxlength: 64 },
    readAt: Date,
}, { timestamps: true });

directMessageSchema.index({ conversationId: 1, createdAt: -1 });
directMessageSchema.index({ conversationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });

module.exports = mongoose.model('DirectMessage', directMessageSchema);
