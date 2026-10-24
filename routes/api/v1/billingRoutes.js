const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const {
	createInvoice,
	getInvoices,
	payInvoice
} = require('../../../controllers/billingController');

router.post("/", authMiddleware, authorize("admin", "accountant"), createInvoice);

router.get("/", authMiddleware, getInvoices);

router.put("/:id/pay", authMiddleware, authorize("admin", "accountant"), payInvoice);

module.exports = router;