require("@nomicfoundation/hardhat-toolbox");

// Optional: only needed if you want to deploy to the Sepolia testnet.
// Create a .env file (see README) or set these in your terminal.
require("dotenv").config({ quiet: true });
const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Local node started with: npx hardhat node
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // Only added when the .env values exist, so local work never breaks
    ...(SEPOLIA_RPC_URL && PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [PRIVATE_KEY],
          },
        }
      : {}),
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
};
