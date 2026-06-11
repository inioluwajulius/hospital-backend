const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const bcryptjs = require('bcryptjs');
const User = require('../models/User');
const SuperAdmin = require('../models/SuperAdmin');

require('dotenv').config();

async function createSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Default credentials (CHANGE IN PRODUCTION!)
    const email = 'superadmin@yourhospitalapp.com';
    const password = 'SuperAdmin@123'; // CHANGE THIS IMMEDIATELY!

    // Check if super admin already exists
    let user = await User.findOne({ email });
    if (user) {
      const superAdminRec = await SuperAdmin.findOne({ userId: user._id });
      if (superAdminRec) {
        console.log('\n⚠️  Super admin already exists with this email!');
        console.log(`Email: ${email}`);
        process.exit(0);
      } else {
        console.log('User exists but SuperAdmin record is missing. Creating SuperAdmin record...');
      }
    } else {
      // Hash password
      const hashedPassword = await bcryptjs.hash(password, 10);

      // Create user
      user = await User.create({
        name: 'Platform Super Admin',
        email,
        password: hashedPassword,
        role: 'super_admin',
        isSuperAdmin: true,
        status: 'active',
      });

      console.log('✅ User created');
    }

    // Create SuperAdmin record
    const superAdmin = await SuperAdmin.create({
      userId: user._id,
      email,
      status: 'active',
    });

    console.log('✅ SuperAdmin record created');

    console.log('\n' + '='.repeat(60));
    console.log('✅ SUPER ADMIN CREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log(`\nEmail:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`User ID:  ${user._id}`);
    console.log('\n⚠️  IMPORTANT: Change this password immediately in production!');
    console.log('\nYou can now:');
    console.log('1. Login with these credentials');
    console.log('2. Create hospitals via the API');
    console.log('3. Manage hospital admins and staff');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  createSuperAdmin();
}

module.exports = createSuperAdmin;
