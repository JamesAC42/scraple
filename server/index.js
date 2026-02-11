require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const {createClient} = require('redis');
const { getDailyPuzzle } = require('./controllers/getDailyPuzzle');
const { getBlitzPuzzle } = require('./controllers/getBlitzPuzzle');
const { getBotDailyGame } = require('./controllers/getBotDailyGame');
const { getBotDailyWordBreakdown } = require('./controllers/getBotDailyWordBreakdown');
const { shareImage } = require('./controllers/shareImage');
const { 
  submitScore, 
  getLeaderboard, 
  getTotalScores,
  getWordBreakdown,
  submitBlitzScore,
  getBlitzLeaderboard,
  getBlitzTotalScores,
  getBlitzWordBreakdown,
  submitComment,
  getComments,
  submitBlitzComment,
  getBlitzComments,
  setPlayerNickname,
  initializeDictionary
} = require('./controllers/leaderboard');

// Create Redis client with configuration
const redisClient = createClient({
  password: process.env.REDIS_PW || undefined,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis connection failed after multiple retries');
        return false;
      }
      return Math.min(retries * 100, 3000);
    }
  }
});

// Handle Redis connection events
redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

const PORT = 5677;

app.use(cors({
  origin: process.env.LOCAL === 'true' ? 'http://localhost:3001' : 'https://scraple.io',
  credentials: true
}));

// Add JSON parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Make Redis client available to route handlers
app.set('redisClient', redisClient);

// API routes
app.get('/api/daily-puzzle', getDailyPuzzle);
app.get('/api/blitz-puzzle', getBlitzPuzzle);
app.get('/api/bot-daily', getBotDailyGame);
app.get('/api/bot-daily-word-breakdown', getBotDailyWordBreakdown);
app.post('/api/share-image', shareImage);
app.post('/api/leaderboard/submit', submitScore);
app.get('/api/leaderboard', getLeaderboard);
app.get('/api/leaderboard/total', getTotalScores);
app.get('/api/leaderboard/word-breakdown', getWordBreakdown);
app.post('/api/leaderboard/comments', submitComment);
app.get('/api/leaderboard/comments', getComments);
app.post('/api/player/nickname', setPlayerNickname);
app.post('/api/blitz/leaderboard/submit', submitBlitzScore);
app.get('/api/blitz/leaderboard', getBlitzLeaderboard);
app.get('/api/blitz/leaderboard/total', getBlitzTotalScores);
app.get('/api/blitz/leaderboard/word-breakdown', getBlitzWordBreakdown);
app.post('/api/blitz/leaderboard/comments', submitBlitzComment);
app.get('/api/blitz/leaderboard/comments', getBlitzComments);

// Connect to Redis before starting the server
async function startServer() {
  try {
    await redisClient.connect();
    await initializeDictionary(redisClient);
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);
