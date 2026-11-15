# ALU Logo Registry dApp

## What this project does

This project protects the official ALU logo on the Ethereum blockchain and gives people a simple website to use it.

There are two smart contracts (from Formative 1, reused without rewriting):

- **ALUAssetRegistry** (ERC-721) registers the logo as an NFT and stores its SHA-256 fingerprint, the wallet that registered it and when.
- **ALULogoToken** (ERC-20, symbol ALUT) splits ownership of the logo into 1,000,000 shares that the owner can hand out.

The **frontend** (Formative 2) is a web app in `frontend/` that lets anyone use those contracts from a browser:

| Page | What it does | Contract it talks to |
|---|---|---|
| Verify a Logo | Upload a logo file (or paste a hash) and see if it's the real ALU logo. No wallet needed. | `ALUAssetRegistry.verifyLogoIntegrity()` and `getAsset()` |
| Register | Hash an image in the browser and register it as a new NFT. | `ALUAssetRegistry.isHashRegistered()` and `registerAsset()` |
| Token Dashboard | See total supply, your balance and ownership %, every holder, and (owner only) send shares. | `ALULogoToken.totalSupply()`, `balanceOf()`, `ownershipPercentage()`, `owner()`, `distributeShares()` |

**How the frontend connects to the contracts:** the deploy script copies each contract's ABI into `frontend/src/abi/` and writes the contract addresses into `frontend/src/config/contracts.json`. The app uses ethers.js to build contract objects from those. Free read-only calls go through a JSON-RPC provider pointed at the blockchain, so they work without a wallet. Transactions go through the user's wallet (MetaMask), which asks the user to approve and sign each one.

## ALU logo SHA-256 hash

File: `alu-logo.png` (1024 x 186 PNG, 33,880 bytes)

```
e1c249b379dece3552de9559ba3bc2e9af5cc242d56f0869fb11a2eff4f5d73c
```

As `bytes32`: `0xe1c249b379dece3552de9559ba3bc2e9af5cc242d56f0869fb11a2eff4f5d73c`

Check it yourself with `node scripts/hashLogo.js`, `sha256sum alu-logo.png` (Git Bash, macOS, Linux) or `certutil -hashfile alu-logo.png SHA256` (Windows). You can also drop the file into the Verify page.

## Versions used

- Node.js: 24.13.0 (18 or newer works)
- Hardhat: 2.29.1
- Solidity: 0.8.24
- OpenZeppelin Contracts: 5.1.0
- ethers.js: 6.17.0
- Frontend: plain HTML, CSS and JavaScript, built and served with Vite 7.3.8 (no framework)
- Wallet: MetaMask (any wallet that injects `window.ethereum`, such as Coinbase Wallet, also works)

## Project structure

```
contracts/ALUAssetRegistry.sol    ERC-721 logo registration contract
contracts/ALULogoToken.sol        ERC-20 ownership share token (ALUT)
scripts/deploy.js                 Deploys both contracts, registers the logo, gives
                                  example shares, writes ABIs + addresses for the frontend
scripts/hashLogo.js               Prints the SHA-256 hash of alu-logo.png
test/ALUAssetRegistry.test.js     13 automated tests (8 contract + 5 frontend integration)
frontend/index.html               The three pages
frontend/src/main.js              Page logic, wallet connection, contract calls
frontend/src/lib/dapp.js          Shared logic (hashing, verification, distribution) used
                                  by both the page and the tests
frontend/src/abi/                 Contract ABIs (written by the deploy script)
frontend/src/config/contracts.json  Contract addresses (written by the deploy script)
samples/alu-logo-tampered.png     The ALU logo with one pixel changed, for testing fakes
alu-logo.png                      The official ALU logo file that was registered
hardhat.config.js                 Hardhat settings
```

## Setup and running

### 1. Install dependencies

```bash
npm install                      # Hardhat, OpenZeppelin, ethers
npm run frontend:install         # Vite and ethers for the website
```

### 2. Compile and run all 13 tests

```bash
npx hardhat compile
npx hardhat test
```

### 3. Start the local blockchain (terminal 1, leave it running)

```bash
npx hardhat node
```

### 4. Deploy (terminal 2)

```bash
npx hardhat run scripts/deploy.js --network localhost
```

This deploys both contracts, registers the ALU logo as token #1, gives example shares to three stakeholder wallets (Faculty Senate 100,000, Student Council 50,000, Alumni Network 30,000), and writes the ABIs and addresses into the frontend.

### 5. Start the website (terminal 3)

```bash
npm run frontend
```

