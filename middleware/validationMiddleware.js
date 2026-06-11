/**
 * Input Validation Middleware
 * Validates and sanitizes request bodies to prevent injection attacks
 */

const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validatePhone = (phone) => {
    // Accept various phone formats
    const phoneRegex = /^[\d\s-+()]{7,}$/;
    return phoneRegex.test(phone);
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    // Remove potential XSS vectors
    return str
        .replace(/[<>]/g, '')
        .trim();
};

/**
 * Middleware to validate registration/login payloads
 */
const validateAuthInput = (req, res, next) => {
    const { email, password, name } = req.body;

    // Check required fields
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    // Validate email format
    if (!validateEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Sanitize strings
    req.body.email = email.toLowerCase().trim();
    req.body.name = name ? sanitizeString(name) : '';

    next();
};

/**
 * Middleware to validate patient data
 */
const validatePatientInput = (req, res, next) => {
    const { phone, age, bloodGroup } = req.body;

    if (phone && !validatePhone(phone)) {
        return res.status(400).json({ message: 'Invalid phone number format' });
    }

    if (age && (typeof age !== 'number' || age < 0 || age > 150)) {
        return res.status(400).json({ message: 'Age must be a valid number between 0 and 150' });
    }

    const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    if (bloodGroup && !validBloodGroups.includes(bloodGroup)) {
        return res.status(400).json({ message: 'Invalid blood group' });
    }

    next();
};

/**
 * Middleware to validate MongoDB ObjectId
 */
const validateObjectId = (req, res, next) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ message: 'ID parameter is required' });
    }

    // Basic ObjectId validation (24 hex characters)
    if (!/^[0-9a-f]{24}$/i.test(id)) {
        return res.status(400).json({ message: 'Invalid ID format' });
    }

    next();
};

/**
 * Middleware to check if request body is too large
 */
const validateRequestSize = (req, res, next) => {
    const contentLength = req.headers['content-length'];
    
    // Limit request body to 10MB
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        return res.status(413).json({ message: 'Request body too large' });
    }

    next();
};

module.exports = {
    validateAuthInput,
    validatePatientInput,
    validateObjectId,
    validateRequestSize,
    sanitizeString,
    validateEmail,
    validatePhone
};
