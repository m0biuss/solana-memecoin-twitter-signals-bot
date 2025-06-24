/**
 * Trading Engine
 * Handles automated trade execution through the Solana smart contract
 */

const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@project-serum/anchor');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const EventEmitter = require('events');
const bs58 = require('bs58');
const Logger = require('../utils/logger');

class TradingEngine extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger('TradingEngine');
        this.connection = null;
        this.wallet = null;
        this.program = null;
        this.isInitialized = false;
        
        // Trading state
        this.lastTradeTime = 0;
        this.dailyTrades = 0;
        this.dailyTradeCount = new Map(); // Track daily trades by date
        this.cooldownPeriod = 300000; // 5 minutes default
        this.isPaused = false;
        
        // Statistics
        this.stats = {
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0,
            totalVolume: 0
        };
    }

    async initialize() {
        try {
            this.logger.info('Initializing Trading Engine...');
            
            // Validate configuration
            if (!process.env.SOLANA_RPC_URL) {
                throw new Error('Missing Solana RPC URL');
            }
            if (!process.env.PRIVATE_KEY && process.env.AUTO_TRADE_ENABLED === 'true') {
                throw new Error('Private key required for trading');
            }
            if (!process.env.PROGRAM_ID && process.env.AUTO_TRADE_ENABLED === 'true') {
                throw new Error('Program ID required for trading');
            }
            
            // Initialize Solana connection
            this.connection = new Connection(
                process.env.SOLANA_RPC_URL,
                { commitment: 'confirmed' }
            );
            
            // Initialize wallet if trading is enabled
            if (process.env.AUTO_TRADE_ENABLED === 'true') {
                const secretKey = bs58.decode(process.env.PRIVATE_KEY);
                const keypair = Keypair.fromSecretKey(secretKey);
                this.wallet = new Wallet(keypair);
                
                this.logger.info(`Trading wallet: ${this.wallet.publicKey.toString()}`);
                
                // Check wallet balance
                const balance = await this.connection.getBalance(this.wallet.publicKey);
                this.logger.info(`Wallet balance: ${(balance / 1e9).toFixed(4)} SOL`);
                
                if (balance < 0.01e9) { // Less than 0.01 SOL
                    this.logger.warn('Low wallet balance - may not be sufficient for trading');
                }
                
                // Initialize Anchor program
                await this.initializeProgram();
            }
            
            // Load configuration
            this.cooldownPeriod = (parseInt(process.env.COOLDOWN_PERIOD) || 300) * 1000;
            
            this.isInitialized = true;
            this.logger.info('✅ Trading Engine initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Trading Engine:', error);
            throw error;
        }
    }

    async initializeProgram() {
        try {
            // This would initialize your Anchor program
            // You'd need to load the IDL and create the program instance
            this.logger.info('Initializing Anchor program...');
            
            const programId = new PublicKey(process.env.PROGRAM_ID);
            const provider = new AnchorProvider(
                this.connection,
                this.wallet,
                { commitment: 'confirmed' }
            );
            
            // In a real implementation, you'd load your program IDL here
            // this.program = new Program(idl, programId, provider);
            
            this.logger.info(`Program ID: ${programId.toString()}`);
            
        } catch (error) {
            this.logger.error('Failed to initialize program:', error);
            throw error;
        }
    }

    async executeTrade(signal) {
        if (!this.isInitialized) {
            throw new Error('Trading Engine not initialized');
        }
        
        if (!process.env.AUTO_TRADE_ENABLED || process.env.AUTO_TRADE_ENABLED !== 'true') {
            this.logger.info('Auto trading disabled, skipping trade execution');
            return;
        }
        
        if (this.isPaused) {
            this.logger.warn('Trading is paused, skipping trade');
            return;
        }
        
        try {
            this.logger.info('Executing trade...', {
                pool: signal.poolId,
                token: signal.coinMint,
                riskScore: signal.riskScore
            });
            
            // Pre-trade validation
            await this.validateTrade(signal);
            
            // Calculate trade parameters
            const tradeParams = await this.calculateTradeParameters(signal);
            
            // Execute the trade
            const result = await this.performTrade(tradeParams);
            
            // Update statistics
            this.updateTradeStats(result);
            
            // Emit success event
            this.emit('tradeExecuted', {
                signal,
                result,
                timestamp: new Date()
            });
            
            this.logger.info('Trade executed successfully', result);
            return result;
            
        } catch (error) {
            this.handleTradeError(error, signal);
            throw error;
        }
    }

    async validateTrade(signal) {
        // Check cooldown period
        if (this.isInCooldown()) {
            throw new Error('Trading is in cooldown period');
        }
        
        // Check daily trade limits
        if (this.hasExceededDailyLimit()) {
            throw new Error('Daily trade limit exceeded');
        }
        
        // Validate signal data
        if (!signal.poolId || !signal.coinMint) {
            throw new Error('Invalid signal data');
        }
        
        // Check risk score
        const minRiskScore = parseInt(process.env.RISK_THRESHOLD) || 7;
        if (signal.riskScore < minRiskScore) {
            throw new Error(`Risk score too low: ${signal.riskScore} < ${minRiskScore}`);
        }
        
        // Check liquidity
        const minLiquidity = parseFloat(process.env.MIN_LIQUIDITY) * 1e9 || 10e9;
        if (signal.liquidity < minLiquidity) {
            throw new Error(`Insufficient liquidity: ${signal.liquidity} < ${minLiquidity}`);
        }
        
        // Check if token is blacklisted
        if (signal.isScam) {
            throw new Error('Token is flagged as scam or blacklisted');
        }
        
        this.logger.info('Trade validation passed');
    }

    async calculateTradeParameters(signal) {
        const maxTradeAmount = parseFloat(process.env.MAX_TRADE_AMOUNT) * 1e9 || 0.1e9; // SOL in lamports
        const maxSlippage = parseInt(process.env.MAX_SLIPPAGE) || 5;
        
        // Calculate actual trade amount based on signal strength and available balance
        const walletBalance = await this.connection.getBalance(this.wallet.publicKey);
        const reserveAmount = 0.01e9; // Keep 0.01 SOL for fees
        const availableBalance = Math.max(0, walletBalance - reserveAmount);
        
        const tradeAmount = Math.min(
            maxTradeAmount,
            availableBalance * 0.9, // Use max 90% of available balance
            signal.liquidity * 0.05 // Max 5% of pool liquidity
        );
        
        if (tradeAmount < 0.001e9) { // Less than 0.001 SOL
            throw new Error('Insufficient balance for trade');
        }
        
        return {
            poolId: new PublicKey(signal.poolId),
            tokenMint: new PublicKey(signal.coinMint),
            amountIn: new BN(Math.floor(tradeAmount)),
            maxSlippage: maxSlippage,
            deadline: Math.floor(Date.now() / 1000) + 300 // 5 minute deadline
        };
    }

    async performTrade(params) {
        this.logger.info('Performing trade with parameters:', {
            poolId: params.poolId.toString(),
            tokenMint: params.tokenMint.toString(),
            amountIn: params.amountIn.toString(),
            maxSlippage: params.maxSlippage
        });
        
        try {
            // Get or create associated token accounts
            const sourceTokenAccount = await this.getOrCreateTokenAccount(
                this.wallet.publicKey,
                new PublicKey('So11111111111111111111111111111111111111112') // WSOL mint
            );
            
            const destinationTokenAccount = await this.getOrCreateTokenAccount(
                this.wallet.publicKey,
                params.tokenMint
            );
            
            // Create swap instruction (this is simplified)
            // In reality, you'd need to construct the proper Raydium swap instruction
            const instruction = await this.createSwapInstruction(
                params,
                sourceTokenAccount,
                destinationTokenAccount
            );
            
            // Create and send transaction
            const transaction = new Transaction().add(instruction);
            const signature = await this.connection.sendTransaction(
                transaction,
                [this.wallet.payer],
                { commitment: 'confirmed' }
            );
            
            // Confirm transaction
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            
            this.updateCooldown();
            
            return {
                signature,
                amountIn: params.amountIn.toString(),
                tokenMint: params.tokenMint.toString(),
                success: true
            };
            
        } catch (error) {
            this.logger.error('Trade execution failed:', error);
            throw error;
        }
    }

    async createSwapInstruction(params, sourceAccount, destinationAccount) {
        // This is a placeholder for the actual Raydium swap instruction
        // You would need to implement the actual instruction creation based on Raydium's SDK
        this.logger.warn('Swap instruction creation not fully implemented - using placeholder');
        
        // Return a placeholder instruction
        // In reality, this would be a complex instruction that interacts with Raydium
        return null;
    }

    async getOrCreateTokenAccount(owner, mint) {
        try {
            const associatedTokenAddress = await getAssociatedTokenAddress(
                mint,
                owner,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
            
            // Check if account exists
            const accountInfo = await this.connection.getAccountInfo(associatedTokenAddress);
            
            if (!accountInfo) {
                // Account doesn't exist, it will be created in the transaction
                this.logger.info(`Token account will be created: ${associatedTokenAddress.toString()}`);
            }
            
            return associatedTokenAddress;
            
        } catch (error) {
            this.logger.error('Error getting/creating token account:', error);
            throw error;
        }
    }

    isInCooldown() {
        const now = Date.now();
        const timeSinceLastTrade = now - this.lastTradeTime;
        return timeSinceLastTrade < this.cooldownPeriod;
    }

    getCooldownRemaining() {
        if (!this.isInCooldown()) return 0;
        const now = Date.now();
        return Math.max(0, this.cooldownPeriod - (now - this.lastTradeTime));
    }

    hasExceededDailyLimit() {
        const today = new Date().toDateString();
        const todayTrades = this.dailyTradeCount.get(today) || 0;
        const maxDailyTrades = parseInt(process.env.MAX_DAILY_TRADES) || 10;
        return todayTrades >= maxDailyTrades;
    }

    updateCooldown() {
        this.lastTradeTime = Date.now();
        
        // Update daily trade count
        const today = new Date().toDateString();
        const currentCount = this.dailyTradeCount.get(today) || 0;
        this.dailyTradeCount.set(today, currentCount + 1);
        
        // Clean up old dates
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        for (const [date, count] of this.dailyTradeCount.entries()) {
            if (new Date(date) < yesterday) {
                this.dailyTradeCount.delete(date);
            }
        }
    }

    updateTradeStats(result) {
        this.stats.totalTrades++;
        
        if (result.success) {
            this.stats.successfulTrades++;
            if (result.amountIn) {
                this.stats.totalVolume += parseFloat(result.amountIn);
            }
        } else {
            this.stats.failedTrades++;
        }
        
        this.logger.info('Updated trade statistics:', this.stats);
    }

    handleTradeError(error, signal) {
        this.stats.failedTrades++;
        
        this.emit('tradeError', {
            error: error.message,
            signal,
            timestamp: new Date()
        });
        
        this.logger.error('Trade execution failed:', error, {
            poolId: signal.poolId,
            tokenMint: signal.coinMint
        });
    }

    async emergencyStop() {
        this.logger.warn('🚨 EMERGENCY STOP - Halting all trading activity');
        
        this.isPaused = true;
        
        // Cancel any pending transactions if possible
        // In a real implementation, you'd want to cancel pending orders
        
        this.emit('emergencyStop', {
            timestamp: new Date(),
            reason: 'Manual emergency stop'
        });
    }

    resumeTrading() {
        this.logger.info('Resuming trading operations');
        this.isPaused = false;
        
        this.emit('tradingResumed', {
            timestamp: new Date()
        });
    }

    getStats() {
        const today = new Date().toDateString();
        const todayTrades = this.dailyTradeCount.get(today) || 0;
        
        return {
            ...this.stats,
            dailyTrades: todayTrades,
            isInCooldown: this.isInCooldown(),
            cooldownRemaining: this.getCooldownRemaining(),
            isPaused: this.isPaused,
            successRate: this.stats.totalTrades > 0 
                ? (this.stats.successfulTrades / this.stats.totalTrades * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    async shutdown() {
        this.logger.info('Shutting down Trading Engine...');
        
        // Stop any active trading
        this.isPaused = true;
        
        // Wait for any pending operations to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        this.isInitialized = false;
        this.logger.info('Trading Engine shutdown complete');
    }
}

module.exports = TradingEngine;