/**
 * Twitter Bot for posting memecoin signals
 * Uses Twitter API v2 for posting tweets and managing interactions
 */

const { TwitterApi } = require('twitter-api-v2');
const EventEmitter = require('events');
const Logger = require('../utils/logger');

class TwitterBot extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger('TwitterBot');
        this.client = null;
        this.isInitialized = false;
        this.tweetQueue = [];
        this.isProcessingQueue = false;
        this.rateLimits = {
            tweets: {
                remaining: 300, // Default Twitter limit
                resetTime: null
            }
        };
        
        // Rate limiting settings
        this.tweetInterval = 60000; // 1 minute between tweets
        this.lastTweetTime = 0;
    }

    async initialize() {
        try {
            this.logger.info('Initializing Twitter Bot...');
            
            // Validate required environment variables
            const requiredVars = [
                'TWITTER_API_KEY',
                'TWITTER_API_SECRET',
                'TWITTER_ACCESS_TOKEN',
                'TWITTER_ACCESS_TOKEN_SECRET'
            ];
            
            for (const varName of requiredVars) {
                if (!process.env[varName]) {
                    throw new Error(`Missing required environment variable: ${varName}`);
                }
            }
            
            // Initialize Twitter client
            this.client = new TwitterApi({
                appKey: process.env.TWITTER_API_KEY,
                appSecret: process.env.TWITTER_API_SECRET,
                accessToken: process.env.TWITTER_ACCESS_TOKEN,
                accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
            });
            
            // Test authentication
            const user = await this.client.currentUser();
            this.logger.info(`Authenticated as: @${user.screen_name} (${user.name})`);
            
            this.isInitialized = true;
            
            // Start processing tweet queue
            this.processQueuePeriodically();
            
            this.logger.info('✅ Twitter Bot initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Twitter Bot:', error);
            throw error;
        }
    }

    async postTweet(content, options = {}) {
        if (!this.isInitialized) {
            throw new Error('Twitter Bot not initialized');
        }

        try {
            // Check rate limits
            if (!this.canTweet()) {
                this.logger.warn('Rate limit exceeded, queuing tweet');
                this.queueTweet(content, options);
                return null;
            }

            // Check minimum interval between tweets
            const now = Date.now();
            const timeSinceLastTweet = now - this.lastTweetTime;
            if (timeSinceLastTweet < this.tweetInterval) {
                const waitTime = this.tweetInterval - timeSinceLastTweet;
                this.logger.info(`Waiting ${waitTime}ms before posting tweet`);
                setTimeout(() => this.postTweet(content, options), waitTime);
                return null;
            }

            // Validate tweet length
            if (content.length > 280) {
                this.logger.warn('Tweet too long, truncating...');
                content = content.substring(0, 277) + '...';
            }

            // Post tweet
            const tweet = await this.client.v2.tweet({
                text: content,
                ...options
            });

            this.lastTweetTime = now;
            this.updateRateLimits();

            this.logger.info(`Tweet posted successfully: ${tweet.data.id}`);
            this.emit('tweetPosted', {
                tweetId: tweet.data.id,
                content: content,
                timestamp: new Date()
            });

            return tweet;

        } catch (error) {
            this.logger.error('Failed to post tweet:', error);
            
            // Handle specific Twitter API errors
            if (error.code === 429) {
                this.logger.warn('Rate limit hit, queuing tweet');
                this.queueTweet(content, options);
            } else if (error.code === 187) {
                this.logger.warn('Duplicate tweet detected, skipping');
            }
            
            this.emit('tweetError', error);
            throw error;
        }
    }

    async postThread(tweets, options = {}) {
        if (!Array.isArray(tweets) || tweets.length === 0) {
            throw new Error('Tweets must be a non-empty array');
        }

        try {
            let previousTweetId = null;
            const threadResults = [];

            for (let i = 0; i < tweets.length; i++) {
                const tweetOptions = {
                    ...options,
                    ...(previousTweetId && { reply: { in_reply_to_tweet_id: previousTweetId } })
                };

                const tweet = await this.postTweet(tweets[i], tweetOptions);
                if (tweet) {
                    previousTweetId = tweet.data.id;
                    threadResults.push(tweet);
                }

                // Wait between thread tweets
                if (i < tweets.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            this.logger.info(`Thread posted successfully with ${threadResults.length} tweets`);
            return threadResults;

        } catch (error) {
            this.logger.error('Failed to post thread:', error);
            throw error;
        }
    }

    queueTweet(content, options = {}) {
        this.tweetQueue.push({
            content,
            options,
            timestamp: new Date(),
            retries: 0
        });
        
        this.logger.info(`Tweet queued. Queue size: ${this.tweetQueue.length}`);
    }

    async processQueuePeriodically() {
        if (this.isProcessingQueue) return;
        
        this.isProcessingQueue = true;
        
        while (this.tweetQueue.length > 0 && this.canTweet()) {
            const queuedTweet = this.tweetQueue.shift();
            
            try {
                await this.postTweet(queuedTweet.content, queuedTweet.options);
                await new Promise(resolve => setTimeout(resolve, this.tweetInterval));
            } catch (error) {
                queuedTweet.retries++;
                
                if (queuedTweet.retries < 3) {
                    this.tweetQueue.unshift(queuedTweet); // Put back at front
                } else {
                    this.logger.error('Max retries reached for queued tweet');
                }
            }
        }
        
        this.isProcessingQueue = false;
        
        // Schedule next processing
        setTimeout(() => this.processQueuePeriodically(), 60000); // Check every minute
    }

    canTweet() {
        const now = Date.now();
        
        // Check if rate limit window has reset
        if (this.rateLimits.tweets.resetTime && now > this.rateLimits.tweets.resetTime) {
            this.rateLimits.tweets.remaining = 300; // Reset to default
            this.rateLimits.tweets.resetTime = null;
        }
        
        return this.rateLimits.tweets.remaining > 0;
    }

    updateRateLimits() {
        this.rateLimits.tweets.remaining--;
        
        if (!this.rateLimits.tweets.resetTime) {
            // Set reset time to 15 minutes from now (Twitter's rate limit window)
            this.rateLimits.tweets.resetTime = Date.now() + (15 * 60 * 1000);
        }
    }

    async getAccountInfo() {
        if (!this.isInitialized) {
            throw new Error('Twitter Bot not initialized');
        }
        
        try {
            const user = await this.client.currentUser();
            return {
                username: user.screen_name,
                name: user.name,
                followers: user.followers_count,
                following: user.friends_count,
                tweets: user.statuses_count
            };
        } catch (error) {
            this.logger.error('Failed to get account info:', error);
            throw error;
        }
    }

    async searchRecentTweets(query, maxResults = 10) {
        try {
            const tweets = await this.client.v2.search(query, {
                max_results: maxResults,
                'tweet.fields': ['created_at', 'author_id', 'public_metrics']
            });
            
            return tweets.data || [];
        } catch (error) {
            this.logger.error('Failed to search tweets:', error);
            throw error;
        }
    }

    formatSignalTweet(poolData, riskAnalysis) {
        const emoji = riskAnalysis.riskScore >= 8 ? '🚀' : 
                     riskAnalysis.riskScore >= 6 ? '🔍' : '⚠️';
        
        const riskLevel = riskAnalysis.riskScore >= 8 ? 'HIGH' : 
                         riskAnalysis.riskScore >= 6 ? 'MEDIUM' : 'LOW';
        
        let tweet = `${emoji} NEW MEMECOIN ALERT ${emoji}\n\n`;
        
        if (riskAnalysis.tokenMetadata?.symbol) {
            tweet += `$${riskAnalysis.tokenMetadata.symbol} `;
        }
        
        if (riskAnalysis.tokenMetadata?.name) {
            tweet += `(${riskAnalysis.tokenMetadata.name})\n`;
        }
        
        tweet += `\n📊 Risk Score: ${riskAnalysis.riskScore}/10 (${riskLevel})\n`;
        tweet += `💧 Liquidity: ${(poolData.liquidity / 1e9).toFixed(2)} SOL\n`;
        
        if (riskAnalysis.marketCap) {
            tweet += `🏷️ Market Cap: $${(riskAnalysis.marketCap / 1000).toFixed(0)}k\n`;
        }
        
        tweet += `\n🏊 Pool: ${poolData.poolId.slice(0, 8)}...${poolData.poolId.slice(-4)}\n`;
        tweet += `📄 Contract: ${poolData.coinMint.slice(0, 8)}...${poolData.coinMint.slice(-4)}\n\n`;
        
        // Add warning indicators
        if (riskAnalysis.riskFactors?.length > 0) {
            tweet += `⚠️ Risk Factors:\n`;
            riskAnalysis.riskFactors.slice(0, 2).forEach(factor => {
                tweet += `• ${factor}\n`;
            });
            tweet += `\n`;
        }
        
        tweet += `#Solana #Memecoin #DeFi #Raydium\n\n`;
        tweet += `⚠️ DYOR - High Risk Investment`;
        
        // Ensure tweet doesn't exceed 280 characters
        if (tweet.length > 280) {
            tweet = tweet.substring(0, 277) + '...';
        }
        
        return tweet;
    }

    getStats() {
        return {
            isInitialized: this.isInitialized,
            queueSize: this.tweetQueue.length,
            rateLimits: this.rateLimits,
            lastTweetTime: this.lastTweetTime,
            isProcessingQueue: this.isProcessingQueue
        };
    }

    async shutdown() {
        this.logger.info('Shutting down Twitter Bot...');
        
        // Process remaining queued tweets with retries
        if (this.tweetQueue.length > 0) {
            this.logger.info(`Processing ${this.tweetQueue.length} remaining tweets`);
            await this.processQueuePeriodically();
        }
        
        this.isInitialized = false;
        this.logger.info('Twitter Bot shutdown complete');
    }
}

module.exports = TwitterBot;