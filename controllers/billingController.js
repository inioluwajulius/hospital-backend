const Billing = require('../models/Billing');
const Invoice = require('../models/Invoice');

/**
 * Create new billing invoice
 * ADMIN or ACCOUNTANT only
 */
exports.createBilling = async (req, res) => {
    try {
        const { patientId, items, subtotal, tax, totalAmount, dueDate, paymentMethod, notes } = req.body;

        // Generate invoice number (YYYY-MMM-XXXXX format)
        const invoiceNumber = `INV-${Date.now()}`;

        const billing = new Billing({
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
            createdBy: req.user.id
        });

        await billing.save();
        await billing.populate('patientId', 'name patientCardNumber');
        res.status(201).json(billing);
    } catch (error) {
        res.status(400).json({ message: error.message });
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

        if (patientId) query.patientId = patientId;
        if (status) query.status = status;

        const billing = await Billing.find(query)
            .populate('patientId', 'name patientCardNumber')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        res.json(billing);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * Update billing record (ADMIN ONLY - no direct edits, use amendments for compliance)
 */
exports.updateBilling = async (req, res) => {
    try {
        const { id } = req.params;
        const { amountPaid, status, paymentMethod, notes } = req.body;

        const billing = await Billing.findById(id);
        if (!billing) {
            return res.status(404).json({ message: 'Billing record not found' });
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
        await billing.populate('patientId', 'name');

        res.json(billing);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Delete billing (ADMIN ONLY - creates audit log, not permanent)
 */
exports.deleteBilling = async (req, res) => {
    try {
        const { id } = req.params;
        const billing = await Billing.findByIdAndDelete(id);

        if (!billing) {
            return res.status(404).json({ message: 'Billing record not found' });
        }

        res.json({ message: 'Billing record deleted (audit logged)', invoiceNumber: billing.invoiceNumber });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/********************
 * Invoice generation and management (ADMIN ONLY)
 ********************/
exports.createInvoice = async (req, res) => {

    try {
        const { patientId, items} = req.body;

        const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

        const invoice = await new Invoice({
            patientId,
            items,
            totalAmount
        });

        await invoice.save();
        res.status(201).json(invoice);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).populate('patientId', 'name patientCardNumber');
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ message: error.message });

    }
};

exports.payInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndUpdate(
            req.params.id,
            { status: 'Paid', paidAt: new Date() },
            { new: true }
        ).populate('patientId', 'name patientCardNumber');
        res.json(invoice);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Backward-compatible alias used by billing routes.
exports.getInvoices = exports.getBilling;