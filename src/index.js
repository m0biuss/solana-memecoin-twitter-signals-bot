/**
 * Solana Memecoin Twitter Signals Bot
 * Main entry point for the application
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const Logger = require('./utils/logger');
const PoolMonitor = require('./monitor/poolMonitor');
const TwitterBot = require('./twitter/twitterBot');
const RiskAnalyzer = require('./analysis/riskAnalyzer');
const TradingEngine = require('./trading/tradingEngine');
const ConfigManager = require('./utils/configManager');

class MemecoinTradingBot {
    constructor() {
        this.logger = new Logger('MemecoinTradingBot');
        this.app = express();
        this.setupExpress();
        
        // Initialize components
        this.config = new ConfigManager();
        this.poolMonitor = new PoolMonitor();
        this.twitterBot = new TwitterBot();
        this.riskAnalyzer = new RiskAnalyzer();
        this.tradingEngine = new TradingEngine();
        
        this.isRunning = false;
        this.stats = {
            poolsDetected: 0,
            tweetsPosted: 0,
            tradesExecuted: 0,
            lastActivity: null
        };
    }

    async initialize() {
        try {
            this.logger.info('Initializing Memecoin Trading Bot...');
            
            // Validate configuration
            await this.config.validateConfig();
            
            // Initialize components
            await this.poolMonitor.initialize();
            await this.twitterBot.initialize();
            await this.riskAnalyzer.initialize();
            await this.tradingEngine.initialize();
            
            // Set up event handlers
            this.setupEventHandlers();
            
            this.logger.info('Bot initialization completed successfully');
        } catch (error) {
            this.logger.error('Failed to initialize bot:', error);
            throw error;
        }
    }

    setupExpress() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(morgan('combined'));
        this.app.use(express.json());

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'running',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                stats: this.stats
            });
        });

        // Bot status endpoint
        this.app.get('/status', (req, res) => {
            res.json({
                isRunning: this.isRunning,
                config: this.config.getPublicConfig(),
                stats: this.stats,
                lastActivity: this.stats.lastActivity
            });
        });

        // Emergency stop endpoint
        this.app.post('/emergency-stop', async (req, res) => {
            try {
                await this.emergencyStop();
                res.json({ message: 'Emergency stop activated' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Configuration update endpoint
        this.app.post('/configure', async (req, res) => {
            try {
                await this.config.updateConfig(req.body);
                res.json({ message: 'Configuration updated' });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // Recent signals endpoint
        this.app.get('/signals', async (req, res) => {
            try {
                const signals = await this.getRecentSignals(req.query.limit || 10);
                res.json(signals);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    setupEventHandlers() {
        // Handle new pool detection
        this.poolMonitor.on('newPool', async (poolData) => {
            this.logger.info(`New pool detected: ${poolData.poolId}`);
            this.stats.poolsDetected++;
            this.stats.lastActivity = new Date();
            
            try {
                // Perform risk analysis
                const riskAnalysis = await this.riskAnalyzer.analyzePool(poolData);
                
                // Create signal data
                const signal = {
                    ...poolData,
                    ...riskAnalysis,
                    timestamp: new Date(),
                    processed: false
                };
                
                // Always post to Twitter (even if not trading)
                await this.postTwitterSignal(signal);
                
                // Execute trade if conditions are met
                if (this.shouldExecuteTrade(signal)) {
                    await this.tradingEngine.executeTrade(signal);
                    this.stats.tradesExecuted++;
                }
                
                signal.processed = true;
            } catch (error) {
                this.logger.error('Error processing new pool:', error);
            }
        });

        // Handle trading engine events
        this.tradingEngine.on('tradeExecuted', (tradeData) => {
            this.logger.info('Trade executed:', tradeData);
            // Post trade confirmation to Twitter if needed
        });

        this.tradingEngine.on('tradeError', (error) => {
            this.logger.error('Trade execution failed:', error);
        });

        // Handle process signals
        process.on('SIGINT', this.gracefulShutdown.bind(this));
        process.on('SIGTERM', this.gracefulShutdown.bind(this));
    }

    async postTwitterSignal(signal) {
        try {
            const tweetContent = this.formatTweet(signal);
            await this.twitterBot.postTweet(tweetContent);
            this.stats.tweetsPosted++;
            this.logger.info('Signal posted to Twitter');
        } catch (error) {
            this.logger.error('Failed to post Twitter signal:', error);
        }
    }

    formatTweet(signal) {
        const emoji = signal.riskScore >= 8 ? '🚀' : signal.riskScore >= 6 ? '🔍' : '⚠️';
        const riskLevel = signal.riskScore >= 8 ? 'HIGH' : signal.riskScore >= 6 ? 'MEDIUM' : 'LOW';
        
        return `${emoji} NEW MEMECOIN DETECTED ${emoji}\n\n` +
               `Token: ${signal.tokenSymbol || 'Unknown'}\n` +
               `Risk Score: ${signal.riskScore}/10 (${riskLevel})\n` +
               `Liquidity: ${(signal.liquidity / 1e9).toFixed(2)} SOL\n` +
               `Market Cap: $${signal.marketCap ? (signal.marketCap / 1000).toFixed(0) + 'k' : 'N/A'}\n\n` +
               `Pool: ${signal.poolId.slice(0, 8)}...\n` +
               `Contract: ${signal.tokenMint.slice(0, 8)}...\n\n` +
               `#Solana #Memecoin #DeFi #Raydium\n\n` +
               `⚠️ DYOR - High Risk Investment`;
    }

    shouldExecuteTrade(signal) {
        const config = this.config.getConfig();
        
        return (
            config.AUTO_TRADE_ENABLED &&
            !config.TEST_MODE &&
            signal.riskScore >= config.RISK_THRESHOLD &&
            signal.liquidity >= config.MIN_LIQUIDITY &&
            !signal.isScam &&
            !this.tradingEngine.isInCooldown()
        );
    }

    async start() {
        try {
            await this.initialize();
            
            // Start monitoring
            await this.poolMonitor.start();
            
            // Start express server
            const port = process.env.PORT || 3000;
            this.app.listen(port, () => {
                this.logger.info(`API server running on port ${port}`);
            });
            
            this.isRunning = true;
            this.logger.info('🚀 Memecoin Trading Bot started successfully!');
            
            // Post startup notification
            if (this.config.getConfig().STARTUP_NOTIFICATIONS) {
                await this.twitterBot.postTweet(
                    '🤖 Solana Memecoin Signal Bot is now LIVE!\n\n' +
                    'Monitoring Raydium for new memecoin deployments...\n\n' +
                    '#Solana #Memecoin #TradingBot'
                );
            }
            
        } catch (error) {
            this.logger.error('Failed to start bot:', error);
            process.exit(1);
        }
    }

    async emergencyStop() {
        this.logger.warn('🚨 EMERGENCY STOP ACTIVATED');
        
        try {
            // Stop trading immediately
            await this.tradingEngine.emergencyStop();
            
            // Post emergency notification
            await this.twitterBot.postTweet(
                '🚨 EMERGENCY STOP ACTIVATED\n\n' +
                'All trading has been halted for safety.\n\n' +
                'Bot will resume monitoring only.'
            );
            
            this.logger.info('Emergency stop completed');
        } catch (error) {
            this.logger.error('Error during emergency stop:', error);
        }
    }

    async getRecentSignals(limit = 10) {
        // This would typically query a database
        // For now, return mock data
        return {
            signals: [],
            total: 0,
            limit: limit
        };
    }

    async gracefulShutdown() {
        this.logger.info('Shutting down gracefully...');
        
        try {
            this.isRunning = false;
            
            // Stop monitoring
            await this.poolMonitor.stop();
            
            // Close trading positions if any
            await this.tradingEngine.shutdown();
            
            this.logger.info('Shutdown completed');
            process.exit(0);
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    }
}

// Start the bot if this is the main module
if (require.main === module) {
    const bot = new MemecoinTradingBot();
    bot.start().catch(console.error);
}

module.exports = MemecoinTradingBot;