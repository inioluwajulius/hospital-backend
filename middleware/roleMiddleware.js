const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ message: 'Not authorized' });

        // Normalize roles for comparison
        const userRole = req.user.role ? req.user.role.toLowerCase() : '';
        const normalizedAllowedRoles = allowedRoles.map(role => role.toLowerCase());

        // Map hierarchy
        let userRoles = [userRole];
        if (userRole === 'super_admin') {
            userRoles.push('admin', 'hospital_admin');
        } else if (userRole === 'hospital_admin') {
            userRoles.push('admin');
        }

        // Check if user has any of the allowed roles
        const hasAccess = normalizedAllowedRoles.some(role => userRoles.includes(role));

        if (!hasAccess) {
            return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
};

module.exports = authorize;