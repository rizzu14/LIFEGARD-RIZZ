// Quick MongoDB connection test
// Run: node test-mongo.js

require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri || uri.includes('<password>')) {
  console.error('❌ ERROR: Please update MONGODB_URI in your .env file first!');
  console.error('   Replace <password> with your actual Atlas password.');
  process.exit(1);
}

console.log('🔄 Connecting to MongoDB Atlas...');

mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    console.log('✅ SUCCESS! MongoDB Atlas connected.');
    console.log('   Host:', mongoose.connection.host);
    console.log('   Database:', mongoose.connection.name);

    // Create a test document
    const Test = mongoose.model('Test', new mongoose.Schema({ message: String, createdAt: Date }));
    await Test.create({ message: 'LIFEGRID connected!', createdAt: new Date() });
    console.log('✅ Test document written successfully.');

    // Clean up
    await mongoose.connection.dropCollection('tests').catch(() => {});
    await mongoose.disconnect();
    console.log('\n🎉 MongoDB Atlas is ready for LIFEGRID!');
    console.log('   Your MONGODB_URI is correctly configured.');
  })
  .catch(err => {
    console.error('❌ Connection FAILED:', err.message);
    console.error('\nCommon fixes:');
    console.error('  1. Check your password has no special characters that need encoding');
    console.error('  2. Make sure 0.0.0.0/0 is in your Atlas IP Access List (Step 4)');
    console.error('  3. Verify the connection string was copied correctly from Atlas');
    process.exit(1);
  });
