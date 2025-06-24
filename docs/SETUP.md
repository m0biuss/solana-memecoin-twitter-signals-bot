# Setup Guide

This guide will walk you through setting up the Solana Memecoin Twitter Signals Bot from scratch.

## Prerequisites

### Required Software

1. **Node.js 18+**
   ```bash
   # Check version
   node --version
   
   # Install via nvm (recommended)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 18
   nvm use 18
   ```

2. **Rust & Cargo**
   ```bash
   # Install Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   
   # Verify installation
   rustc --version
   cargo --version
   ```

3. **Solana CLI**
   ```bash
   # Install Solana CLI
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   
   # Add to PATH
   export PATH="~/.local/share/solana/install/active_release/bin:$PATH"
   
   # Verify installation
   solana --version
   ```

4. **Anchor CLI**
   ```bash
   # Install Anchor
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   
   # Verify installation
   anchor --version
   ```

### Required Accounts

1. **Solana Wallet**
   ```bash
   # Generate a new keypair
   solana-keygen new --outfile ~/.config/solana/id.json
   
   # Set as default
   solana config set --keypair ~/.config/solana/id.json
   
   # Get public key
   solana address
   ```

2. **Twitter Developer Account**
   - Sign up at [developer.twitter.com](https://developer.twitter.com)
   - Create a new app
   - Generate API keys and access tokens
   - Enable OAuth 1.0a with read/write permissions

3. **Solana RPC Provider** (Choose one)
   - [Alchemy](https://alchemy.com) (Recommended)
   - [QuickNode](https://quicknode.com)
   - [Helius](https://helius.xyz)

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/m0biuss/solana-memecoin-twitter-signals-bot.git
cd solana-memecoin-twitter-signals-bot
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Rust dependencies (for smart contract)
cd programs/trading-bot
cargo build-bpf
cd ../..
```

### 3. Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env  # or use your preferred editor
```

### 4. Configure Environment Variables

Edit `.env` with your actual credentials:

```env
# Solana Configuration
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SOLANA_NETWORK=mainnet-beta
PRIVATE_KEY=your_base58_encoded_private_key

# Twitter API v2
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# Trading Configuration (Start Conservative)
MAX_TRADE_AMOUNT=0.01    # Start with 0.01 SOL
MIN_LiquidITY=10         # Minimum 10 SOL pool liquidity
MAX_SLIPPAGE=5           # 5% max slippage
RISK_THRESHOLD=8         # High risk threshold (8/10)
AUTO_TRADE_ENABLED=false # Disable auto-trading initially
TEST_MODE=true           # Enable test mode
```

## Smart Contract Deployment

### 1. Development/Testing (Devnet)

```bash
# Configure for devnet
solana config set --url devnet

# Airdrop some SOL for testing
solana airdrop 2

# Build and deploy the smart contract
anchor build
anchor deploy --provider.cluster devnet

# Note the deployed program ID
echo "Copy the program ID to your .env file as PROGRAM_ID"
```

### 2. Production (Mainnet)

```bash
# Configure for mainnet
solana config set --url mainnet-beta

# Ensure you have enough SOL for deployment (~2-3 SOL)
solana balance

# Build and deploy
anchor build
anchor deploy --provider.cluster mainnet

# Update PROGRAM_ID in .env
# Set SOLANA_NETWORK=mainnet-beta in .env
```

### 3. Initialize Smart Contract

```bash
# Run initialization script (you'll need to create this)
node scripts/initialize-contract.js
```

## Testing

### 1. Test Configuration

```bash
# Validate environment setup
npm run test:config

# Test Solana connection
npm run test:solana

# Test Twitter connection
npm run test:twitter
```

### 2. Test Pool Monitoring

```bash
# Start in test mode
export TEST_MODE=true
export AUTO_TRADE_ENABLED=false
npm run start

# In another terminal, check logs
tail -f logs/combined.log
```

### 3. Test Trading (Devnet Only)

```bash
# Configure for devnet testing
export SOLANA_NETWORK=devnet
export TEST_MODE=true
export AUTO_TRADE_ENABLED=true
export MAX_TRADE_AMOUNT=0.001  # Very small amount

# Start the bot
npm run start
```

## Production Deployment

### 1. Server Setup

```bash
# Install PM2 for process management
npm install -g pm2

# Create PM2 configuration
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'memecoin-bot',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
EOF
```

### 2. Security Setup

```bash
# Set proper file permissions
chmod 600 .env
chmod 700 logs/

# Create dedicated user (optional but recommended)
sudo useradd -r -s /bin/false memecoin-bot
sudo chown -R memecoin-bot:memecoin-bot .
```

### 3. Start Production

```bash
# Update environment for production
export NODE_ENV=production
export TEST_MODE=false
export AUTO_TRADE_ENABLED=true  # Only if you're ready!

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
pm2 startup
```

### 4. Monitoring Setup

```bash
# Monitor with PM2
pm2 status
pm2 logs
pm2 monit

# Set up log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

## Verification

### 1. Health Checks

```bash
# Check API health
curl http://localhost:3000/health

# Check bot status
curl http://localhost:3000/status

# Monitor logs
tail -f logs/combined.log
```

### 2. Test Emergency Controls

```bash
# Test emergency stop
curl -X POST http://localhost:3000/emergency-stop

# Check that trading is paused
curl http://localhost:3000/status
```

## Troubleshooting

### Common Issues

1. **"Failed to connect to Solana"**
   ```bash
   # Test RPC connection
   curl -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' \
     $SOLANA_RPC_URL
   ```

2. **"Twitter authentication failed"**
   ```bash
   # Verify Twitter credentials
   curl -H "Authorization: Bearer $TWITTER_BEARER_TOKEN" \
     "https://api.twitter.com/2/users/me"
   ```

3. **"Insufficient balance for trading"**
   ```bash
   # Check wallet balance
   solana balance
   
   # If needed, fund the wallet
   # Transfer SOL to your wallet address
   ```

4. **"Program not found"**
   ```bash
   # Verify program deployment
   solana program show $PROGRAM_ID
   
   # Redeploy if necessary
   anchor deploy --provider.cluster mainnet
   ```

### Log Analysis

```bash
# Search for errors
grep ERROR logs/combined.log

# Monitor specific components
grep "\[PoolMonitor\]" logs/combined.log
grep "\[TwitterBot\]" logs/combined.log
grep "\[TradingEngine\]" logs/combined.log

# Monitor trades
grep "TRADE:" logs/combined.log
```

### Performance Monitoring

```bash
# Check memory usage
ps aux | grep node

# Monitor network connections
netstat -an | grep 3000

# Check disk space
df -h
du -sh logs/
```

## Next Steps

1. **Gradual Rollout**
   - Start with monitoring only
   - Enable trading with very small amounts
   - Gradually increase limits as confidence builds

2. **Monitoring & Alerts**
   - Set up Discord/Slack webhooks
   - Monitor wallet balances
   - Track bot performance metrics

3. **Optimization**
   - Fine-tune risk parameters
   - Adjust timing and cooldowns
   - Optimize signal quality

4. **Security**
   - Regular security audits
   - Key rotation schedules
   - Backup procedures

Remember: This bot trades real money. Always start small, test thoroughly, and never risk more than you can afford to lose!
