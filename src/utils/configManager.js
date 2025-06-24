/**
 * Configuration Manager
 * Handles environment variables and configuration validation
 */

const Logger = require('./logger');

class ConfigManager {
    constructor() {
        this.logger = new Logger('ConfigManager');
        this.config = this.loadConfig();
    }

    loadConfig() {
        return {
            // Solana Configuration
            SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
            SOLANA_WS_URL: process.env.SOLANA_WS_URL,
            SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'mainnet-beta',
            PRIVATE_KEY: process.env.PRIVATE_KEY,
            PROGRAM_ID: process.env.PROGRAM_ID,

            // Twitter Configuration
            TWITTER_API_KEY: process.env.TWITTER_API_KEY,
            TWITTER_API_SECRET: process.env.TWITTER_API_SECRET,
            TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
            TWITTER_ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,
            TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,

            // Risk Management
            MAX_TRADE_AMOUNT: parseFloat(process.env.MAX_TRADE_AMOUNT || '0.1'),
            MIN_LIQUIDITY: parseFloat(process.env.MIN_LIQUIDITY || '10'),
            MAX_SLIPPAGE: parseInt(process.env.MAX_SLIPPAGE || '5'),
            RISK_THRESHOLD: parseInt(process.env.RISK_THRESHOLD || '7'),
            COOLDOWN_PERIOD: parseInt(process.env.COOLDOWN_PERIOD || '300'),

            // Trading Configuration
            AUTO_TRADE_ENABLED: process.env.AUTO_TRADE_ENABLED === 'true',
            TEST_MODE: process.env.TEST_MODE === 'true',
            MAX_DAILY_TRADES: parseInt(process.env.MAX_DAILY_TRADES || '10'),

            // Database
            DATABASE_URL: process.env.DATABASE_URL,

            // Monitoring
            LOG_LEVEL: process.env.LOG_LEVEL || 'info',
            WEBHOOK_URL: process.env.WEBHOOK_URL,
            ENABLE_METRICS: process.env.ENABLE_METRICS === 'true',

            // Security
            WHITELIST_TOKENS: process.env.WHITELIST_TOKENS?.split(',') || [],
            BLACKLIST_ENABLED: process.env.BLACKLIST_ENABLED === 'true',
            EMERGENCY_STOP: process.env.EMERGENCY_STOP === 'true',

            // Additional Features
            STARTUP_NOTIFICATIONS: process.env.STARTUP_NOTIFICATIONS !== 'false',
            PORT: parseInt(process.env.PORT || '3000')
        };
    }

    async validateConfig() {
        this.logger.info('Validating configuration...');
        
        const errors = [];
        const warnings = [];

        // Required Solana configuration
        if (!this.config.SOLANA_RPC_URL) {
            errors.push('SOLANA_RPC_URL is required');
        }
        if (!this.config.SOLANA_WS_URL) {
            errors.push('SOLANA_WS_URL is required');
        }

        // Validate URLs
        if (this.config.SOLANA_RPC_URL && !this.isValidUrl(this.config.SOLANA_RPC_URL)) {
            errors.push('SOLANA_RPC_URL must be a valid HTTP/HTTPS URL');
        }
        if (this.config.SOLANA_WS_URL && !this.isValidWebSocketUrl(this.config.SOLANA_WS_URL)) {
            errors.push('SOLANA_WS_URL must be a valid WebSocket URL');
        }

        // Required Twitter configuration
        const twitterFields = [
            'TWITTER_API_KEY',
            'TWITTER_API_SECRET',
            'TWITTER_ACCESS_TOKEN',
            'TWITTER_ACCESS_TOKEN_SECRET'
        ];
        
        for (const field of twitterFields) {
            if (!this.config[field]) {
                errors.push(`${field} is required for Twitter functionality`);
            }
        }

        // Validate numeric ranges
        if (this.config.MAX_TRADE_AMOUNT <= 0 || this.config.MAX_TRADE_AMOUNT > 100) {
            errors.push('MAX_TRADE_AMOUNT must be between 0 and 100 SOL');
        }
        if (this.config.MIN_LIQUIDITY < 0) {
            errors.push('MIN_LIQUIDITY cannot be negative');
        }
        if (this.config.MAX_SLIPPAGE < 1 || this.config.MAX_SLIPPAGE > 50) {
            errors.push('MAX_SLIPPAGE must be between 1% and 50%');
        }
        if (this.config.RISK_THRESHOLD < 1 || this.config.RISK_THRESHOLD > 10) {
            errors.push('RISK_THRESHOLD must be between 1 and 10');
        }

        // Trading configuration warnings
        if (this.config.AUTO_TRADE_ENABLED && this.config.TEST_MODE) {
            warnings.push('AUTO_TRADE_ENABLED is true but TEST_MODE is also enabled');
        }
        if (this.config.AUTO_TRADE_ENABLED && !this.config.PRIVATE_KEY) {
            errors.push('PRIVATE_KEY is required when AUTO_TRADE_ENABLED is true');
        }
        if (this.config.AUTO_TRADE_ENABLED && !this.config.PROGRAM_ID) {
            errors.push('PROGRAM_ID is required when AUTO_TRADE_ENABLED is true');
        }

        // Security warnings
        if (this.config.MAX_TRADE_AMOUNT > 1 && !this.config.TEST_MODE) {
            warnings.push('MAX_TRADE_AMOUNT > 1 SOL on mainnet - ensure this is intentional');
        }
        if (!this.config.BLACKLIST_ENABLED) {
            warnings.push('Blacklist is disabled - this may increase risk exposure');
        }

        // Log results
        if (warnings.length > 0) {
            warnings.forEach(warning => this.logger.warn('CONFIG WARNING:', warning));
        }

        if (errors.length > 0) {
            errors.forEach(error => this.logger.error('CONFIG ERROR:', error));
            throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
        }

        this.logger.info(`✅ Configuration validation passed${warnings.length > 0 ? ` (${warnings.length} warnings)` : ''}`);
    }

