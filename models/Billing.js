const mongoose = require('mongoose');

const billingSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    invoiceNumber: {
        type: String,
        unique: true,
        required: true
    },

    invoiceDate: {
        type: Date,
        default: Date.now
    },

    items: [{
        description: String,
        quantity: Number,
        unitPrice: Number,
        totalPrice: Number
    }],

    subtotal: {
        type: Number,
        required: true
    },

    tax: {
        type: Number,
        default: 0
    },

    totalAmount: {
        type: Number,
        required: true
    },

    amountPaid: {
        type: Number,
        default: 0
    },

    balanceDue: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: ['pending', 'partial', 'paid', 'overdue', 'cancelled'],
        default: 'pending'
    },

    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'check', 'insurance', 'other'],
        default: null
    },

    dueDate: Date,

    notes: String,

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Billing', billingSchema);
