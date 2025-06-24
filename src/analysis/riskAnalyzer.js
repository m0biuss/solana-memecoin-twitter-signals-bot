/**
 * Risk Analysis Engine
 * Analyzes memecoin pools for various risk factors and assigns scores
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { Metaplex } = require('@metaplex-foundation/js');
const axios = require('axios');
const Logger = require('../utils/logger');

class RiskAnalyzer {
    constructor() {
        this.logger = new Logger('RiskAnalyzer');
        this.connection = null;
        this.metaplex = null;
        
        // Risk scoring weights (total should equal 100)
        this.riskWeights = {
            liquidity: 25,      // Pool liquidity depth
            tokenSupply: 20,    // Token supply distribution
            contractSecurity: 20, // Contract verification/audit status
            socialSignals: 15,  // Social media presence
            marketTiming: 10,   // Market conditions
            teamCredibility: 10 // Developer/team background
        };
        
        // Blacklisted addresses (known scams, rugs, etc.)
        this.blacklist = new Set();
        
        // Cache for token metadata to avoid repeated fetches
        this.metadataCache = new Map();
        this.cacheTimeout = 300000; // 5 minutes
    }

    async initialize() {
        try {
            this.logger.info('Initializing Risk Analyzer...');
            
            // Initialize Solana connection
            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                throw new Error('Missing Solana RPC URL configuration');
            }
            
            this.connection = new Connection(rpcUrl, 'confirmed');
            
            // Initialize Metaplex for NFT/token metadata
            this.metaplex = Metaplex.make(this.connection);
            
            // Load blacklist
            await this.loadBlacklist();
            
            this.logger.info('✅ Risk Analyzer initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Risk Analyzer:', error);
            throw error;
        }
    }

    async analyzePool(poolData) {
        try {
            this.logger.info(`Analyzing pool: ${poolData.poolId}`);
            
            // Parallel risk analysis
            const [liquidityScore, supplyScore, securityScore, socialScore, timingScore, teamScore] = await Promise.allSettled([
                this.analyzeLiquidity(poolData),
                this.analyzeTokenSupply(poolData),
                this.analyzeContractSecurity(poolData),
                this.analyzeSocialSignals(poolData),
                this.analyzeMarketTiming(poolData),
                this.analyzeTeamCredibility(poolData)
            ]);
            
            // Extract values from settled promises
            const scores = {
                liquidity: liquidityScore.status === 'fulfilled' ? liquidityScore.value : 0,
                tokenSupply: supplyScore.status === 'fulfilled' ? supplyScore.value : 0,
                contractSecurity: securityScore.status === 'fulfilled' ? securityScore.value : 0,
                socialSignals: socialScore.status === 'fulfilled' ? socialScore.value : 0,
                marketTiming: timingScore.status === 'fulfilled' ? timingScore.value : 0,
                teamCredibility: teamScore.status === 'fulfilled' ? teamScore.value : 0
            };
            
            // Calculate weighted risk score
            const riskScore = this.calculateWeightedScore(scores);
            
            // Get token metadata
            const tokenMetadata = await this.getTokenMetadata(poolData.coinMint);
            
            // Identify risk factors
            const riskFactors = this.identifyRiskFactors(scores, poolData, tokenMetadata);
            
            // Check if token is blacklisted
            const isBlacklisted = this.isTokenBlacklisted(poolData.coinMint);
            
            const analysis = {
                riskScore: Math.round(riskScore),
                scores,
                tokenMetadata,
                riskFactors,
                isScam: isBlacklisted || riskScore < 3,
                marketCap: await this.estimateMarketCap(poolData),
                liquidity: await this.calculatePoolLiquidity(poolData),
                analysisTimestamp: new Date()
            };
            
            this.logger.info(`Analysis complete. Risk Score: ${analysis.riskScore}/10`);
            return analysis;
            
        } catch (error) {
            this.logger.error('Error analyzing pool:', error);
            return {
                riskScore: 0,
                scores: {},
                riskFactors: ['Analysis failed'],
                isScam: true,
                analysisTimestamp: new Date()
            };
        }
    }

    async analyzeLiquidity(poolData) {
        try {
            // Get pool account data to analyze liquidity
            const poolPubkey = new PublicKey(poolData.poolId);
            const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);
            
            if (!poolAccountInfo) {
                return 1; // Very low score if can't fetch pool data
            }
            
            // This is simplified - you'd need to parse the actual pool data
            // to get precise liquidity amounts
            const estimatedLiquidity = poolData.liquidity || 0;
            
            // Score based on SOL liquidity
            if (estimatedLiquidity >= 100e9) return 10;      // 100+ SOL
            if (estimatedLiquidity >= 50e9) return 8;        // 50+ SOL
            if (estimatedLiquidity >= 20e9) return 6;        // 20+ SOL
            if (estimatedLiquidity >= 10e9) return 4;        // 10+ SOL
            if (estimatedLiquidity >= 5e9) return 2;         // 5+ SOL
            
            return 1; // Less than 5 SOL
            
        } catch (error) {
            this.logger.error('Error analyzing liquidity:', error);
            return 1;
        }
    }

    async analyzeTokenSupply(poolData) {
        try {
            const mintPubkey = new PublicKey(poolData.coinMint);
            const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
            
            if (!mintInfo.value?.data?.parsed?.info) {
                return 1;
            }
            
            const supply = mintInfo.value.data.parsed.info.supply;
            const mintAuthority = mintInfo.value.data.parsed.info.mintAuthority;
            const freezeAuthority = mintInfo.value.data.parsed.info.freezeAuthority;
            
            let score = 5; // Base score
            
            // Check if mint authority is null (can't mint more tokens)
            if (!mintAuthority) {
                score += 3;
            } else {
                score -= 2; // Penalty for existing mint authority
            }
            
            // Check if freeze authority is null (can't freeze tokens)
            if (!freezeAuthority) {
                score += 2;
            } else {
                score -= 1; // Penalty for freeze authority
            }
            
            // Analyze supply distribution (simplified)
            // In a real implementation, you'd check top holder percentages
            const supplyStr = supply.toString();
            const hasReasonableSupply = supplyStr.length >= 9 && supplyStr.length <= 12;
            
            if (hasReasonableSupply) {
                score += 1;
            }
            
            return Math.max(1, Math.min(10, score));
            
        } catch (error) {
            this.logger.error('Error analyzing token supply:', error);
            return 1;
        }
    }

    async analyzeContractSecurity(poolData) {
        try {
            let score = 5; // Base score
            
            // Check if token is verified (has metadata)
            const metadata = await this.getTokenMetadata(poolData.coinMint);
            if (metadata?.symbol && metadata?.name) {
                score += 2;
            }
            
            // Check for common scam patterns in metadata
            if (metadata?.name) {
                const suspiciousWords = ['test', 'fake', 'scam', 'rug', 'moon', 'pump'];
                const hasSuspiciousWords = suspiciousWords.some(word => 
                    metadata.name.toLowerCase().includes(word)
                );
                
                if (hasSuspiciousWords) {
                    score -= 3;
                }
            }
            
            // Check token age (newer contracts are riskier)
            const tokenAge = Date.now() - (poolData.blockTime * 1000);
            const hoursAge = tokenAge / (1000 * 60 * 60);
            
            if (hoursAge < 1) score -= 2;      // Less than 1 hour old
            else if (hoursAge < 24) score -= 1; // Less than 1 day old
            else if (hoursAge > 168) score += 1; // More than 1 week old
            
            return Math.max(1, Math.min(10, score));
            
        } catch (error) {
            this.logger.error('Error analyzing contract security:', error);
            return 3;
        }
    }

    async analyzeSocialSignals(poolData) {
        // Simplified social analysis
        // In production, you'd integrate with Twitter API, Discord, Telegram, etc.
        try {
            let score = 5; // Base score
            
            const metadata = await this.getTokenMetadata(poolData.coinMint);
            
            // Check if token has website/social links in metadata
            if (metadata?.external_url) score += 1;
            if (metadata?.attributes?.some(attr => attr.trait_type === 'website')) score += 1;
            if (metadata?.attributes?.some(attr => attr.trait_type === 'twitter')) score += 2;
            
            // Could add more sophisticated social analysis here
            // - Twitter follower count
            // - Recent tweet activity
            // - Community engagement metrics
            
            return Math.max(1, Math.min(10, score));
            
        } catch (error) {
            this.logger.error('Error analyzing social signals:', error);
            return 3;
        }
    }

    async analyzeMarketTiming(poolData) {
        try {
            let score = 5; // Base score
            
            // Check time of day (some times are more favorable for launches)
            const hour = new Date().getUTCHours();
            
            // US trading hours typically better for visibility
            if ((hour >= 13 && hour <= 21)) { // 9 AM - 5 PM EST
                score += 2;
            } else if (hour >= 9 && hour <= 1) { // Extended hours
                score += 1;
            }
            
            // Check day of week
            const day = new Date().getDay();
            if (day >= 1 && day <= 5) { // Monday to Friday
                score += 1;
            }
            
            // Could add market condition analysis here
            // - Overall market sentiment
            // - SOL price movement
            // - Recent memecoin performance
            
            return Math.max(1, Math.min(10, score));
            
        } catch (error) {
            this.logger.error('Error analyzing market timing:', error);
            return 5;
        }
    }

    async analyzeTeamCredibility(poolData) {
        try {
            let score = 5; // Base score
            
            // Analyze deployer address
            const deployerPubkey = new PublicKey(poolData.deployer);
            
            // Check if deployer has history (account age, previous transactions)
            const deployerAccountInfo = await this.connection.getAccountInfo(deployerPubkey);
            
            if (deployerAccountInfo) {
                // If deployer account exists and has some SOL, add points
                const balance = deployerAccountInfo.lamports;
                if (balance > 1e9) score += 1; // More than 1 SOL
                if (balance > 10e9) score += 1; // More than 10 SOL
            }
            
            // Could add more sophisticated analysis:
            // - Check if deployer has deployed other successful tokens
            // - Analyze transaction patterns
            // - Cross-reference with known team wallets
            
            return Math.max(1, Math.min(10, score));
            
        } catch (error) {
            this.logger.error('Error analyzing team credibility:', error);
            return 3;
        }
    }

    calculateWeightedScore(scores) {
        let weightedSum = 0;
        let totalWeight = 0;
        
        for (const [category, weight] of Object.entries(this.riskWeights)) {
            if (scores[category] !== undefined) {
                weightedSum += scores[category] * weight;
                totalWeight += weight;
            }
        }
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    identifyRiskFactors(scores, poolData, metadata) {
        const factors = [];
        
        if (scores.liquidity < 4) factors.push('Low liquidity');
        if (scores.tokenSupply < 4) factors.push('Concerning token supply');
        if (scores.contractSecurity < 4) factors.push('Security concerns');
        if (scores.socialSignals < 4) factors.push('Limited social presence');
        if (scores.teamCredibility < 4) factors.push('Unknown team/deployer');
        
        // Additional risk factors
        if (!metadata?.name) factors.push('No token metadata');
        if (this.isTokenBlacklisted(poolData.coinMint)) factors.push('Blacklisted token');
        
        return factors;
    }

    async getTokenMetadata(mintAddress) {
        try {
            // Check cache first
            const cached = this.metadataCache.get(mintAddress);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
            
            const mintPubkey = new PublicKey(mintAddress);
            const nft = await this.metaplex.nfts().findByMint({ mintAddress: mintPubkey });
            
            const metadata = {
                symbol: nft.symbol,
                name: nft.name,
                description: nft.description,
                image: nft.image,
                external_url: nft.external_url,
                attributes: nft.attributes
            };
            
            // Cache the result
            this.metadataCache.set(mintAddress, {
                data: metadata,
                timestamp: Date.now()
            });
            
            return metadata;
            
        } catch (error) {
            this.logger.debug(`Could not fetch metadata for ${mintAddress}:`, error.message);
            return null;
        }
    }

    async calculatePoolLiquidity(poolData) {
        // Simplified liquidity calculation
        // In production, you'd parse the actual AMM pool data
        return poolData.liquidity || 0;
    }

    async estimateMarketCap(poolData) {
        try {
            // This is a simplified estimation
            // Real implementation would require parsing pool reserves
            const tokenSupply = await this.getTokenSupply(poolData.coinMint);
            const tokenPrice = await this.estimateTokenPrice(poolData);
            
            return tokenSupply * tokenPrice;
            
        } catch (error) {
            this.logger.error('Error estimating market cap:', error);
            return 0;
        }
    }

    async getTokenSupply(mintAddress) {
        try {
            const mintPubkey = new PublicKey(mintAddress);
            const supply = await this.connection.getTokenSupply(mintPubkey);
            return parseFloat(supply.value.amount) / Math.pow(10, supply.value.decimals);
        } catch (error) {
            return 0;
        }
    }

    async estimateTokenPrice(poolData) {
        // Simplified price estimation based on pool data
        // Real implementation would parse AMM pool reserves
        return 0.0001; // Placeholder
    }

    isTokenBlacklisted(mintAddress) {
        return this.blacklist.has(mintAddress);
    }

    async loadBlacklist() {
        try {
            // Load blacklist from environment or external source
            const blacklistTokens = process.env.BLACKLIST_TOKENS?.split(',') || [];
            blacklistTokens.forEach(token => this.blacklist.add(token.trim()));
            
            this.logger.info(`Loaded ${this.blacklist.size} blacklisted tokens`);
            
        } catch (error) {
            this.logger.error('Error loading blacklist:', error);
        }
    }

    getAnalysisStats() {
        return {
            metadataCacheSize: this.metadataCache.size,
            blacklistSize: this.blacklist.size,
            riskWeights: this.riskWeights
        };
    }
}

module.exports = RiskAnalyzer;