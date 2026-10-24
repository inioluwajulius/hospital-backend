const mongoose = require('mongoose');

/**
 * Text messages exchanged during a telemedicine consultation. Persisted so the
 * conversation survives dropped connections and doubles as a low-data channel
 * when a call isn't possible.
 */
const consultationMessageSchema = new mongoose.Schema({
    appointmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment',
        required: true,
        index: true,
    },
    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true,
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    senderRole: {
        type: String,
        enum: ['doctor', 'patient'],
        required: true,
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
    },
    // Client-generated id so a message resent after a network drop isn't stored twice
    clientId: {
        type: String,
        maxlength: 64,
    },
}, { timestamps: true });

consultationMessageSchema.index({ appointmentId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });

module.exports = mongoose.model('ConsultationMessage', consultationMessageSchema);
