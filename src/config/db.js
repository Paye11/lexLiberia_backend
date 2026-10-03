const mongoose = require('mongoose');

function getMongoUri() {
  const raw = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
  return raw.trim();
}

const connectDB = async () => {
  try {
    const mongoUri = getMongoUri();
    if (!mongoUri) {
      throw new Error(
        'Missing MongoDB connection URI. Set the env var MONGODB_URI (or MONGO_URI) in Railway → Variables tab. Expected something like mongodb+srv://user:pass@clusterX.mongodb.net/lexliberia?retryWrites=true&w=majority',
      );
    }
    console.log('Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    console.log('💡 Please make sure MongoDB is running locally or update your MONGODB_URI in Railway Variables (Settings → Variables).');
    process.exit(1);
  }
};

module.exports = connectDB;
