const Billing = require('../models/Billing');
const Invoice = require('../models/Invoice');
const Patient = require('../models/Patient');

/**
 * Create new billing invoice
 * ADMIN or ACCOUNTANT only
 */
exports.createBilling = async (req, res) => {
    try {
        const { patientId, items, subtotal, tax, totalAmount, dueDate, paymentMethod, notes } = req.body;

        const invoiceNumber = `INV-${Date.now()}`;

        const billingData = {
            patientId,
            invoiceNumber,
            items,
            subtotal,
            tax,
            totalAmount,
            balanceDue: totalAmount,
            dueDate,
            paymentMethod,
            notes,
            createdBy: req.user.userId
        };

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            billingData.hospitalId = req.tenantFilter.hospitalId;
        }

        const billing = new Billing(billingData);

        await billing.save();
        await billing.populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });
        res.status(201).json({ success: true, data: billing });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

/**
 * Get all or filtered billing records
 * ADMIN, ACCOUNTANT, FINANCE only
 */
exports.getBilling = async (req, res) => {
    try {
        const { patientId, status } = req.query;
        let query = {};
        
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        // Patient can only see their own billing
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json({ success: true, data: [] });
            query.patientId = patientRecord._id;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;

        const billing = await Billing.find(query)
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } })
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: billing });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Update billing record (ADMIN ONLY - no direct edits, use amendments for compliance)
 */
exports.updateBilling = async (req, res) => {
    try {
        const { id } = req.params;
        const { amountPaid, status, paymentMethod, notes } = req.body;

        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const billing = await Billing.findOne(query);
        if (!billing) {
            return res.status(404).json({ success: false, message: 'Billing record not found' });
        }

        // Only allow updating payment status, not line items (compliance)
        if (amountPaid !== undefined) {
            billing.amountPaid += amountPaid;
            billing.balanceDue = billing.totalAmount - billing.amountPaid;
        }

        if (status) billing.status = status;
        if (paymentMethod) billing.paymentMethod = paymentMethod;
        if (notes) billing.notes = notes;

        await billing.save();
        await billing.populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });

        res.json({ success: true, data: billing });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

/**
 * Delete billing (ADMIN ONLY - creates audit log, not permanent)
 */
exports.deleteBilling = async (req, res) => {
    try {
        const { id } = req.params;
        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const billing = await Billing.findOneAndDelete(query);
        if (!billing) {
            return res.status(404).json({ success: false, message: 'Billing record not found' });
        }

        res.json({ success: true, message: 'Billing record deleted (audit logged)', invoiceNumber: billing.invoiceNumber });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/********************
 * Invoice generation and management (ADMIN ONLY)
 ********************/
exports.createInvoice = async (req, res) => {
    try {
        const { patientId, items } = req.body;

        const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

        const invoiceData = {
            patientId,
            items,
            totalAmount
        };
        
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            invoiceData.hospitalId = req.tenantFilter.hospitalId;
        }

        const invoice = new Invoice(invoiceData);

        await invoice.save();
        res.status(201).json({ success: true, data: invoice });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.getInvoice = async (req, res) => {
    try {
        let query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const invoice = await Invoice.findOne(query).populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }
        res.json({ success: true, data: invoice });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.payInvoice = async (req, res) => {
    try {
        let query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }
        
        const invoice = await Invoice.findOneAndUpdate(
            query,
            { status: 'paid' },
            { new: true }
        ).populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });
        
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        
        res.json({ success: true, data: invoice });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Backward-compatible alias used by billing routes.
exports.getInvoices = exports.getBilling;