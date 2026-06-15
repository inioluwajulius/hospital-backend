const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        hospitalId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Hospital',
            required: false, // For platform-level admins it might be null
        },
        type: {
            type: String,
            required: true,
            enum: ['SYSTEM', 'APPOINTMENT', 'REGISTRATION', 'LAB_RESULT', 'PRESCRIPTION', 'BILLING', 'GENERAL'],
            default: 'GENERAL',
        },
        message: {
            type: String,
            required: true,
        },
        link: {
            type: String, // Optional URL to navigate to
        },
        read: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// Index for fast queries
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