    getConfig() {
        return { ...this.config };
    }

    getPublicConfig() {
        // Return config without sensitive information
        const publicConfig = { ...this.config };
        
        // Remove sensitive fields
        delete publicConfig.PRIVATE_KEY;
        delete publicConfig.TWITTER_API_KEY;
        delete publicConfig.TWITTER_API_SECRET;
        delete publicConfig.TWITTER_ACCESS_TOKEN;
        delete publicConfig.TWITTER_ACCESS_TOKEN_SECRET;
        delete publicConfig.TWITTER_BEARER_TOKEN;
        delete publicConfig.DATABASE_URL;
        
        return publicConfig;
    }

    async updateConfig(updates) {
        this.logger.info('Updating configuration...', { updates: Object.keys(updates) });
        
        // Validate updates
        const allowedUpdates = [
            'MAX_TRADE_AMOUNT',
            'MIN_LIQUIDITY',
            'MAX_SLIPPAGE',
            'RISK_THRESHOLD',
            'COOLDOWN_PERIOD',
            'AUTO_TRADE_ENABLED',
            'MAX_DAILY_TRADES',
            'BLACKLIST_ENABLED'
        ];
        
        for (const [key, value] of Object.entries(updates)) {
            if (!allowedUpdates.includes(key)) {
                throw new Error(`Configuration field '${key}' cannot be updated at runtime`);
            }
            
            // Type conversion and validation
            let parsedValue = value;
            if (['MAX_TRADE_AMOUNT', 'MIN_LIQUIDITY'].includes(key)) {
                parsedValue = parseFloat(value);
                if (isNaN(parsedValue) || parsedValue < 0) {
                    throw new Error(`${key} must be a positive number`);
                }
            } else if (['MAX_SLIPPAGE', 'RISK_THRESHOLD', 'COOLDOWN_PERIOD', 'MAX_DAILY_TRADES'].includes(key)) {
                parsedValue = parseInt(value);
                if (isNaN(parsedValue) || parsedValue < 0) {
                    throw new Error(`${key} must be a positive integer`);
                }
            } else if (['AUTO_TRADE_ENABLED', 'BLACKLIST_ENABLED'].includes(key)) {
                parsedValue = Boolean(value);
            }
            
            this.config[key] = parsedValue;
        }
        
        // Re-validate configuration
        await this.validateConfig();
        
        this.logger.info('Configuration updated successfully');
    }

    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    isValidWebSocketUrl(url) {
        try {
            const parsed = new URL(url);
            return ['ws:', 'wss:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    // Development helpers
    isDevelopment() {
        return process.env.NODE_ENV === 'development' || this.config.TEST_MODE;
    }

    isProduction() {
        return process.env.NODE_ENV === 'production' && !this.config.TEST_MODE;
    }

    shouldTrade() {
        return this.config.AUTO_TRADE_ENABLED && 
               !this.config.EMERGENCY_STOP && 
               !this.isDevelopment();
    }
}

module.exports = ConfigManager;