# Solana Memecoin Twitter Signals Bot

A sophisticated Twitter bot that monitors Solana memecoin deployments on Raydium, performs real-time risk analysis, and executes automated trades through a smart contract.

## Features

- **Real-time Pool Monitoring**: Monitors Raydium AMM for new memecoin pool deployments
- **Twitter Integration**: Sends automated signals via Twitter API v2
- **Smart Contract Integration**: On-chain risk analysis and automated trade execution
- **Risk Assessment**: Multi-factor risk scoring system
- **Security**: Built-in safeguards and slippage protection

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Pool Monitor  │────│  Risk Analysis  │────│ Smart Contract  │
│    (Node.js)    │    │    Engine       │    │   (Rust/Anchor) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────│  Twitter Bot    │──────────────┘
                        │   (Node.js)     │
                        └─────────────────┘
```

## Components

### 1. Smart Contract (`/programs`)
- Automated trade execution
- On-chain risk validation
- Slippage protection
- Emergency controls

### 2. Pool Monitor (`/src/monitor`)
- Real-time Raydium pool detection
- Transaction parsing
- Pool metadata extraction

### 3. Risk Analysis Engine (`/src/analysis`)
- Liquidity analysis
- Token supply checks
- Contract verification
- Social sentiment scoring

### 4. Twitter Bot (`/src/twitter`)
- Signal broadcasting
- Real-time updates
- Community engagement

## Quick Start

### Prerequisites

- Node.js 18+
- Rust & Anchor CLI
- Solana CLI
- Twitter Developer Account
- Solana RPC endpoint (Alchemy/QuickNode recommended)

### Environment Setup

```bash
# Clone the repository
git clone https://github.com/m0biuss/solana-memecoin-twitter-signals-bot.git
cd solana-memecoin-twitter-signals-bot

# Install Node.js dependencies
npm install

# Install Rust dependencies (for smart contract)
cd programs/trading-bot
cargo build-bpf
cd ../..

# Copy environment file
cp .env.example .env
# Edit .env with your credentials
```

### Configuration

Edit `.env` with your credentials:

```env
# Solana Configuration
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=your_solana_private_key
PROGRAM_ID=your_deployed_program_id

# Twitter API v2
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# Risk Management
MAX_TRADE_AMOUNT=0.1  # SOL
MIN_LIQUIDITY=10      # SOL
MAX_SLIPPAGE=5        # %
RISK_THRESHOLD=7      # out of 10
```

### Deployment

1. **Deploy Smart Contract:**
```bash
anchor build
anchor deploy --provider.cluster mainnet
```

2. **Start the Bot:**
```bash
npm run start
```

## Risk Assessment Criteria

- **Liquidity Depth** (25%): Pool liquidity amount
- **Token Supply** (20%): Circulating vs total supply
- **Contract Security** (20%): Verified/audited contracts
- **Social Signals** (15%): Twitter mentions, sentiment
- **Market Timing** (10%): Recent market conditions
- **Team Credibility** (10%): Developer/team background

## Safety Features

- **Maximum Trade Limits**: Configurable per-trade limits
- **Slippage Protection**: Automatic slippage calculation
- **Emergency Stop**: Manual override capability
- **Blacklist**: Known scam token filtering
- **Time Delays**: Configurable execution delays

## API Endpoints

- `GET /status` - Bot status and statistics
- `POST /configure` - Update bot configuration
- `GET /signals` - Recent signal history
- `POST /emergency-stop` - Emergency halt trading

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Security

⚠️ **IMPORTANT**: This bot handles real funds. Please:
- Test thoroughly on devnet
- Start with small amounts
- Regular security audits
- Keep private keys secure
- Monitor bot activity closely

## License

MIT License - see LICENSE file for details

## Disclaimer

This software is for educational purposes. Automated trading involves significant financial risk. Use at your own risk.