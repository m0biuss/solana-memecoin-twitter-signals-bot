/**
 * Real-time Raydium pool monitor
 * Detects new memecoin pool deployments using WebSocket connections
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const Logger = require('../utils/logger');

// Raydium Program IDs
const RAYDIUM_PROGRAM_IDS = {
    AMM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
    AMM_STABLE: new PublicKey('5quBtoiQqxF9Jv6KYKCtB59NT3gtJD2Y65kdnB1Uev3h'),
    CLMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
};

class PoolMonitor extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger('PoolMonitor');
        this.connection = null;
        this.subscriptions = new Map();
        this.isRunning = false;
        this.processedTransactions = new Set();
        
        // Rate limiting
        this.lastProcessTime = 0;
        this.minProcessInterval = 1000; // 1 second minimum between processing
    }

    async initialize() {
        try {
            // Initialize Solana connection
            const rpcUrl = process.env.SOLANA_RPC_URL;
            const wsUrl = process.env.SOLANA_WS_URL;
            
            if (!rpcUrl || !wsUrl) {
                throw new Error('Missing Solana RPC/WS URL configuration');
            }

            this.connection = new Connection(wsUrl, {
                commitment: 'confirmed',
                wsEndpoint: wsUrl
            });

            // Test connection
            const version = await this.connection.getVersion();
            this.logger.info(`Connected to Solana cluster: ${version['solana-core']}`);
            
        } catch (error) {
            this.logger.error('Failed to initialize pool monitor:', error);
            throw error;
        }
    }

    async start() {
        if (this.isRunning) {
            this.logger.warn('Pool monitor is already running');
            return;
        }

        try {
            this.logger.info('Starting Raydium pool monitoring...');
            
            // Subscribe to Raydium AMM V4 program logs
            await this.subscribeToProgram(
                RAYDIUM_PROGRAM_IDS.AMM_V4,
                'AMM_V4',
                this.handleAmmV4Log.bind(this)
            );

            // Subscribe to CLMM program logs (if monitoring concentrated liquidity)
            await this.subscribeToProgram(
                RAYDIUM_PROGRAM_IDS.CLMM,
                'CLMM',
                this.handleClmmLog.bind(this)
            );

            this.isRunning = true;
            this.logger.info('✅ Pool monitoring started successfully');
            
        } catch (error) {
            this.logger.error('Failed to start pool monitoring:', error);
            throw error;
        }
    }

    async subscribeToProgram(programId, name, handler) {
        try {
            const subscriptionId = this.connection.onLogs(
                programId,
                handler,
                'confirmed'
            );
            
            this.subscriptions.set(name, subscriptionId);
            this.logger.info(`Subscribed to ${name} program: ${programId.toString()}`);
            
        } catch (error) {
            this.logger.error(`Failed to subscribe to ${name} program:`, error);
            throw error;
        }
    }

    async handleAmmV4Log(logs, context) {
        try {
            // Check for pool initialization patterns
            const hasInitInstruction = logs.logs.some(log => 
                log.includes('InitializeInstruction2') ||
                log.includes('initialize2') ||
                log.includes('Program log: initialize2')
            );

            if (!hasInitInstruction) {
                return;
            }

            // Rate limiting check
            const now = Date.now();
            if (now - this.lastProcessTime < this.minProcessInterval) {
                return;
            }
            this.lastProcessTime = now;

            // Check if we've already processed this transaction
            const signature = logs.signature;
            if (this.processedTransactions.has(signature)) {
                return;
            }
            this.processedTransactions.add(signature);

            this.logger.info(`🆕 New AMM pool detected: ${signature}`);
            
            // Process the transaction to extract pool data
            const poolData = await this.extractPoolData(signature, 'AMM_V4');
            
            if (poolData && this.isMemecoinPool(poolData)) {
                this.emit('newPool', poolData);
            }
            
        } catch (error) {
            this.logger.error('Error handling AMM V4 log:', error);
        }
    }

    async handleClmmLog(logs, context) {
        try {
            // Check for CLMM pool creation patterns
            const hasCreateInstruction = logs.logs.some(log => 
                log.includes('CreatePool') ||
                log.includes('create_pool')
            );

            if (!hasCreateInstruction) {
                return;
            }

            const signature = logs.signature;
            if (this.processedTransactions.has(signature)) {
                return;
            }
            this.processedTransactions.add(signature);

            this.logger.info(`🆕 New CLMM pool detected: ${signature}`);
            
            const poolData = await this.extractPoolData(signature, 'CLMM');
            
            if (poolData && this.isMemecoinPool(poolData)) {
                this.emit('newPool', poolData);
            }
            
        } catch (error) {
            this.logger.error('Error handling CLMM log:', error);
        }
    }

    async extractPoolData(signature, poolType) {
        try {
            const transaction = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            if (!transaction || transaction.meta?.err) {
                this.logger.warn(`Failed to fetch transaction or transaction failed: ${signature}`);
                return null;
            }

            const message = transaction.transaction.message;
            const accounts = message.staticAccountKeys.map(key => key.toString());
            const instructions = message.instructions;

            // Find the relevant instruction
            for (const instruction of instructions) {
                const programId = accounts[instruction.programIdIndex];
                
                if (poolType === 'AMM_V4' && programId === RAYDIUM_PROGRAM_IDS.AMM_V4.toString()) {
                    return this.parseAmmV4Instruction(instruction, accounts, transaction);
                } else if (poolType === 'CLMM' && programId === RAYDIUM_PROGRAM_IDS.CLMM.toString()) {
                    return this.parseClmmInstruction(instruction, accounts, transaction);
                }
            }

            return null;
            
        } catch (error) {
            this.logger.error(`Error extracting pool data from ${signature}:`, error);
            return null;
        }
    }

    parseAmmV4Instruction(instruction, accounts, transaction) {
        try {
            // AMM V4 account layout for initialize2 instruction
            const accountIndexes = instruction.accounts;
            
            if (accountIndexes.length < 18) {
                return null;
            }

            const poolData = {
                type: 'AMM_V4',
                signature: transaction.transaction.signatures[0],
                blockTime: transaction.blockTime,
                slot: transaction.slot,
                poolId: accounts[accountIndexes[4]],
                ammAuthority: accounts[accountIndexes[5]],
                ammOpenOrders: accounts[accountIndexes[6]],
                lpMint: accounts[accountIndexes[7]],
                coinMint: accounts[accountIndexes[8]],
                pcMint: accounts[accountIndexes[9]],
                coinVault: accounts[accountIndexes[10]],
                pcVault: accounts[accountIndexes[11]],
                serumMarket: accounts[accountIndexes[16]],
                deployer: accounts[accountIndexes[17]],
                timestamp: new Date(transaction.blockTime * 1000)
            };

            return poolData;
            
        } catch (error) {
            this.logger.error('Error parsing AMM V4 instruction:', error);
            return null;
        }
    }

    parseClmmInstruction(instruction, accounts, transaction) {
        try {
            // CLMM account layout for create_pool instruction
            const accountIndexes = instruction.accounts;
            
            const poolData = {
                type: 'CLMM',
                signature: transaction.transaction.signatures[0],
                blockTime: transaction.blockTime,
                slot: transaction.slot,
                poolId: accounts[accountIndexes[0]], // This may vary based on CLMM structure
                // Additional CLMM-specific fields would go here
                timestamp: new Date(transaction.blockTime * 1000)
            };

            return poolData;
            
        } catch (error) {
            this.logger.error('Error parsing CLMM instruction:', error);
            return null;
        }
    }

    isMemecoinPool(poolData) {
        try {
            // Basic memecoin detection logic
            // You can enhance this with more sophisticated checks
            
            // Skip if it's a major token pair (USDC, USDT, etc.)
            const stablecoinMints = [
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
                '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH
                '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // BTC
            ];

            if (stablecoinMints.includes(poolData.coinMint) || 
                stablecoinMints.includes(poolData.pcMint)) {
                return false;
            }

            // Additional memecoin detection logic could include:
            // - Check token metadata
            // - Analyze liquidity amounts
            // - Check for specific patterns
            
            return true;
            
        } catch (error) {
            this.logger.error('Error checking if memecoin pool:', error);
            return false;
        }
    }

    async stop() {
        this.logger.info('Stopping pool monitor...');
        
        try {
            // Unsubscribe from all program logs
            for (const [name, subscriptionId] of this.subscriptions) {
                await this.connection.removeOnLogsListener(subscriptionId);
                this.logger.info(`Unsubscribed from ${name}`);
            }
            
            this.subscriptions.clear();
            this.isRunning = false;
            
            // Clean up processed transactions cache (keep recent ones)
            if (this.processedTransactions.size > 1000) {
                this.processedTransactions.clear();
            }
            
            this.logger.info('Pool monitor stopped');
            
        } catch (error) {
            this.logger.error('Error stopping pool monitor:', error);
        }
    }

    getMonitoringStats() {
        return {
            isRunning: this.isRunning,
            activeSubscriptions: this.subscriptions.size,
            processedTransactions: this.processedTransactions.size,
            lastProcessTime: this.lastProcessTime
        };
    }
}

module.exports = PoolMonitor;