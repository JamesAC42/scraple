const { createClient } = require('redis');

// Format date as YYYY-MM-DD in Eastern Time
const getFormattedDate = () => {
  const date = new Date();
  const options = { timeZone: 'America/New_York' };
  const etDate = new Date(date.toLocaleString('en-US', options));
  return etDate.toISOString().split('T')[0];
};

// Redis key for storing the daily leaderboard
const REDIS_KEY_PREFIX = 'scraple:leaderboard:';

// Submit score to leaderboard
const submitScore = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const { score, gameState, playerId } = req.body;
    
    if (!score || !gameState || !playerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const today = getFormattedDate();
    const redisKey = `${REDIS_KEY_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;
    
    try {
      // Store the game state in a hash using playerId as key
      await redisClient.hSet(statesKey, playerId, JSON.stringify(gameState));
      
      // Add score to sorted set
      const numScore = Number(score);
      await redisClient.zAdd(redisKey, { score: numScore, value: playerId });
      
      // Set expiration for both keys (36 hours to ensure it lasts through the day)
      await redisClient.expire(redisKey, 60 * 60 * 36);
      await redisClient.expire(statesKey, 60 * 60 * 36);
      
      // Get player's rank (using zRank with reverse order)
      // We need to get the rank from the end, so we use zRank
      // For a sorted set with scores in ascending order, the rank from the end is:
      // (total members - 1) - rank from start
      const totalMembers = await redisClient.zCard(redisKey);
      const rankFromStart = await redisClient.zRank(redisKey, playerId);
      const rank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
      
      // Get total number of scores
      const totalScores = totalMembers;
      
      // Calculate percentile (higher is better)
      const percentile = totalScores > 0 ? Math.round(((totalScores - rank - 1) / totalScores) * 100) : 100;
      
      // Get top 10 scores - we need to get from the end of the sorted set
      // To get the top 10 (highest scores), we need to get the last 10 elements
      // If we have less than 10 elements, we get all of them
      const start = Math.max(0, totalMembers - 10);
      const topScoresMembers = await redisClient.zRange(redisKey, start, -1);
      // Reverse the array to get highest scores first
      topScoresMembers.reverse();
      
      // Get scores for each member
      const formattedTopScores = [];
      for (const member of topScoresMembers) {
        const memberScore = await redisClient.zScore(redisKey, member);
        formattedTopScores.push({
          value: member,
          score: parseFloat(memberScore)
        });
      }
      
      // Check if player is in top 10
      const isInTopTen = rank !== null && rank < 10;
      
      const response = {
        rank: rank !== null ? rank + 1 : null, // Convert to 1-indexed rank
        totalScores,
        percentile,
        isInTopTen,
        topScores: formattedTopScores.map(item => ({
          playerId: item.value,
          score: item.score,
          isCurrentPlayer: item.value === playerId
        }))
      };
      res.status(200).json(response);
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error submitting score:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
};

// Get leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const { playerId } = req.query;
    
    const today = getFormattedDate();
    const redisKey = `${REDIS_KEY_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;
    
    try {
      // Check if the sorted set exists
      const keyExists = await redisClient.exists(redisKey);
      if (!keyExists) {
        return res.status(200).json({
          scores: [],
          playerInfo: null,
          totalPlayers: 0,
          date: today
        });
      }
      
      // Get total number of members
      const totalMembers = await redisClient.zCard(redisKey);
      
      // Get all scores - get all members from the sorted set
      // Get all members and reverse the order to get highest scores first
      const allScoresMembers = await redisClient.zRange(redisKey, 0, -1);
      allScoresMembers.reverse();
      
      // Get scores for each member
      const allScores = [];
      for (const member of allScoresMembers) {
        const memberScore = await redisClient.zScore(redisKey, member);
        allScores.push({
          value: member,
          score: parseFloat(memberScore)
        });
      }
      
      // Get player's rank if playerId is provided
      let playerRank = null;
      let playerPercentile = null;
      let playerScore = null;
      
      if (playerId) {
        // Calculate reverse rank
        const rankFromStart = await redisClient.zRank(redisKey, playerId);
        playerRank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
        
        if (playerRank !== null) {
          playerRank += 1; // Convert to 1-indexed rank
          
          // Get player's score
          const scoreResult = await redisClient.zScore(redisKey, playerId);
          playerScore = scoreResult ? parseFloat(scoreResult) : null;
          
          // Calculate percentile
          const totalScores = allScores.length;
          playerPercentile = totalScores > 0 ? Math.round(((totalScores - playerRank + 1) / totalScores) * 100) : 100;
        }
      }
      
      // Get game states for the top 100 players
      const topPlayerIds = allScores.slice(0, 100).map(item => item.value);
      const gameStates = {};
      
      if (topPlayerIds.length > 0) {
        // Check if states key exists
        const statesKeyExists = await redisClient.exists(statesKey);
        
        if (statesKeyExists) {
          // Get all game states at once
          const statesData = await redisClient.hGetAll(statesKey);
          
          // Filter for only the top player IDs
          topPlayerIds.forEach(id => {
            if (statesData[id]) {
              try {
                gameStates[id] = JSON.parse(statesData[id]);
              } catch (parseError) {
                console.error(`Error parsing game state for player ${id}:`, parseError);
                gameStates[id] = null;
              }
            }
          });
        }
      }
      
      // Add player's game state if not in top 100
      if (playerId && !gameStates[playerId] && playerRank !== null) {
        const playerState = await redisClient.hGet(statesKey, playerId);
        if (playerState) {
          try {
            gameStates[playerId] = JSON.parse(playerState);
          } catch (parseError) {
            console.error(`Error parsing game state for player ${playerId}:`, parseError);
          }
        }
      }
      
      const response = {
        scores: allScores.map((item, index) => ({
          rank: index + 1,
          playerId: item.value,
          score: item.score,
          isCurrentPlayer: item.value === playerId,
          gameState: gameStates[item.value] || null
        })),
        playerInfo: playerId ? {
          rank: playerRank,
          percentile: playerPercentile,
          score: playerScore
        } : null,
        totalPlayers: allScores.length,
        date: today
      };
      res.status(200).json(response);
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
};

module.exports = { submitScore, getLeaderboard }; 