const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");

const {
	createInvoice,
	getInvoices,
	payInvoice
} = require("../controllers/billingController");

router.post("/", authMiddleware, authorize("accountant"), createInvoice);

router.get("/", getInvoices);

router.put("/:id/pay", authMiddleware, authorize("accountant"), payInvoice);

module.exports = router;