const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({

    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    items: [
        {
            description: String,
            amount: Number
        }
    ],

    totalAmount: {
        type: Number,
        default: 0,
        required: true
    },

    status: {
        type: String,
        enum: ['unpaid', 'paid', 'cancelled'],
        default: 'unpaid'
    },

    paymentMethod: {
        type: String,
        enum: ['cash', 'credit_card', 'transfer'],
    }
},
{ timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);