Open http://localhost:5173 in Chrome.

## Connecting a wallet (MetaMask)

1. Install the MetaMask extension in Chrome from https://metamask.io/download/
2. In MetaMask, add a network manually: **Network name** Hardhat Local, **RPC URL** `http://127.0.0.1:8545`, **Chain ID** 31337, **Currency symbol** ETH. (Or click Connect Wallet in the app and then Switch network, and the app will add it for you.)
3. Import the owner wallet (Hardhat account #0): MetaMask account menu → Add account → Import account → paste
   `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
4. To test as a non-owner, also import account #1:
   `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

These keys are public test keys printed by `npx hardhat node`. Never send real money to them.

## Using each feature

**Verify a Logo (no wallet needed).** Choose `alu-logo.png` and you'll see a green "Logo Verified" result with who registered it and when. Choose `samples/alu-logo-tampered.png` and you'll see a red "Warning: This logo has been modified". You can also switch to "Paste a fingerprint" and paste the hash above.

**Connect Wallet.** Click Connect Wallet in the top bar (it's on every page). Your shortened address and ALUT balance appear. Disconnect is next to it. If you have no wallet installed you get a message explaining what to do. If MetaMask is on the wrong network, a yellow bar appears with a Switch network button.

**Register.** Choose an image. Its SHA-256 hash is worked out in the browser and shown, and the form fills in the hash and file type. Enter a name and click Register on blockchain, then approve in MetaMask. You get the new token ID. Trying to register `alu-logo.png` again shows a clear "already registered" message.

**Token Dashboard.** Shows total supply, your balance and ownership %, and every holder. If you're connected as the owner (account #0), the Distribute shares form is enabled: enter a wallet address and amount, approve in MetaMask, and the table updates. Any other wallet sees the form disabled with a message that only the owner can distribute.

## Deploying to the Sepolia testnet (optional)

1. Get a free Sepolia RPC URL (Alchemy or Infura) and some free Sepolia ETH from a faucet.
2. Copy `.env.example` to `.env` and fill in the values. Use a test wallet only.
3. `npx hardhat run scripts/deploy.js --network sepolia`
4. Run the website against Sepolia: create `frontend/.env` containing `VITE_CHAIN_ID=11155111`, then `npm run frontend`.

## Known issues and limitations

- **Restarting the Hardhat node resets the blockchain.** Everything registered is wiped, so run the deploy script again after each restart.
- **MetaMask "nonce too high" error after a restart.** MetaMask remembers old transactions. Fix: MetaMask Settings → Advanced → Clear activity tab data (called "Delete activity and nonce data" in newer versions).
- **The Verify page checks against one token ID** (the official logo, token #1, set in `contracts.json`). It answers "is this the official logo?", not "is this any registered file?".
- **Anyone can call `registerAsset()`.** The registry doesn't restrict who registers, so a registered file isn't automatically official. The Verify page only trusts the token ID ALU registered.
- **Only browser-extension wallets are supported** (MetaMask, Coinbase Wallet extension, Brave). WalletConnect for mobile wallets isn't added yet.
- **Ownership percentages are whole numbers**, so a holding under 1% shows as 0%.
- **The holder list is built from Transfer events.** Some public Sepolia RPCs limit event searches; if so, the table falls back to the owner and the three example holders.

## Problems I ran into and how I fixed them

- **Hardhat 3 vs Hardhat 2.** `npm install hardhat` now gives Hardhat 3, which uses a different setup. I pinned Hardhat 2.29.1. Running `npx hardhat` in a folder without `node_modules` also downloads Hardhat 3 and fails with HHE22, so always run `npm install` first.
- **OpenZeppelin 5 changes.** `Ownable` needs the owner passed in, and `Counters.sol` is gone, so I used a plain counter.
- **Reading return values from transactions.** A transaction doesn't hand back its return value in JavaScript, so the app reads the new token ID from the `AssetRegistered` event.
- **Token decimals.** I set `decimals()` to 0 so 1 ALUT is exactly 1 share.
- **The white logo was invisible in previews.** The ALU logo is white on a transparent background, so the image preview uses a dark background.
- **Testing frontend code with Hardhat.** The frontend is an ES module but Hardhat tests are CommonJS. I put the logic in `frontend/src/lib/dapp.js` and load it in the tests with `import()`, so the tests check the exact code the website runs.
- **Unclear duplicate errors.** MetaMask doesn't always show the revert message from a local node, so the app checks `isHashRegistered()` (a free read) before opening the wallet and shows a plain message.
