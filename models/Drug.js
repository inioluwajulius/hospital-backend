const mongoose = require('mongoose');

const drugSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true
    },

    category: {
        type: String,
    },

    manufacturer: {
        type: String
    },

    price: {
        type: Number,
        required: true
    },

    stock: {
        type: Number,
        required: true,
        default: 0
    },

    isActive: {
        type: Boolean,
        default: true,
        index: true
    },

    deletedAt: {
        type: Date,
        default: null
    },

    expiryDate: {
        type: Date
    }
}, { timestamps: true});

module.exports = mongoose.model('Drug', drugSchema);