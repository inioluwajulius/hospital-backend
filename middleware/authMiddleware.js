const jwt = require('jsonwebtoken');
const tokenHospitalId = require('../utils/tokenHospital');

const authMiddleware = (req, res, next) => {
	// Validate JWT_SECRET is configured
	if (!process.env.JWT_SECRET) {
		console.error('❌ JWT_SECRET is not configured in environment variables');
		return res.status(500).json({ message: 'Server configuration error: JWT_SECRET missing' });
	}

	const authHeader = req.headers.authorization;

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return res.status(401).json({ message: 'Not authorized, token missing' });
	}

	const token = authHeader.split(' ')[1];

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.user = {
			id: decoded.userId,
			_id: decoded.userId, // Alias for compatibility with controllers using _id
			userId: decoded.userId, // Alias for compatibility with controllers using userId
			role: decoded.role,
			isSuperAdmin: decoded.isSuperAdmin,
			hospitalId: tokenHospitalId(decoded)
		};
		// After an admin-issued temporary password, only the password change is allowed
		if (decoded.mustChangePassword) {
			const path = (req.originalUrl || '').split('?')[0];
			const allowed = path.endsWith('/auth/change-password') || (req.method === 'GET' && path.endsWith('/auth/me'));
			if (!allowed) {
				return res.status(403).json({ message: 'Please choose a new password to continue.', code: 'PASSWORD_CHANGE_REQUIRED' });
			}
		}
		next();
	} catch (error) {
		if (error.name === 'TokenExpiredError') {
			return res.status(401).json({ message: 'Token expired, please login again' });
		}
		return res.status(401).json({ message: 'Not authorized, token invalid' });
	}
};

module.exports = authMiddleware;
